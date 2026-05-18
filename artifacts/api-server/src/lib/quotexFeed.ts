/**
 * Quotex WebSocket feed — connects directly to market-qx.trade's Socket.IO
 * endpoint so our candles and SIGNALS match Quotex exactly.
 *
 * Auth: Cookie-based (laravel_session). The session is obtained by:
 *   1. OPTION A — Email/password auto-login (QUOTEX_EMAIL + QUOTEX_PASSWORD in .env)
 *   2. OPTION B — Manual session cookie (QUOTEX_SESSION in .env)
 *
 * What we get from Quotex WS:
 *   instruments/list binary (every ~120s) containing ALL 100 OTC pairs with:
 *     - Field [12]: direction signals [[period_secs, "call"|"put"], ...]
 *                   "call" = price expected to go UP, "put" = expected DOWN
 *     - Field [14]: isMarketOpen (boolean)
 *     - Field [15]: candle body sizes [{time, price}, ...] — absolute pip/dollar movement
 *                   e.g. EURUSD {time:60, price:0.00041} means 4.1-pip body in last 1-min candle
 *
 * Protocol: Socket.IO EIO=3 over raw WebSocket
 */

import WebSocket from "ws";
import https from "https";
import { logger } from "./logger.js";
import { logQuotexSnapshot } from "./learningEngine.js";

