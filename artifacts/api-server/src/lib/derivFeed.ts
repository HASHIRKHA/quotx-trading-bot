/**
 * Deriv WebSocket feed — 24/7 live ticks for crypto + gold (when market open).
 *
 * Why Deriv?
 *   • TwelveData free tier sends frozen heartbeat ticks for XAU (price never changes).
 *   • Yahoo Finance GC=F gives a single quote per poll, not streaming ticks.
 *   • Deriv provides streaming tick data with ~1 tick/second for free, no API key.
 *
 * Symbol mapping (validated against Deriv API):
 *   frxXAUUSD  → XAU/USD  (gold OTC, follows gold market hours — Mon–Fri)
 *   cryBTCUSD  → BTC/USD  (crypto, 24/7 — backup/supplement to TwelveData WS)
 *   cryETHUSD  → ETH/USD  (crypto, 24/7 — backup/supplement)
 *
 * Market-closed handling:
 *   When Deriv reports "MarketIsClosed" (weekend gold, etc.) we back off 30 minutes
 *   and retry instead of hammering the endpoint every 5 seconds.
 *
 * Public app_id 1089 is Deriv's demo/public app — no registration required.
 */

import WebSocket from "ws";
import { setLiveTick, getPrice } from "./twelvedata.js";
import { logger } from "./logger.js";

const DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3?app_id=1089";

/**
 * Deriv instrument → one or more internal symbols.
 * OTC variants share the same underlying feed as their real counterpart,
 * so a single Deriv tick fans out to both "X" and "X OTC" symbols.
 */
const DERIV_SYMBOL_MAP: Record<string, string[]> = {
  // ── Crypto (24/7) ─────────────────────────────────────────────────────────
  // NOTE: crySOLUSD returns InvalidSymbol on Deriv — SOL/USD is served by
  // Binance REST (60s interval) and TwelveData WebSocket instead.
  cryBTCUSD: ["BTC/USD"],
  cryETHUSD: ["ETH/USD"],

  // ── Commodities ───────────────────────────────────────────────────────────
  frxXAUUSD: ["XAU/USD"],

  // ── Major forex pairs — each tick fans out to real + OTC variant ──────────
  frxEURUSD: ["EUR/USD", "EUR/USD OTC"],
  frxGBPUSD: ["GBP/USD", "GBP/USD OTC"],
  frxAUDUSD: ["AUD/USD", "AUD/USD OTC"],
  frxUSDJPY: ["USD/JPY", "USD/JPY OTC"],
  frxUSDCAD: ["USD/CAD", "USD/CAD OTC"],
  frxUSDCHF: ["USD/CHF", "USD/CHF OTC"],
  frxNZDUSD: ["NZD/USD", "NZD/USD OTC"],

  // ── JPY crosses ───────────────────────────────────────────────────────────
  frxGBPJPY: ["GBP/JPY", "GBP/JPY OTC"],
  frxAUDJPY: ["AUD/JPY", "AUD/JPY OTC"],
  frxEURJPY: ["EUR/JPY", "EUR/JPY OTC"],
  frxNZDJPY: ["NZD/JPY", "NZD/JPY OTC"],
  // NOTE: frxCADJPY and frxCHFJPY are InvalidSymbol on Deriv —
  // computed synthetically via computeCrossRates() from USD/JPY + USD/CAD|CHF.

  // ── EUR crosses ───────────────────────────────────────────────────────────
  frxEURGBP: ["EUR/GBP", "EUR/GBP OTC"],
  frxEURCAD: ["EUR/CAD", "EUR/CAD OTC"],
  frxEURAUD: ["EUR/AUD", "EUR/AUD OTC"],
  frxEURCHF: ["EUR/CHF", "EUR/CHF OTC"],
  frxEURNZD: ["EUR/NZD", "EUR/NZD OTC"],

  // ── GBP crosses ───────────────────────────────────────────────────────────
  frxGBPAUD: ["GBP/AUD", "GBP/AUD OTC"],
  frxGBPCAD: ["GBP/CAD", "GBP/CAD OTC"],
  frxGBPCHF: ["GBP/CHF", "GBP/CHF OTC"],
  frxGBPNZD: ["GBP/NZD", "GBP/NZD OTC"],

  // ── AUD crosses ───────────────────────────────────────────────────────────
  frxAUDCAD: ["AUD/CAD", "AUD/CAD OTC"],
  frxAUDCHF: ["AUD/CHF", "AUD/CHF OTC"],
  frxAUDNZD: ["AUD/NZD", "AUD/NZD OTC"],

  // NOTE: frxNZDCAD, frxNZDCHF, frxCADCHF are InvalidSymbol on Deriv —
  // computed synthetically via computeCrossRates() from their USD legs.

  // NOTE: Exotic OTC pairs (USD/EGP, USD/IDR, USD/DZD) are NOT available on
  // Deriv — Deriv returns InvalidSymbol for them.  Their candles are kept live
  // via the synthetic tick generator in candlePersister.ts (fires every 60s).
  // frxUSDEGP / frxUSDIDR / frxUSDDZD intentionally omitted from this map.
};

