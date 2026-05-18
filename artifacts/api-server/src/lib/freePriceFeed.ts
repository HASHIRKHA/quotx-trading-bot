/**
 * Free public price feed.
 * Sources:
 *   Crypto → Binance public REST (no API key, 1200 req/min weight limit)
 *   XAU    → Yahoo Finance gold futures GC=F (free, no key, with User-Agent)
 *
 * Replaces the previous CoinGecko (rate-limited) + open.er-api.com (broken XAU).
 * Used as the real-price baseline when Twelve Data is absent or frozen,
 * and to anchor synthetic candle seeds to actual current market prices.
 *
 * fetchBinanceCandles() — returns 400 real 1-min OHLCV candles from Binance.
 *   Used as a free fallback when TwelveData API credits are exhausted.
 *   No API key required. Rate limit: 20 req/min (weight 2 per klines call).
 *
 * fetchYahooCandles() — returns up to 400 1-min OHLCV candles for XAU/USD
 *   from Yahoo Finance GC=F. Gold markets close on weekends; on weekdays
 *   this provides real intraday candles. Returns [] outside market hours.
 */

import https from "https";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";

/** HTTPS GET with optional extra headers */
function httpsGet(url: string, extraHeaders: Record<string, string> = {}, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port ? parseInt(parsed.port, 10) : 443,
      path:     parsed.pathname + parsed.search,
      method:   "GET" as const,
      headers:  extraHeaders,
    };
    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer | string) => (data += chunk.toString()));
      res.on("end", () => {
        if ((res.statusCode ?? 200) >= 400) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Free price feed request timeout"));
    });
  });
}

// ── Binance public REST ────────────────────────────────────────────────────────
interface BinanceTickerPrice {
  symbol: string;
  price:  string;
}

// ── Yahoo Finance chart response (minimal shape) ──────────────────────────────
interface YFChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
    }>;
  };
}

export interface FreePrices {
  "BTC/USD"?: number;
  "ETH/USD"?: number;
  "XAU/USD"?: number;
  "SOL/USD"?: number;
}

// Binance symbol map: our symbol → Binance trading pair
const BINANCE_MAP: Array<[keyof FreePrices, string]> = [
  ["BTC/USD", "BTCUSDT"],
  ["ETH/USD", "ETHUSDT"],
  ["SOL/USD", "SOLUSDT"],
];

// Shared browser-like UA header — required by Yahoo Finance
const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; price-feed/1.0)",
  "Accept": "application/json",
};

/**
 * Fetches real current prices from free public APIs.
 * Returns only the pairs that could be successfully fetched.
 * Never throws — callers fall back to synthetic defaults on error.
 *
 * Sources:
 *   BTC/ETH/SOL → Binance public REST (no API key, very high rate limits)
 *   XAU/USD     → Yahoo Finance GC=F gold futures (free, no key)
 */
export async function fetchFreePrices(): Promise<FreePrices> {
  const prices: FreePrices = {};

  // ── Crypto: BTC, ETH, SOL (Binance public REST — no key required) ─────────
  // Fetch all three in parallel to minimise total latency.
  // Binance free-tier weight limit: 1200/min — each call is weight 1.
  try {
    const results = await Promise.allSettled(
      BINANCE_MAP.map(([, binSym]) =>
        httpsGet(`https://api.binance.com/api/v3/ticker/price?symbol=${binSym}`)
      )
    );

    for (let i = 0; i < BINANCE_MAP.length; i++) {
      const [ourSym] = BINANCE_MAP[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        const json = JSON.parse(result.value) as BinanceTickerPrice;
        const p = parseFloat(json.price);
        if (p > 0) {
          prices[ourSym] = ourSym === "SOL/USD" ? parseFloat(p.toFixed(4)) : p;
        }
      }
    }

    logger.info(
      { btc: prices["BTC/USD"], eth: prices["ETH/USD"], sol: prices["SOL/USD"] },
      "Binance crypto prices fetched",
    );
  } catch (err) {
    logger.warn({ err }, "Binance batch fetch failed — crypto prices unavailable");
  }

  // ── Gold: XAU/USD via Yahoo Finance gold futures (GC=F) ───────────────────
  // Yahoo Finance chart endpoint returns the current gold futures price in USD.
  // Free, no API key required. Requires a browser-like User-Agent header.
  try {
    const raw = await httpsGet(
      "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d",
      YF_HEADERS,
    );
    const json = JSON.parse(raw) as YFChartResponse;
    const marketPrice = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (marketPrice && marketPrice > 0) {
      prices["XAU/USD"] = parseFloat(marketPrice.toFixed(2));
    }
    logger.info({ xau: prices["XAU/USD"] }, "XAU/USD fetched from Yahoo Finance (GC=F)");
  } catch (err) {
    logger.warn({ err }, "Yahoo Finance XAU fetch failed — XAU price unavailable");
  }

  return prices;
}

