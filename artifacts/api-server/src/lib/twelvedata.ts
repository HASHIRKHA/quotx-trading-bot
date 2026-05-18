import WebSocket from "ws";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";
import { generateSeedCandles } from "./seedCandles.js";

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
}

type TickCallback = (tick: PriceTick) => void;

// EUR/USD and GBP/USD replaced with XAU/USD (Gold) and SOL/USD (Solana).
// XAU and SOL have intraday volatility far more suitable for binary options.
// BTC/USD and ETH/USD have confirmed live WS ticks on the TwelveData free tier.
export const SYMBOLS = [
  // ── Crypto (24/7 Deriv + Binance) ────────────────────────────────────────
  "BTC/USD", "ETH/USD", "SOL/USD",
  // ── Commodity ─────────────────────────────────────────────────────────────
  "XAU/USD",
  // ── Major forex — real market pairs ──────────────────────────────────────
  "EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD",
  "USD/JPY", "USD/CAD", "USD/CHF",
  "GBP/JPY", "AUD/JPY", "EUR/JPY", "NZD/JPY", "CAD/JPY", "CHF/JPY",
  "EUR/GBP", "EUR/CAD", "EUR/AUD", "EUR/CHF", "EUR/NZD",
  "GBP/AUD", "GBP/CAD", "GBP/CHF", "GBP/NZD",
  "AUD/CAD", "AUD/CHF", "AUD/NZD",
  "NZD/CAD", "NZD/CHF",
  "CAD/CHF",
  // ── OTC variants — all 24/7 on Quotex, live Deriv ticks ──────────────────
  "EUR/USD OTC", "GBP/USD OTC", "AUD/USD OTC", "NZD/USD OTC",
  "USD/JPY OTC", "USD/CAD OTC", "USD/CHF OTC",
  "GBP/JPY OTC", "AUD/JPY OTC", "EUR/JPY OTC", "NZD/JPY OTC", "CAD/JPY OTC", "CHF/JPY OTC",
  "EUR/GBP OTC", "EUR/CAD OTC", "EUR/AUD OTC", "EUR/CHF OTC", "EUR/NZD OTC",
  "GBP/AUD OTC", "GBP/CAD OTC", "GBP/CHF OTC", "GBP/NZD OTC",
  "AUD/CAD OTC", "AUD/CHF OTC", "AUD/NZD OTC",
  "NZD/CAD OTC", "NZD/CHF OTC",
  "CAD/CHF OTC",
  // ── Exotic OTC — synthetic ticks (no external feed) ───────────────────────
  "USD/EGP OTC", "USD/IDR OTC", "USD/DZD OTC",
];
const TWELVE_DATA_WS = "wss://ws.twelvedata.com/v1/quotes/price";

const priceCache = new Map<string, number>();
const priceTimestamp = new Map<string, number>();
const candleCache = new Map<string, OHLC[]>();
/** Separate 1-hour candle cache used by the signal engine (better entropy/trend) */
const hourlyCandleCache = new Map<string, OHLC[]>();
const subscribers = new Set<TickCallback>();

/** Live tick counter per symbol — drives the warm-up guard */
const liveTickCounts = new Map<string, number>();

/**
 * Tracks when the price for each symbol last CHANGED (vs. repeated same value).
 * Used to detect "frozen feeds" where TwelveData sends ticks but the price never moves.
 * This happens for commodities (XAU) on the free tier — ticks arrive but all carry
 * the same stale price, making getLiveTicks > 0 while the price is actually frozen.
 */
const lastPriceValue   = new Map<string, number>();
const lastPriceChanged = new Map<string, number>(); // timestamp of last actual price change

const WARMUP_TICKS = 5;

let ws: WebSocket | null = null;
let latency = 0;
let latencyBreached = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let pingTimestamp = 0;

const LATENCY_THRESHOLD = 500;
const MAX_CANDLES = 300;

export function getPrice(symbol: string): number {
  return priceCache.get(symbol) ?? 0;
}

/** Manually inject a price (used by free price feed when TwelveData is absent) */
export function setPrice(symbol: string, price: number): void {
  if (price > 0) {
    priceCache.set(symbol, price);
    priceTimestamp.set(symbol, Date.now());
  }
}

/**
 * Inject a full live tick from an external feed (e.g. Deriv WebSocket).
 * Mirrors the complete TwelveData message-handler pipeline:
 *   • Frozen-feed tracking (lastPriceValue / lastPriceChanged)
 *   • Live tick counter increment (so isWarmedUp / isPriceFrozen work correctly)
 *   • Price cache update (always — external feeds are real live data, never frozen)
 *   • Candle building
 *   • Subscriber notification (broadcasts to frontend WebSocket clients)
 *
 * Use this for Deriv OTC ticks so XAU/USD and SOL/USD stay live 24/7.
 */