// ── Config ────────────────────────────────────────────────────────────────────
const QUOTEX_HOST = (process.env.QUOTEX_HOST ?? "market-qx.trade").replace(/^https?:\/\//, "");
const WSS_URL     = `wss://ws2.${QUOTEX_HOST}/socket.io/?EIO=3&transport=websocket`;
const LOGIN_URL   = `https://${QUOTEX_HOST}/api/v1/cabinet/login`;

// ── Quotex asset name → internal symbol(s) ───────────────────────────────────
// Maps Quotex asset codes (from instruments/list) → our internal symbols.
// Source: live instruments/list binary captured from market-qx.trade (100 instruments).
//
// NOTE: On Quotex, BTC/ETH/SOL are ONLY available as OTC (BTCUSD_otc etc.),
// not as real-market pairs. Real pairs: EURUSD, GBPUSD, AUDUSD, USDJPY, USDCAD,
// USDCHF, XAUUSD, XAGUSD.
const QUOTEX_TO_INTERNAL: Record<string, string[]> = {
  // ── Forex — real market pairs (trade during forex hours) ──────────────────
  "EURUSD":       ["EUR/USD"],
  "GBPUSD":       ["GBP/USD"],
  "AUDUSD":       ["AUD/USD"],
  "USDJPY":       ["USD/JPY"],
  "USDCAD":       ["USD/CAD"],
  "USDCHF":       ["USD/CHF"],
  // ── Commodities — real market ─────────────────────────────────────────────
  "XAUUSD":       ["XAU/USD"],
  "XAGUSD":       ["XAG/USD"],
  // ── OTC Forex pairs (24/7, all major + cross + exotic) ───────────────────
  "EURUSD_otc":   ["EUR/USD OTC"],
  "GBPUSD_otc":   ["GBP/USD OTC"],
  "AUDUSD_otc":   ["AUD/USD OTC"],
  "USDJPY_otc":   ["USD/JPY OTC"],
  "USDCAD_otc":   ["USD/CAD OTC"],
  "USDCHF_otc":   ["USD/CHF OTC"],
  "EURGBP_otc":   ["EUR/GBP OTC"],
  "EURJPY_otc":   ["EUR/JPY OTC"],
  "EURCAD_otc":   ["EUR/CAD OTC"],
  "EURAUD_otc":   ["EUR/AUD OTC"],
  "EURCHF_otc":   ["EUR/CHF OTC"],
  "EURNZD_otc":   ["EUR/NZD OTC"],
  "GBPJPY_otc":   ["GBP/JPY OTC"],
  "GBPAUD_otc":   ["GBP/AUD OTC"],
  "GBPCAD_otc":   ["GBP/CAD OTC"],
  "GBPCHF_otc":   ["GBP/CHF OTC"],
  "GBPNZD_otc":   ["GBP/NZD OTC"],
  "AUDJPY_otc":   ["AUD/JPY OTC"],
  "AUDCAD_otc":   ["AUD/CAD OTC"],
  "AUDCHF_otc":   ["AUD/CHF OTC"],
  "AUDNZD_otc":   ["AUD/NZD OTC"],
  "NZDUSD_otc":   ["NZD/USD OTC"],
  "NZDJPY_otc":   ["NZD/JPY OTC"],
  "NZDCAD_otc":   ["NZD/CAD OTC"],
  "NZDCHF_otc":   ["NZD/CHF OTC"],
  "CADCHF_otc":   ["CAD/CHF OTC"],
  "CADJPY_otc":   ["CAD/JPY OTC"],
  "CHFJPY_otc":   ["CHF/JPY OTC"],
  // Exotic OTC
  "USDEGP_otc":   ["USD/EGP OTC"],
  "USDIDR_otc":   ["USD/IDR OTC"],
  "USDDZD_otc":   ["USD/DZD OTC"],
  "USDINR_otc":   ["USD/INR OTC"],
  "USDMXN_otc":   ["USD/MXN OTC"],
  "USDNGN_otc":   ["USD/NGN OTC"],
  "USDPKR_otc":   ["USD/PKR OTC"],
  "USDPHP_otc":   ["USD/PHP OTC"],
  "USDZAR_otc":   ["USD/ZAR OTC"],
  "USDCOP_otc":   ["USD/COP OTC"],
  "USDBDT_otc":   ["USD/BDT OTC"],
  "USDARS_otc":   ["USD/ARS OTC"],
  "BRLUSD_otc":   ["BRL/USD OTC"],
  // ── OTC Commodity ─────────────────────────────────────────────────────────
  "XAUUSD_otc":   ["XAU/USD OTC"],
  "XAGUSD_otc":   ["XAG/USD OTC"],
  "UKBrent_otc":  ["UK Brent OTC"],
  "USCrude_otc":  ["US Crude OTC"],
  // ── OTC Crypto (ALL crypto on Quotex is OTC) ──────────────────────────────
  "BTCUSD_otc":   ["BTC/USD OTC", "BTC/USD"],   // maps to BTC/USD price cache
  "ETHUSD_otc":   ["ETH/USD OTC", "ETH/USD"],   // maps to ETH/USD price cache
  "SOLUSD_otc":   ["SOL/USD OTC", "SOL/USD"],   // maps to SOL/USD price cache
  "BNBUSD_otc":   ["BNB/USD OTC"],
  "XRPUSD_otc":   ["XRP/USD OTC"],
  "LTCUSD_otc":   ["LTC/USD OTC"],
  "BCHUSD_otc":   ["BCH/USD OTC"],
  "ETCUSD_otc":   ["ETC/USD OTC"],
  "ATOUSD_otc":   ["ATOM/USD OTC"],
  "DOTUSD_otc":   ["DOT/USD OTC"],
  "AXSUSD_otc":   ["AXS/USD OTC"],
  "AVAUSD_otc":   ["AVAX/USD OTC"],
  "LINUSD_otc":   ["LINK/USD OTC"],
  "DASUSD_otc":   ["DASH/USD OTC"],
  "ZECUSD_otc":   ["ZEC/USD OTC"],
  "TONUSD_otc":   ["TON/USD OTC"],
  "TRUUSD_otc":   ["TRU/USD OTC"],
  // ── OTC Stocks ────────────────────────────────────────────────────────────
  "MSFT_otc":     ["MSFT OTC"],
  "INTC_otc":     ["INTC OTC"],
  "FB_otc":       ["META OTC"],
  "AXP_otc":      ["AXP OTC"],
  "BA_otc":       ["BA OTC"],
  "JNJ_otc":      ["JNJ OTC"],
  "MCD_otc":      ["MCD OTC"],
  "PFE_otc":      ["PFE OTC"],
};

const ALL_QUOTEX_ASSETS = Object.keys(QUOTEX_TO_INTERNAL);

// ── Reverse map: internal symbol → Quotex asset code ─────────────────────────
// Built once at startup. When multiple Quotex codes map to the same internal
// symbol (e.g. BTCUSD_otc maps to both "BTC/USD OTC" and "BTC/USD"), we
// store the first match (OTC code takes priority).
const INTERNAL_TO_QUOTEX = new Map<string, string>();
for (const [qAsset, internals] of Object.entries(QUOTEX_TO_INTERNAL)) {
  for (const sym of internals) {
    if (!INTERNAL_TO_QUOTEX.has(sym)) INTERNAL_TO_QUOTEX.set(sym, qAsset);
  }
}

/**
 * Returns the Quotex asset code (e.g. "EURUSD_otc") for an internal symbol
 * (e.g. "EUR/USD OTC"), or null if not mapped.
 */
export function getQuotexAssetForSymbol(symbol: string): string | null {
  return INTERNAL_TO_QUOTEX.get(symbol) ?? null;
}

// ── Quotex signal store ───────────────────────────────────────────────────────
// Stores the latest call/put direction for each asset per expiry period.
// Updated every time instruments/list arrives from the WS (~every 120s).
export interface QuotexSignal {
  asset:      string;           // Quotex asset code, e.g. "EURUSD_otc"
  direction:  "call" | "put";  // "call" = UP, "put" = DOWN
  period:     number;           // expiry period in seconds (30, 60, 120, 180, 300…)
  bodySize:   number;           // absolute candle body size in native units (pips for forex)
  open:       boolean;          // is market open for this asset
  updatedAt:  number;           // ms timestamp of last update
}

// Map: "EURUSD_otc:60" → QuotexSignal
const signalStore = new Map<string, QuotexSignal>();

/** Get the latest Quotex signal for an asset+period combo, or null if not yet received. */
export function getQuotexSignal(asset: string, periodSeconds: number): QuotexSignal | null {
  return signalStore.get(`${asset}:${periodSeconds}`) ?? null;
}

/** Get all current Quotex signals. */
export function getAllQuotexSignals(): QuotexSignal[] {
  return Array.from(signalStore.values());
}

// ── State ─────────────────────────────────────────────────────────────────────
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let sessionRefreshTimer: NodeJS.Timeout | null = null;
let laravelSession = process.env.QUOTEX_SESSION
  ? decodeURIComponent(process.env.QUOTEX_SESSION)
  : "";
let running = false;
let msgCount = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(data: string): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(data);
}