// ── Binance klines (OHLCV) ─────────────────────────────────────────────────────
// Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

/** Map of our symbols to Binance trading pairs for klines fetch */
const BINANCE_KLINES_MAP: Array<[string, string]> = [
  ["BTC/USD", "BTCUSDT"],
  ["ETH/USD", "ETHUSDT"],
  ["SOL/USD", "SOLUSDT"],
];

/**
 * Fetch up to `limit` real 1-min candles from Binance for a given symbol.
 * Returns OHLC[] in ascending time order.
 * Never throws — returns [] on any error.
 * Cost: weight=2 per call. Limit: 1200 weight/min for anonymous requests.
 */
export async function fetchBinanceCandles(symbol: string, limit = 400): Promise<OHLC[]> {
  const entry = BINANCE_KLINES_MAP.find(([s]) => s === symbol);
  if (!entry) return [];
  const [, binSym] = entry;
  try {
    const raw = await httpsGet(
      `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=1m&limit=${limit}`,
    );
    const rows = JSON.parse(raw) as BinanceKline[];
    const candles: OHLC[] = rows.map((r) => ({
      time:   Math.floor(r[0] / 1000),
      open:   parseFloat(r[1]),
      high:   parseFloat(r[2]),
      low:    parseFloat(r[3]),
      close:  parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }));
    logger.info({ symbol, count: candles.length }, "Binance klines fetched");
    return candles;
  } catch (err) {
    logger.warn({ err, symbol }, "Binance klines fetch failed");
    return [];
  }
}

// ── Yahoo Finance OHLCV (XAU/USD) ─────────────────────────────────────────────
interface YFChartResult {
  meta?: { regularMarketPrice?: number };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YFKlinesResponse {
  chart?: { result?: YFChartResult[] };
}

/**
 * Fetch real 1-min OHLCV candles for XAU/USD from Yahoo Finance GC=F.
 * Gold markets close on weekends — returns [] when market is closed.
 * Never throws — returns [] on any error.
 */
export async function fetchYahooCandles(limit = 400): Promise<OHLC[]> {
  try {
    // range=5d gives ~5 days of 1-min bars; trim to the last `limit` candles.
    const raw = await httpsGet(
      "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=5d",
      YF_HEADERS,
    );
    const json = JSON.parse(raw) as YFKlinesResponse;
    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!timestamps.length || !quote) return [];

    const candles: OHLC[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i] ?? 0;
      if (o == null || h == null || l == null || c == null) continue;
      if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
      candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: v ?? 0 });
    }

    // Return last `limit` candles in ascending order
    const trimmed = candles.slice(-limit);
    logger.info({ count: trimmed.length }, "Yahoo Finance XAU klines fetched");
    return trimmed;
  } catch (err) {
    logger.warn({ err }, "Yahoo Finance XAU klines fetch failed");
    return [];
  }
}
