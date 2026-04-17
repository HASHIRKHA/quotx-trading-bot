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

export const SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "BTC/USD", "ETH/USD"];
const TWELVE_DATA_WS = "wss://ws.twelvedata.com/v1/quotes/price";

const priceCache = new Map<string, number>();
const candleCache = new Map<string, OHLC[]>();
const subscribers = new Set<TickCallback>();

/** Live tick counter per symbol — drives the warm-up guard */
const liveTickCounts = new Map<string, number>();

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

export function getCandles(symbol: string): OHLC[] {
  return candleCache.get(symbol) ?? [];
}

export function setCandles(symbol: string, candles: OHLC[]): void {
  candleCache.set(symbol, candles);
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

/** True once >= 5 live ticks have been received — signals can rely on real-time pressure */
export function isWarmedUp(symbol: string): boolean {
  return (liveTickCounts.get(symbol) ?? 0) >= WARMUP_TICKS;
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

      priceCache.set(symbol, price);
      buildCandle(symbol, price, timestamp);

      // Increment live tick counter for this symbol
      const prev = liveTickCounts.get(symbol) ?? 0;
      liveTickCounts.set(symbol, prev + 1);

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