/** Symbols that reported MarketIsClosed — skip until next scheduled retry */
const closedSymbols = new Set<string>();

let derivWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let marketReopenTimer: NodeJS.Timeout | null = null;
let running = false;

function subscribeSymbols(ws: WebSocket): void {
  for (const derivSym of Object.keys(DERIV_SYMBOL_MAP)) {
    if (!closedSymbols.has(derivSym)) {
      ws.send(JSON.stringify({ ticks: derivSym, subscribe: 1 }));
    }
  }
}

function activeSymbolCount(): number {
  return Object.keys(DERIV_SYMBOL_MAP).filter(s => !closedSymbols.has(s)).length;
}

/**
 * Compute derived cross-rate pairs from live USD-leg prices.
 *
 * Deriv does not stream CHF/JPY, CAD/JPY, NZD/CAD, NZD/CHF or CAD/CHF
 * directly (they return InvalidSymbol on subscription).  We synthesise them
 * in real-time from the USD-leg pairs we do receive:
 *
 *   CHF/JPY  = USD/JPY ÷ USD/CHF
 *   CAD/JPY  = USD/JPY ÷ USD/CAD
 *   NZD/CAD  = NZD/USD × USD/CAD
 *   NZD/CHF  = NZD/USD × USD/CHF
 *   CAD/CHF  = USD/CHF ÷ USD/CAD
 *
 * Called after every Deriv tick so the cross rate is updated tick-for-tick
 * with the same frequency as the USD-leg pair (~1/s).
 */
function computeCrossRates(ts: number): void {
  const usdJpy = getPrice("USD/JPY");
  const usdChf = getPrice("USD/CHF");
  const usdCad = getPrice("USD/CAD");
  const nzdUsd = getPrice("NZD/USD");

  // CHF/JPY = USD/JPY / USD/CHF
  if (usdJpy > 0 && usdChf > 0) {
    const chfJpy = parseFloat((usdJpy / usdChf).toFixed(3));
    if (chfJpy > 0) {
      setLiveTick("CHF/JPY",     chfJpy, ts);
      setLiveTick("CHF/JPY OTC", chfJpy, ts);
    }
  }

  // CAD/JPY = USD/JPY / USD/CAD
  if (usdJpy > 0 && usdCad > 0) {
    const cadJpy = parseFloat((usdJpy / usdCad).toFixed(3));
    if (cadJpy > 0) {
      setLiveTick("CAD/JPY",     cadJpy, ts);
      setLiveTick("CAD/JPY OTC", cadJpy, ts);
    }
  }

  // NZD/CAD = NZD/USD × USD/CAD
  if (nzdUsd > 0 && usdCad > 0) {
    const nzdCad = parseFloat((nzdUsd * usdCad).toFixed(5));
    if (nzdCad > 0) {
      setLiveTick("NZD/CAD",     nzdCad, ts);
      setLiveTick("NZD/CAD OTC", nzdCad, ts);
    }
  }

  // NZD/CHF = NZD/USD × USD/CHF
  if (nzdUsd > 0 && usdChf > 0) {
    const nzdChf = parseFloat((nzdUsd * usdChf).toFixed(5));
    if (nzdChf > 0) {
      setLiveTick("NZD/CHF",     nzdChf, ts);
      setLiveTick("NZD/CHF OTC", nzdChf, ts);
    }
  }

  // CAD/CHF = USD/CHF / USD/CAD
  if (usdChf > 0 && usdCad > 0) {
    const cadChf = parseFloat((usdChf / usdCad).toFixed(5));
    if (cadChf > 0) {
      setLiveTick("CAD/CHF",     cadChf, ts);
      setLiveTick("CAD/CHF OTC", cadChf, ts);
    }
  }
}

