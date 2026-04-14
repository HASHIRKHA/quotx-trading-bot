import https from "https";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";

const TD_BASE = "https://api.twelvedata.com";

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("TD REST timeout"));
    });
  });
}

interface TDQuoteResponse {
  symbol?: string;
  close?: string;
  price?: string;
  status?: string;
  code?: number;
  message?: string;
}

interface TDOHLCEntry {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TDTimeSeriesResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: TDOHLCEntry[];
}

export async function fetchTwelveDataQuote(symbol: string): Promise<number | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;

  const url = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  try {
    const raw = await httpsGet(url);
    const json = JSON.parse(raw) as TDQuoteResponse;
    if (json.code && json.code !== 200) {
      logger.warn({ symbol, message: json.message }, "TD REST quote error");
      return null;
    }
    const price = parseFloat(json.close ?? json.price ?? "");
    if (isNaN(price) || price <= 0) return null;
    logger.info({ symbol, price }, "TD REST quote fetched");
    return price;
  } catch (err) {
    logger.error({ err, symbol }, "TD REST quote failed");
    return null;
  }
}

export async function fetchTwelveDataHistory(
  symbol: string,
  interval = "1min",
  outputsize = 100,
): Promise<OHLC[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    logger.warn("TWELVE_DATA_API_KEY not set — cannot fetch TD REST history");
    return [];
  }

  const url =
    `${TD_BASE}/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

  try {
    logger.info({ symbol, interval }, "Fetching historical data from Twelve Data REST");
    const raw = await httpsGet(url);
    const json = JSON.parse(raw) as TDTimeSeriesResponse;

    if (json.code && json.code !== 200) {
      logger.warn({ symbol, message: json.message }, "TD REST time series error");
      return [];
    }

    if (!Array.isArray(json.values) || json.values.length === 0) {
      logger.warn({ symbol }, "TD REST returned no values");
      return [];
    }

    const candles: OHLC[] = json.values
      .map((v) => ({
        time: Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseFloat(v.volume ?? "1"),
      }))
      .filter((c) => !isNaN(c.open) && c.open > 0)
      .sort((a, b) => a.time - b.time);

    logger.info({ symbol, count: candles.length }, "TD REST history fetched");
    return candles;
  } catch (err) {
    logger.error({ err, symbol }, "TD REST history fetch failed");
    return [];
  }
}
