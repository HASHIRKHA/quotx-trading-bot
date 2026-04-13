import https from "https";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";

const AV_BASE = "https://www.alphavantage.co/query";

const SYMBOL_MAP: Record<string, string> = {
  "EUR/USD": "EURUSD",
  "BTC/USD": "BTCUSD",
};

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
    logger.warn("ALPHA_VANTAGE_API_KEY not set");
    return [];
  }

  const avSymbol = SYMBOL_MAP[symbol];
  if (!avSymbol) return [];

  const isForex = symbol.includes("/") && !symbol.includes("BTC");
  const isCrypto = symbol.includes("BTC");

  let url: string;
  if (isCrypto) {
    url = `${AV_BASE}?function=CRYPTO_INTRADAY&symbol=BTC&market=USD&interval=${interval}&apikey=${apiKey}&outputsize=compact`;
  } else if (isForex) {
    const [from, to] = symbol.split("/");
    url = `${AV_BASE}?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=${interval}&apikey=${apiKey}&outputsize=compact`;
  } else {
    return [];
  }

  try {
    logger.info({ symbol, interval }, "Fetching historical data from Alpha Vantage");
    const raw = await httpsGet(url);
    const json = JSON.parse(raw) as Record<string, unknown>;

    const seriesKey = Object.keys(json).find((k) => k.includes("Time Series"));
    if (!seriesKey) {
      logger.warn({ keys: Object.keys(json), symbol }, "No time series key found in Alpha Vantage response");
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

    logger.info({ symbol, count: candles.length }, "Historical data fetched");
    return candles;
  } catch (err) {
    logger.error({ err, symbol }, "Failed to fetch historical data from Alpha Vantage");
    return [];
  }
}