function subscribeAll(): void {
  // Send ssid first — this triggers instruments/list to arrive quickly (~3s vs ~70s)
  send(`42["ssid","${laravelSession}"]`);
  for (const asset of ALL_QUOTEX_ASSETS) {
    send(`42["instruments/update",{"asset":"${asset}","period":60}]`);
  }
  logger.info({ count: ALL_QUOTEX_ASSETS.length }, "Quotex: subscribed to all instruments (ssid sent)");
}

// ── Message parser ────────────────────────────────────────────────────────────
function handleMessage(raw: string | Buffer, isBinary: boolean): void {
  msgCount++;
  if (isBinary) {
    handleInstrumentsBinary(raw as Buffer);
    return;
  }

  const msg = (raw as Buffer).toString();

  if (msg === "2") { send("3"); return; }          // server ping → pong
  if (msg === "3") return;                          // pong ack of our keepalive
  if (msg.startsWith("0")) { send("40"); return; } // EIO OPEN → Socket.IO CONNECT
  if (msg === "40" || msg.startsWith("40{")) {
    subscribeAll();
    return;
  }
  if (msg.startsWith("45")) return; // binary event text prefix (binary follows)
  if (!msg.startsWith("42")) return;

  let payload: [string, unknown];
  try { payload = JSON.parse(msg.slice(2)) as [string, unknown]; }
  catch { return; }

  const [event, data] = payload;
  if (!event || !data) return;
  logger.debug({ event, sample: JSON.stringify(data).slice(0, 200) }, "Quotex: WS event");
}

// ── instruments/list binary parser ───────────────────────────────────────────
/**
 * Confirmed format (from live capture):
 *   arr[i] = [
 *     0: id (number),
 *     1: asset_code (string),   e.g. "EURUSD_otc"
 *     2: name (string),
 *     3: type (string),         "currency" | "cryptocurrency" | "commodity"
 *     4: decimals (number),
 *     5: payout_pct (number),
 *     6: minPeriod (number),
 *     7: something (number),
 *     8: something (number),
 *     9: isOTC (0|1),
 *    10: relatedRealId (number),
 *    11: something (number),
 *    12: [[period_secs, "call"|"put"], ...],   ← DIRECTION SIGNALS per expiry
 *    13: serverTimestamp (number, Unix seconds),
 *    14: isRealMarketOpen (boolean),
 *    15: [{time: period_secs, price: body_size}, ...],  ← CANDLE MOVEMENTS
 *    16+: various stats (ATR, change%, etc.)
 *  ]
 */