export function setLiveTick(symbol: string, price: number, timestamp = Date.now()): void {
  if (!price || price <= 0) return;

  // Track whether the price actually changed (freeze detection)
  const prevVal = lastPriceValue.get(symbol);
  if (prevVal !== undefined && prevVal !== price) {
    lastPriceChanged.set(symbol, Date.now());
  }
  lastPriceValue.set(symbol, price);

  // Increment live tick counter
  const prev = liveTickCounts.get(symbol) ?? 0;
  liveTickCounts.set(symbol, prev + 1);

  // External feeds are always real — unconditionally update price cache
  priceCache.set(symbol, price);
  priceTimestamp.set(symbol, Date.now());

  buildCandle(symbol, price, timestamp);

  if (prev + 1 === WARMUP_TICKS) {
    logger.info({ symbol }, `Warm-up complete (Deriv feed) — ${WARMUP_TICKS} live ticks received`);
  }

  const tick: PriceTick = { symbol, price, timestamp };
  for (const cb of subscribers) {
    try {
      cb(tick);
    } catch (err) {
      logger.error({ err }, "Tick subscriber error");
    }
  }
}

/**
 * Returns milliseconds since this symbol's price was last set.
 * Returns Infinity if the price has never been set.
 */
export function getPriceAge(symbol: string): number {
  const ts = priceTimestamp.get(symbol);
  return ts !== undefined ? Date.now() - ts : Infinity;
}

export function getCandles(symbol: string): OHLC[] {
  return candleCache.get(symbol) ?? [];
}

export function setCandles(symbol: string, candles: OHLC[]): void {
  candleCache.set(symbol, candles);
}

/** Get 1-hour candles used by the signal engine */
export function getHourlyCandles(symbol: string): OHLC[] {
  return hourlyCandleCache.get(symbol) ?? [];
}

/** Set 1-hour candles for signal engine use */
export function setHourlyCandles(symbol: string, candles: OHLC[]): void {
  hourlyCandleCache.set(symbol, candles);
}

export function getLatency(): number {
  return latency;
}

export function isCircuitBreakerOpen(): boolean {
  return latencyBreached;
}

export function subscribeToTicks(cb: TickCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Returns the number of real-time WebSocket ticks received for this symbol */
export function getLiveTicks(symbol: string): number {
  return liveTickCounts.get(symbol) ?? 0;
}

/**
 * Returns true when a symbol has live ticks but the price has NOT moved for
 * at least `maxAgeMs` milliseconds. TwelveData free tier sends ticks for
 * commodities (XAU/USD) that all carry the same stale price — those symbols
 * look "live" to getLiveTicks but are actually frozen and must still be
 * refreshed from an external free feed.
 */
export function isPriceFrozen(symbol: string, maxAgeMs = 90_000): boolean {
  const ticks = liveTickCounts.get(symbol) ?? 0;
  // Need at least 2× warm-up ticks before declaring freeze to avoid false positives
  if (ticks < WARMUP_TICKS * 2) return false;
  const lastChanged = lastPriceChanged.get(symbol);
  // Price has never changed since first tick → frozen
  if (!lastChanged) return true;
  return Date.now() - lastChanged > maxAgeMs;
}

/**
 * True once warmed up. A symbol is considered warm if it has either:
 *   - >= WARMUP_TICKS live WebSocket ticks (real-time confirmation), OR
 *   - >= 100 candles in the cache (loaded from TwelveData REST history)
 * The second condition allows signals to fire immediately when 400 real
 * historical candles have been loaded, even before WS ticks accumulate.
 */
export function isWarmedUp(symbol: string): boolean {
  if ((liveTickCounts.get(symbol) ?? 0) >= WARMUP_TICKS) return true;
  return (candleCache.get(symbol)?.length ?? 0) >= 100;
}

function buildCandle(symbol: string, price: number, timestamp: number): void {
  const candles = candleCache.get(symbol) ?? [];
  const minuteTs = Math.floor(timestamp / 60000) * 60;

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    if (last.time === minuteTs) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += 1;
      candleCache.set(symbol, candles);
      return;
    }
  }

  const prevClose = candles.length > 0 ? candles[candles.length - 1].close : price;
  candles.push({
    time: minuteTs,
    open: prevClose,
    high: price,
    low: price,
    close: price,
    volume: 1,
  });

  if (candles.length > MAX_CANDLES) {
    candles.shift();
  }

  candleCache.set(symbol, candles);
}

