import https from "https";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";
import { generateSeedCandles } from "./seedCandles.js";

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
      reject(new Error("Request timeout"));
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

export async function fetchHistoricalForex(symbol: string, interval = "1min"): Promise<OHLC[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    logger.warn("ALPHA_VANTAGE_API_KEY not set — using seed candles");
    return generateSeedCandles(symbol);
  }

  const avInterval = interval === "1m" ? "1min" : interval;
  const isCrypto = symbol.includes("BTC");
  const isForex = symbol.includes("/") && !isCrypto;

  let url: string;
  if (isCrypto) {
    url = `${AV_BASE}?function=CRYPTO_INTRADAY&symbol=BTC&market=USD&interval=${avInterval}&apikey=${apiKey}&outputsize=compact`;
  } else if (isForex) {
    const [from, to] = symbol.split("/");
    url = `${AV_BASE}?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=${avInterval}&apikey=${apiKey}&outputsize=compact`;
  } else {
    return generateSeedCandles(symbol);
  }

  try {
    logger.info({ symbol, interval: avInterval }, "Fetching historical data from Alpha Vantage");
    const raw = await httpsGet(url);
    const json = JSON.parse(raw) as Record<string, unknown>;

    if (json["Information"] || json["Note"]) {
      logger.warn({ symbol }, "Alpha Vantage rate limited — using seed candles");
      return generateSeedCandles(symbol);
    }

    const seriesKey = Object.keys(json).find((k) => k.includes("Time Series"));
    if (!seriesKey) {
      logger.warn({ keys: Object.keys(json), symbol }, "No time series key in Alpha Vantage response — using seed candles");
      return generateSeedCandles(symbol);
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
      logger.warn({ symbol }, "Alpha Vantage returned 0 candles — using seed candles");
      return generateSeedCandles(symbol);
    }

    logger.info({ symbol, count: candles.length }, "Historical data fetched from Alpha Vantage");
    return candles;
  } catch (err) {
    logger.error({ err, symbol }, "Alpha Vantage fetch failed — using seed candles");
    return generateSeedCandles(symbol);
  }
}