function handleInstrumentsBinary(buf: Buffer): void {
  try {
    const skipBytes = buf.length > 0 && buf[0] === 0x04 ? 1 : 0;
    const arr = JSON.parse(buf.slice(skipBytes).toString("utf8")) as unknown[];

    let signalCount = 0;
    const now = Date.now();

    for (const item of arr) {
      if (!Array.isArray(item) || item.length < 13) continue;

      const asset = item[1] as string;
      const internals = QUOTEX_TO_INTERNAL[asset];

      // Direction signals from field[12]
      const dirArray = item[12] as [number, string][] | null;
      // Candle body sizes from field[15]
      const candleData = item[15] as Array<{ time: number; price: number }> | null;
      // Market open status from field[14]
      const isOpen = item[14] as boolean;

      if (Array.isArray(dirArray)) {
        for (const [periodSecs, dir] of dirArray) {
          if (typeof periodSecs !== "number") continue;
          if (dir !== "call" && dir !== "put") continue;

          // Find the matching body size for this period
          let bodySize = 0;
          if (Array.isArray(candleData)) {
            const match = candleData.find((c) => c.time === periodSecs);
            if (match) bodySize = match.price;
          }

          const signal: QuotexSignal = {
            asset,
            direction: dir,
            period: periodSecs,
            bodySize,
            open: isOpen,
            updatedAt: now,
          };
          signalStore.set(`${asset}:${periodSecs}`, signal);
          signalCount++;
        }
      }

      // NOTE: Price updates from Quotex body sizes are intentionally disabled.
      // Deriv WebSocket now owns the live price feed for all OTC pairs, providing
      // real streaming ticks that build accurate candles.
      // Quotex instruments/list is used ONLY for direction signals (call/put VETO gate)
      // and AI learning — it does NOT write prices.
    }

    logger.info(
      { signalCount, totalInstruments: arr.length },
      "Quotex: instruments/list parsed — signals updated",
    );

    // Async fire-and-forget: persist full snapshot to Supabase for AI learning.
    // The AI engine uses this data to learn which Quotex signals correlate with wins.
    const allSignals = Array.from(signalStore.values());
    logQuotexSnapshot(allSignals).catch(() => { /* non-fatal */ });
  } catch (err) {
    logger.warn(
      { err, bufLen: buf.length, prefix: buf.length > 0 ? buf[0] : -1 },
      "Quotex: instruments/list binary parse failed",
    );
  }
}

// ── Login via email/password ───────────────────────────────────────────────────
async function loginAndGetSession(email: string, password: string): Promise<string | null> {
  logger.info({ email }, "Quotex: logging in...");

  // Step 1: POST credentials → get step1 laravel_session
  const step1Session = await new Promise<string | null>((resolve) => {
    const body = JSON.stringify({ email, password, remember: true });
    const url = new URL(LOGIN_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Origin":         `https://${QUOTEX_HOST}`,
          "Referer":        `https://${QUOTEX_HOST}/en/sign-in`,
          "Accept":         "application/json, text/html",
        },
      },
      (res) => {
        let rawBody = "";
        res.on("data", (chunk: Buffer) => (rawBody += chunk.toString()));
        res.on("end", () => {
          const cookies = res.headers["set-cookie"] ?? [];
          for (const cookie of cookies) {
            const match = /laravel_session=([^;]+)/.exec(cookie);
            if (match?.[1] && res.statusCode === 302) {
              resolve(decodeURIComponent(match[1]));
              return;
            }
          }
          logger.warn({ status: res.statusCode, body: rawBody.slice(0, 200) }, "Quotex: login step 1 failed");
          resolve(null);
        });
      },
    );
    req.on("error", (err) => { logger.error({ err }, "Quotex: login request failed"); resolve(null); });
    req.write(body);
    req.end();
  });

  if (!step1Session) return null;

  // Step 2: GET /api/v1/access to fully initialise the trading session
  const finalSession = await new Promise<string | null>((resolve) => {
    const rememberWeb = process.env.QUOTEX_REMEMBER_WEB ?? "";
    const cookieParts = [`laravel_session=${step1Session}`, "lang=en", "activeAccount=demo"];
    if (rememberWeb) {
      cookieParts.push(`remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${decodeURIComponent(rememberWeb)}`);
    }

    const req = https.request(
      {
        hostname: QUOTEX_HOST,
        path:     "/api/v1/access",
        method:   "GET",
        headers:  {
          "Cookie":     cookieParts.join("; "),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer":    `https://${QUOTEX_HOST}/en/sign-in`,
          "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      (res) => {
        res.on("data", () => { /* drain */ });
        res.on("end", () => {
          const cookies2 = res.headers["set-cookie"] ?? [];
          for (const cookie of cookies2) {
            const m = /laravel_session=([^;]+)/.exec(cookie);
            if (m?.[1]) {
              logger.info({ status: res.statusCode }, "Quotex: login step 2 — session upgraded");
              resolve(decodeURIComponent(m[1]));
              return;
            }
          }
          logger.info({ status: res.statusCode }, "Quotex: login step 2 complete");
          resolve(step1Session);
        });
      },
    );
    req.on("error", (err) => { logger.warn({ err }, "Quotex: /api/v1/access failed"); resolve(step1Session); });
    req.end();
  });

  if (finalSession) logger.info("Quotex: login successful");
  return finalSession;
}

