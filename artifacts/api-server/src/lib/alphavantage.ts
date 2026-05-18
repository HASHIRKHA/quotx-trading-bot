/**
 * Alpha Vantage historical data fetcher.
 * Returns an empty array on rate-limit or API error so the datastore
 * fallback chain can cascade to Twelve Data REST → synthetic seed.
 */
import https from "https";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";

const AV_BASE = "https://www.alphavantage.co/query";

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("AV request timeout"));
    });
  });
}

interface AVTimeSeriesEntry {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. volume": string;
}

/**
 * Fetches historical OHLC candles from Alpha Vantage.
 * Returns [] on rate-limit (429 / Information / Note) so callers can try another source.
 */
export async function fetchHistoricalForex(symbol: string, interval = "1min"): Promise<OHLC[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    logger.warn({ symbol }, "ALPHA_VANTAGE_API_KEY not set — skipping AV");
    return [];
  }

  const avInterval = interval === "1m" ? "1min" : interval;
  const isCrypto = symbol.includes("BTC");

  let url: string;
  if (isCrypto) {
    url = `${AV_BASE}?function=CRYPTO_INTRADAY&symbol=BTC&market=USD&interval=${avInterval}&apikey=${apiKey}&outputsize=full`;
  } else {
    const [from, to] = symbol.split("/");
    url = `${AV_BASE}?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=${avInterval}&apikey=${apiKey}&outputsize=full`;
  }

  try {
    logger.info({ symbol, interval: avInterval }, "Fetching historical data from Alpha Vantage");
    const raw = await httpsGet(url);
    const json = JSON.parse(raw) as Record<string, unknown>;

    if (json["Information"] || json["Note"]) {
      logger.warn({ symbol }, "Alpha Vantage rate limited (429) — cascading to next source");
      return [];
    }

    const seriesKey = Object.keys(json).find((k) => k.includes("Time Series"));
    if (!seriesKey) {
      logger.warn({ keys: Object.keys(json), symbol }, "No time series key in AV response — cascading");
      return [];
    }

    const series = json[seriesKey] as Record<string, AVTimeSeriesEntry>;
    const candles: OHLC[] = Object.entries(series)
      .map(([timeStr, vals]) => ({
        time: Math.floor(new Date(timeStr).getTime() / 1000),
        open: parseFloat(vals["1. open"]),
        high: parseFloat(vals["2. high"]),
        low: parseFloat(vals["3. low"]),
        close: parseFloat(vals["4. close"]),
        volume: parseFloat(vals["5. volume"] ?? "1"),
      }))
      .filter((c) => !isNaN(c.open) && c.open > 0)
      .sort((a, b) => a.time - b.time);

    if (candles.length === 0) {
      logger.warn({ symbol }, "Alpha Vantage returned 0 candles — cascading");
      return [];
    }

    logger.info({ symbol, count: candles.length }, "Alpha Vantage data fetched successfully");
    return candles;
  } catch (err) {
    logger.error({ err, symbol }, "Alpha Vantage request failed — cascading");
    return [];
  }
}
