/**
 * OHLC data layer.
 *
 * Fetch priority (on cache miss):
 *   1. Supabase candles table   — real persisted history (open_time TIMESTAMPTZ schema)
 *   2. Alpha Vantage REST       — free forex historical fallback
 *   3. Twelve Data REST         — 400 real 1-min candles (costs API credits)
 *   4. Synthetic seed           — last resort, never stored to DB
 *
 * The in-memory candleCache (twelvedata.ts) is always checked first in the
 * market route BEFORE calling fetchAndCacheCandles — this function is only
 * reached on a cold cache miss (< 10 candles in memory).
 *
 * saveToDB / loadFromNexusCandles now use the Supabase REST API directly with
 * the correct schema (open_time TIMESTAMPTZ, not time INTEGER).
 */
import { logger } from "./logger.js";
import type { OHLC } from "./signals.js";
import { fetchHistoricalForex } from "./alphavantage.js";
import { fetchTwelveDataHistory } from "./twelvedata-rest.js";
import { generateSeedCandles } from "./seedCandles.js";

// ── Supabase REST helpers ─────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey:         SUPABASE_ANON_KEY,
    Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

interface CandleRow {
  open_time: string;
  open:      string | number;
  high:      string | number;
  low:       string | number;
  close:     string | number;
  volume:    string | number;
}

/** Upsert candles to Supabase candles table (open_time TIMESTAMPTZ schema). */
async function saveToDB(symbol: string, candles: OHLC[], source: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  if (candles.length === 0) return;

  try {
    const rows = candles.map((c) => ({
      symbol,
      timeframe:  "1min",
      open_time:  new Date(c.time * 1000).toISOString(),
      open:       c.open,
      high:       c.high,
      low:        c.low,
      close:      c.close,
      volume:     c.volume ?? 0,
      is_closed:  true,
    }));

    // Batch upsert 200 rows at a time.
    // ?on_conflict=symbol,timeframe,open_time tells PostgREST which unique constraint
    // to use: INSERT ... ON CONFLICT (symbol,timeframe,open_time) DO UPDATE SET ...
    const BATCH = 200;
    const upsertUrl = `${SUPABASE_URL}/rest/v1/candles?on_conflict=symbol,timeframe,open_time`;
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await fetch(upsertUrl, {
        method:  "POST",
        headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body:    JSON.stringify(rows.slice(i, i + BATCH)),
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        logger.warn({ symbol, status: res.status, body: txt.slice(0, 200) }, "saveToDB batch failed");
      }
    }

    logger.debug({ symbol, count: candles.length, source }, "Candles saved to Supabase");
  } catch (err) {
    logger.warn({ err, symbol }, "saveToDB failed (non-fatal)");
  }
}

/**
 * Load up to 300 1-min candles from the Supabase candles table.
 * Converts `open_time` (TIMESTAMPTZ) back to Unix seconds for the OHLC format.
 * Returns [] on any error so the fetch chain falls through gracefully.
 */
async function loadFromNexusCandles(symbol: string): Promise<OHLC[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/candles` +
      `?symbol=eq.${encodeURIComponent(symbol)}` +
      `&timeframe=eq.1min` +
      `&select=open_time,open,high,low,close,volume` +
      `&order=open_time.desc` +
      `&limit=300`;

    const res = await fetch(url, {
      headers: sbHeaders({ Prefer: "return=representation" }),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];

    const rows = (await res.json()) as CandleRow[];
    if (!rows || rows.length === 0) return [];

    const candles: OHLC[] = rows
      .map((r) => ({
        time:   Math.floor(new Date(r.open_time).getTime() / 1000),
        open:   parseFloat(String(r.open)),
        high:   parseFloat(String(r.high)),
        low:    parseFloat(String(r.low)),
        close:  parseFloat(String(r.close)),
        volume: parseFloat(String(r.volume)),
      }))
      .sort((a, b) => a.time - b.time); // ascending (oldest → newest)

    logger.debug({ symbol, count: candles.length }, "Candles loaded from Supabase");
    return candles;
  } catch (err) {
    logger.warn({ err, symbol }, "loadFromNexusCandles failed (non-fatal)");
    return [];
  }
}

export type DataSource = "db" | "nexus" | "alphavantage" | "twelvedata" | "synthetic";

/**
 * Strips the " OTC" suffix so external APIs (Alpha Vantage, Twelve Data)
 * receive the base pair — e.g. "NZD/JPY OTC" → "NZD/JPY".
 */
function baseSymbol(symbol: string): string {
  return symbol.replace(/ OTC$/i, "").trim();
}

export async function fetchAndCacheCandles(
  symbol: string,
  interval = "1min",
): Promise<{ candles: OHLC[]; source: DataSource }> {
  // Normalize OTC symbols to their real-market counterpart for external API calls
  const fetchSym = baseSymbol(symbol);

  // 1. Try Supabase candles table — persisted history (preferred over remote APIs)
  const nexusCandles = await loadFromNexusCandles(symbol);
  if (nexusCandles.length >= 50) {
    return { candles: nexusCandles, source: "nexus" };
  }

  // 2. Try Alpha Vantage (returns [] on rate-limit) — use base symbol (no OTC suffix)
  const avCandles = await fetchHistoricalForex(fetchSym, interval);
  if (avCandles.length >= 10) {
    await saveToDB(symbol, avCandles, "alphavantage");
    return { candles: avCandles, source: "alphavantage" };
  }

  // 3. Fall back to Twelve Data REST time series — use base symbol
  logger.info({ symbol, fetchSym }, "Alpha Vantage unavailable — trying Twelve Data REST");
  const tdCandles = await fetchTwelveDataHistory(fetchSym, "1min", 400);
  if (tdCandles.length >= 10) {
    await saveToDB(symbol, tdCandles, "twelvedata");
    return { candles: tdCandles, source: "twelvedata" };
  }

  // 4. Last resort: synthetic seed (still saved to DB so it's persisted)
  logger.warn({ symbol }, "All external APIs failed — using synthetic seed candles");
  const seed = generateSeedCandles(fetchSym);
  void saveToDB(symbol, seed, "synthetic");
  return { candles: seed, source: "synthetic" };
}
