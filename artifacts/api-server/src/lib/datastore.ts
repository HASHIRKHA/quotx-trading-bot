/**
 * DB-first OHLC data layer.
 * Fetch priority:  PostgreSQL → Alpha Vantage → Twelve Data REST → synthetic seed
 * Real data is always persisted so subsequent requests use the DB and preserve API credits.
 */
import { db, candlesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";
import { fetchHistoricalForex } from "./alphavantage.js";
import { fetchTwelveDataHistory } from "./twelvedata-rest.js";
import { generateSeedCandles } from "./seedCandles.js";

/** Re-fetch from APIs if DB rows are older than this (ms) */
const DB_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

async function loadFromDB(symbol: string): Promise<OHLC[]> {
  try {
    const rows = await db
      .select()
      .from(candlesTable)
      .where(eq(candlesTable.symbol, symbol))
      .orderBy(candlesTable.time);

    if (rows.length === 0) return [];

    const newest = rows[rows.length - 1];
    const ageMs = Date.now() - new Date(newest.fetchedAt).getTime();
    if (ageMs > DB_CACHE_TTL_MS) {
      logger.info({ symbol, ageMs }, "DB candles stale — refreshing from API");
      return [];
    }

    logger.info({ symbol, count: rows.length }, "Loaded candles from PostgreSQL cache");
    return rows.map((r) => ({
      time: r.time,
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume ?? "1"),
    }));
  } catch (err) {
    logger.error({ err, symbol }, "DB candle read failed");
    return [];
  }
}

async function saveToDB(symbol: string, candles: OHLC[], source: string): Promise<void> {
  if (candles.length === 0) return;
  try {
    const rows = candles.map((c) => ({
      symbol,
      time: c.time,
      open: c.open.toString(),
      high: c.high.toString(),
      low: c.low.toString(),
      close: c.close.toString(),
      volume: (c.volume ?? 1).toString(),
      source,
      fetchedAt: new Date(),
    }));

    await db
      .insert(candlesTable)
      .values(rows)
      .onConflictDoUpdate({
        target: [candlesTable.symbol, candlesTable.time],
        set: {
          open: candlesTable.open,
          high: candlesTable.high,
          low: candlesTable.low,
          close: candlesTable.close,
          volume: candlesTable.volume,
          source: candlesTable.source,
          fetchedAt: new Date(),
        },
      });

    logger.info({ symbol, count: rows.length, source }, "Persisted candles to PostgreSQL");
  } catch (err) {
    logger.error({ err, symbol }, "DB candle write failed");
  }
}

export type DataSource = "db" | "alphavantage" | "twelvedata" | "synthetic";

export async function fetchAndCacheCandles(
  symbol: string,
  interval = "1min",
): Promise<{ candles: OHLC[]; source: DataSource }> {
  // 1. Try PostgreSQL first
  const cached = await loadFromDB(symbol);
  if (cached.length >= 50) {
    return { candles: cached, source: "db" };
  }

  // 2. Try Alpha Vantage (returns [] on rate-limit)
  const avCandles = await fetchHistoricalForex(symbol, interval);
  if (avCandles.length >= 10) {
    await saveToDB(symbol, avCandles, "alphavantage");
    return { candles: avCandles, source: "alphavantage" };
  }

  // 3. Fall back to Twelve Data REST time series
  logger.info({ symbol }, "Alpha Vantage unavailable — trying Twelve Data REST");
  const tdCandles = await fetchTwelveDataHistory(symbol, "1min", 100);
  if (tdCandles.length >= 10) {
    await saveToDB(symbol, tdCandles, "twelvedata");
    return { candles: tdCandles, source: "twelvedata" };
  }

  // 4. Last resort: synthetic seed (not persisted to DB)
  logger.warn({ symbol }, "All external APIs failed — using synthetic seed candles");
  return { candles: generateSeedCandles(symbol), source: "synthetic" };
}