function connectDeriv(): void {
  if (!running) return;

  const activeSymbols = Object.keys(DERIV_SYMBOL_MAP).filter(s => !closedSymbols.has(s));
  if (activeSymbolCount() === 0) {
    // All symbols are closed — no point connecting, just wait for market reopen timer
    logger.info("Deriv: all symbols currently closed — waiting for market reopen");
    return;
  }

  logger.info({ symbols: activeSymbols }, "Connecting to Deriv WebSocket...");

  derivWs = new WebSocket(DERIV_WS_URL);

  derivWs.on("open", () => {
    logger.info("Deriv WS connected — subscribing to active symbols");
    subscribeSymbols(derivWs!);
  });

  derivWs.on("message", (raw: Buffer | string) => {
    let msg: {
      msg_type?: string;
      echo_req?: { ticks?: string };
      tick?: { symbol?: string; quote?: number; epoch?: number };
      error?: { code?: string; message?: string };
    };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.msg_type === "tick" && msg.tick?.symbol && msg.tick.quote) {
      const ourSymbols = DERIV_SYMBOL_MAP[msg.tick.symbol];
      if (ourSymbols && msg.tick.quote > 0) {
        const ts = msg.tick.epoch ? msg.tick.epoch * 1000 : Date.now();
        // Fan out one Deriv tick to all mapped internal symbols (real + OTC variants)
        for (const ourSym of ourSymbols) {
          setLiveTick(ourSym, msg.tick.quote, ts);
        }
        // ── Derived cross-rate computation ──────────────────────────────────
        // Pairs not available on Deriv (CHF/JPY, CAD/JPY, NZD/CAD, NZD/CHF,
        // CAD/CHF) are computed from USD-leg pairs that ARE live.
        // Each USD-leg tick triggers a fresh synthetic cross tick.
        computeCrossRates(ts);
      }
    }

    // Handle errors per-symbol
    if (msg.error) {
      const derivSym = msg.echo_req?.ticks;
      const code = msg.error.code;
      const message = msg.error.message;

      if (code === "MarketIsClosed" && derivSym) {
        // Mark symbol as closed; schedule a retry in 30 minutes
        closedSymbols.add(derivSym);
        logger.info(
          { symbol: derivSym, retryInMinutes: 30 },
          `Deriv: ${derivSym} market closed — will retry in 30 min`,
        );
        scheduleMarketReopenCheck();
      } else if (code === "InvalidSymbol" && derivSym) {
        // Permanently invalid — remove from map so we never retry
        delete DERIV_SYMBOL_MAP[derivSym];
        logger.warn({ symbol: derivSym }, "Deriv: invalid symbol removed from feed");
      } else {
        logger.warn({ code, message }, "Deriv subscription error");
      }
    }
  });

  derivWs.on("error", (err) => {
    logger.error({ err }, "Deriv WS error");
  });

  derivWs.on("close", (code) => {
    logger.warn({ code }, "Deriv WS closed — reconnecting in 5s");
    derivWs = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (running) reconnectTimer = setTimeout(connectDeriv, 5000);
  });
}

/**
 * Schedule a market-reopen check every 30 minutes.
 * When the timer fires, clear closedSymbols and reconnect so all symbols are retried.
 * Only one timer runs at a time.
 */
function scheduleMarketReopenCheck(): void {
  if (marketReopenTimer) return; // already scheduled
  const REOPEN_MS = 30 * 60 * 1000; // 30 minutes
  marketReopenTimer = setTimeout(() => {
    marketReopenTimer = null;
    logger.info("Deriv: retrying closed symbols (30-min market reopen check)");
    closedSymbols.clear();
    // Close existing connection to force a fresh subscribe
    if (derivWs) {
      derivWs.close();
    } else {
      connectDeriv();
    }
  }, REOPEN_MS);
}

/** Start the Deriv feed. Reconnects automatically on disconnect. */
export function initDerivFeed(): void {
  running = true;
  connectDeriv();
}

/** Stop the Deriv feed (for clean shutdown). */
export function stopDerivFeed(): void {
  running = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (marketReopenTimer) clearTimeout(marketReopenTimer);
  if (derivWs) {
    derivWs.close();
    derivWs = null;
  }
}
