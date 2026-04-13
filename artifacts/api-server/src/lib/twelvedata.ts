import WebSocket from "ws";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
}

type TickCallback = (tick: PriceTick) => void;

const SYMBOLS = ["EUR/USD", "BTC/USD"];
const TWELVE_DATA_WS = "wss://ws.twelvedata.com/v1/quotes/price";

const priceCache = new Map<string, number>();
const candleCache = new Map<string, OHLC[]>();
const subscribers = new Set<TickCallback>();

let ws: WebSocket | null = null;
let latency = 0;
let latencyBreached = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let lastPingTime = Date.now();

const LATENCY_THRESHOLD = 500;
const MAX_CANDLES = 300;

export function getPrice(symbol: string): number {
  return priceCache.get(symbol) ?? 0;
}

export function getCandles(symbol: string): OHLC[] {
  return candleCache.get(symbol) ?? [];
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

  logger.info("Connecting to Twelve Data WebSocket...");

  ws = new WebSocket(`${TWELVE_DATA_WS}?apikey=${apiKey}`);

  ws.on("open", () => {
    logger.info("Twelve Data WS connected");
    lastPingTime = Date.now();

    const subscribeMsg = {
      action: "subscribe",
      params: { symbols: SYMBOLS.join(",") },
    };
    ws!.send(JSON.stringify(subscribeMsg));
  });

  ws.on("message", (raw: Buffer | string) => {
    const now = Date.now();
    latency = now - lastPingTime;

    if (latency > LATENCY_THRESHOLD) {
      if (!latencyBreached) {
        logger.warn({ latency }, "Circuit breaker triggered — latency exceeded threshold");
        latencyBreached = true;
      }
    } else {
      latencyBreached = false;
    }

    lastPingTime = now;

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
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectTwelveData, 3000);
  });

  const pingInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 10000);

  ws.on("close", () => clearInterval(pingInterval));
}

export function initTwelveData(): void {
  connectTwelveData();
}