function connectTwelveData(): void {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    logger.warn("TWELVE_DATA_API_KEY not set — skipping live feed");
    return;
  }

  logger.info({ symbols: SYMBOLS }, "Connecting to Twelve Data WebSocket (multi-stream)...");
  ws = new WebSocket(`${TWELVE_DATA_WS}?apikey=${apiKey}`);

  let pingInterval: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    logger.info("Twelve Data WS connected — subscribing to all 5 symbol streams");
    latencyBreached = false;

    const subscribeMsg = {
      action: "subscribe",
      params: { symbols: SYMBOLS.join(",") },
    };
    ws!.send(JSON.stringify(subscribeMsg));

    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        pingTimestamp = Date.now();
        ws.ping();
      }
    }, 5000);
  });

  ws.on("pong", () => {
    if (pingTimestamp > 0) {
      const rtt = Date.now() - pingTimestamp;
      latency = rtt;
      pingTimestamp = 0;

      if (rtt > LATENCY_THRESHOLD) {
        if (!latencyBreached) {
          logger.warn({ latency: rtt }, "Circuit breaker triggered — latency exceeded threshold");
          latencyBreached = true;
        }
      } else {
        if (latencyBreached) {
          logger.info({ latency: rtt }, "Circuit breaker reset — latency back to normal");
          latencyBreached = false;
        }
      }
    }
  });

  ws.on("message", (raw: Buffer | string) => {
    let msg: { event?: string; symbol?: string; price?: string | number; timestamp?: string | number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.event === "price" && msg.symbol && msg.price) {
      const symbol = msg.symbol;
      const price = typeof msg.price === "string" ? parseFloat(msg.price) : msg.price;
      const timestamp = typeof msg.timestamp === "number" ? msg.timestamp * 1000 : Date.now();

      // Track whether the price actually changed (for frozen-feed detection).
      // Only record a genuine change when transitioning from a KNOWN previous price —
      // the first tick (prevVal = undefined) must NOT count as a "change" because it
      // would make neverMoved=false immediately and defeat freeze detection.
      const prevVal = lastPriceValue.get(symbol);
      if (prevVal !== undefined && prevVal !== price) {
        lastPriceChanged.set(symbol, Date.now());
      }
      lastPriceValue.set(symbol, price);

      // Increment live tick counter for this symbol
      const prev = liveTickCounts.get(symbol) ?? 0;
      liveTickCounts.set(symbol, prev + 1);

      // Frozen-feed guard: once we've seen WARMUP_TICKS*2 ticks with no price
      // change, stop overwriting the cache with the stale value.  This lets
      // external refreshes (Binance / Yahoo Finance) stick between ticks.
      // Price changes from the real market immediately un-freeze the feed.
      const ticksSoFar  = prev + 1;
      const neverMoved  = !lastPriceChanged.get(symbol);
      const frozenFeed  = ticksSoFar >= WARMUP_TICKS * 2 && neverMoved;

      if (!frozenFeed) {
        priceCache.set(symbol, price);
        priceTimestamp.set(symbol, Date.now());
      } else {
        // Frozen feed confirmed: back-date the price timestamp so the quote
        // endpoint's 30 s age check fires immediately on the next quote call,
        // forcing a refresh from Yahoo Finance / Binance without waiting.
        priceTimestamp.set(symbol, Date.now() - 60_000);
      }

      buildCandle(symbol, price, timestamp);

      if (prev + 1 === WARMUP_TICKS) {
        logger.info({ symbol }, `Warm-up complete — ${WARMUP_TICKS} live ticks received`);
      }

      const tick: PriceTick = { symbol, price, timestamp };
      for (const cb of subscribers) {
        try {
          cb(tick);
        } catch (err) {
          logger.error({ err }, "Tick subscriber error");
        }
      }
    }
  });

  ws.on("error", (err) => {
    logger.error({ err }, "Twelve Data WS error");
  });

  ws.on("close", (code) => {
    logger.warn({ code }, "Twelve Data WS closed — reconnecting in 3s");
    if (pingInterval) clearInterval(pingInterval);
    ws = null;
    latencyBreached = false;
    latency = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectTwelveData, 3000);
  });
}

export function initTwelveData(): void {
  for (const sym of SYMBOLS) {
    if (!candleCache.has(sym)) {
      candleCache.set(sym, generateSeedCandles(sym));
      logger.info({ symbol: sym }, "Pre-seeded candle cache with synthetic data");
    }
  }
  connectTwelveData();
}