// ── Connection ────────────────────────────────────────────────────────────────
function buildCookieHeader(): string {
  const parts: string[] = [];
  if (laravelSession) parts.push(`laravel_session=${laravelSession}`);
  const rememberWeb = process.env.QUOTEX_REMEMBER_WEB ?? "";
  if (rememberWeb) parts.push(`remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${rememberWeb}`);
  parts.push("activeAccount=demo", "lang=en");
  return parts.join("; ");
}

function connect(): void {
  if (!running) return;
  logger.info({ url: WSS_URL }, "Quotex: connecting...");

  ws = new WebSocket(WSS_URL, {
    headers: {
      "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Origin":        `https://${QUOTEX_HOST}`,
      "Referer":       `https://${QUOTEX_HOST}/en/trade`,
      "Cache-Control": "no-cache",
      "Pragma":        "no-cache",
      "Cookie":        buildCookieHeader(),
    },
  });

  ws.on("open", () => {
    logger.info("Quotex: WebSocket open");
    // EIO v3: server sends pings every 25s, client must pong within 5s.
    // We also send keepalive pings every 20s to stay ahead of the timeout.
    pingTimer = setInterval(() => send("2"), 20_000);
  });

  ws.on("message", (data: Buffer | string, isBinary: boolean) => {
    handleMessage(data, isBinary);
  });

  ws.on("close", (code) => {
    logger.warn({ code }, "Quotex: WebSocket closed — reconnecting in 5 s");
    cleanup();
    if (running) reconnectTimer = setTimeout(connect, 5_000);
  });

  ws.on("error", (err) => {
    logger.error({ err }, "Quotex: WebSocket error");
    ws?.close();
  });
}

function cleanup(): void {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  ws = null;
}

// ── Session auto-refresh ──────────────────────────────────────────────────────
async function refreshSession(): Promise<void> {
  const email    = process.env.QUOTEX_EMAIL    ?? "";
  const password = process.env.QUOTEX_PASSWORD ?? "";
  if (!email || !password) return;

  const newSession = await loginAndGetSession(email, password);
  if (newSession) {
    laravelSession = newSession;
    logger.info("Quotex: session refreshed — reconnecting");
    if (ws) ws.close(); // triggers reconnect with new cookie
  } else {
    logger.warn("Quotex: session refresh failed — will retry in 10 min");
    setTimeout(() => { void refreshSession(); }, 10 * 60 * 1000);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function initQuotexFeed(): Promise<void> {
  const email         = process.env.QUOTEX_EMAIL    ?? "";
  const password      = process.env.QUOTEX_PASSWORD ?? "";
  const manualSession = process.env.QUOTEX_SESSION  ?? "";

  if (email && password) {
    const session = await loginAndGetSession(email, password);
    if (session) {
      laravelSession = session;
      logger.info("Quotex: session obtained via email/password login");
    } else {
      logger.warn("Quotex: email/password login failed — trying manual session if set");
    }
  }

  if (!laravelSession && manualSession) {
    laravelSession = decodeURIComponent(manualSession);
    logger.info("Quotex: using manual QUOTEX_SESSION from .env");
  }

  if (!laravelSession) {
    logger.warn(
      "Quotex feed disabled — no session available.\n" +
      "  Set QUOTEX_EMAIL + QUOTEX_PASSWORD in .env for auto-login, or\n" +
      "  set QUOTEX_SESSION=<laravel_session cookie value>.",
    );
    return;
  }

  running = true;
  connect();
  logger.info(
    { assets: ALL_QUOTEX_ASSETS.length },
    "Quotex feed started — direction signals will update every ~120s from instruments/list",
  );

  if (email && password) {
    sessionRefreshTimer = setInterval(() => { void refreshSession(); }, 90 * 60 * 1000);
    logger.info("Quotex: session auto-refresh every 90 min");
  }
}

export function stopQuotexFeed(): void {
  running = false;
  if (reconnectTimer)     { clearTimeout(reconnectTimer);    reconnectTimer = null; }
  if (sessionRefreshTimer){ clearInterval(sessionRefreshTimer); sessionRefreshTimer = null; }
  cleanup();
}
