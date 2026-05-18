/**
 * candlePersister.ts — Supabase candle persistence for all 63 trading pairs.
 *
 * Responsibilities:
 *   1. seedAllSymbolsToSupabase()  — On startup, for each of the 63 symbols:
 *        • If DB has ≥ 100 candles → load from DB into in-memory cache (UI sees real history)
 *        • If DB has  < 100 candles → generate 300 synthetic candles, store to DB + memory
 *      Staggered 250 ms per symbol to avoid overwhelming Supabase.
 *
 *   2. startCandleFlush()          — Every 60 s, for every symbol:
 *        • Flush recent in-memory candles (last 15 min) to Supabase via upsert
 *        • Generate synthetic ticks for exotic OTC pairs (EGP, IDR, DZD) that
 *          have no external live price feed, so they always have continuous data
 *
 * All operations are non-blocking from the caller's perspective — errors are
 * swallowed so the live price feed and signal routes are never interrupted.
 */

import { logger } from "./logger.js";
import { SYMBOLS, getCandles, setCandles, setLiveTick } from "./twelvedata.js";
import { generateSeedCandles, getBasePriceForSymbol } from "./seedCandles.js";
import type { OHLC } from "./signals.js";

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

// ── Internal helpers ──────────────────────────────────────────────────────────

function toSupabaseRows(symbol: string, candles: OHLC[]) {
  return candles.map((c) => ({
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
}

/** Batch-upsert OHLC candles to Supabase, 200 rows at a time.
 *  Uses ?on_conflict=symbol,timeframe,open_time so PostgREST generates:
 *  INSERT ... ON CONFLICT (symbol,timeframe,open_time) DO UPDATE SET ...
 */
async function upsertCandles(symbol: string, candles: OHLC[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || candles.length === 0) return;

  const rows  = toSupabaseRows(symbol, candles);
  const BATCH = 200;

  // on_conflict tells PostgREST which unique constraint to use for the upsert
  const url = `${SUPABASE_URL}/rest/v1/candles?on_conflict=symbol,timeframe,open_time`;

  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(url, {
      method:  "POST",
      headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body:    JSON.stringify(rows.slice(i, i + BATCH)),
      signal:  AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      logger.warn({ symbol, status: res.status, body: txt.slice(0, 300) }, "Candle upsert batch error");
    }
  }
}

/** Returns the count of 1-min candles in Supabase for a symbol. */
async function countInDB(symbol: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 0;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candles?symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.1min&select=id`,
      {
        headers: { ...sbHeaders(), Prefer: "count=exact", Range: "0-0" },
        signal:  AbortSignal.timeout(8_000),
      },
    );
    // Content-Range header: "0-0/1234" → total = 1234
    const cr = res.headers.get("content-range") ?? "";
    const m  = cr.match(/\/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Delete ALL 1-min candles for a symbol from Supabase (used to purge stale seed data).
 * Called automatically by the sanity check when DB prices are wildly off from expected.
 */
async function deleteAllCandlesForSymbol(symbol: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/candles?symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.1min`,
      {
        method:  "DELETE",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        signal:  AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) {
      logger.info({ symbol }, "Purged stale candles from Supabase for re-seed");
    } else {
      const txt = await res.text().catch(() => "");
      logger.warn({ symbol, status: res.status, body: txt.slice(0, 200) }, "Delete candles failed");
    }
  } catch (err) {
    logger.warn({ err, symbol }, "deleteAllCandlesForSymbol error (non-fatal)");
  }
}

/** Load up to 300 most-recent 1-min candles from Supabase for a symbol.
 *
 * Time-based filter (≥ 300 minutes ago): excludes candles that pre-date the
 * current seed window. This prevents old wrong-price candles (e.g. GBP/USD at
 * 1.27 when the market has since moved to 1.34) from causing visual spikes on
 * the chart when they abut the new seed / live data.
 */
async function loadFromDB(symbol: string): Promise<OHLC[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  try {
    // Only load candles from the last 300 minutes so pre-seed wrong-price rows
    // are always excluded, regardless of how many rows exist in the DB.
    const since = new Date(Date.now() - 300 * 60 * 1000).toISOString();
    const url =
      `${SUPABASE_URL}/rest/v1/candles` +
      `?symbol=eq.${encodeURIComponent(symbol)}` +
      `&timeframe=eq.1min` +
      `&open_time=gte.${encodeURIComponent(since)}` +
      `&select=open_time,open,high,low,close,volume` +
      `&order=open_time.desc` +
      `&limit=300`;

    const res = await fetch(url, {
      headers: sbHeaders({ Prefer: "return=representation" }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const rows = (await res.json()) as Array<{
      open_time: string;
      open:  string | number;
      high:  string | number;
      low:   string | number;
      close: string | number;
      volume: string | number;
    }>;

    if (!rows || rows.length === 0) return [];

    return rows
      .map((r) => ({
        time:   Math.floor(new Date(r.open_time).getTime() / 1000),
        open:   parseFloat(String(r.open)),
        high:   parseFloat(String(r.high)),
        low:    parseFloat(String(r.low)),
        close:  parseFloat(String(r.close)),
        volume: parseFloat(String(r.volume)),
      }))
      .sort((a, b) => a.time - b.time); // ascending
  } catch (err) {
    logger.warn({ err, symbol }, "loadFromDB failed (non-fatal)");
    return [];
  }
}

// ── Exotic pair tick generator ────────────────────────────────────────────────
// USD/EGP OTC, USD/IDR OTC, USD/DZD OTC have no external live price feed.
// We generate a realistic synthetic tick every 60 s so these pairs always show
// continuous candle movement on the chart.

const EXOTIC_PAIRS: Record<string, { vol: number; decimals: number }> = {
  "USD/EGP OTC": { vol: 0.005,  decimals: 2 },
  "USD/IDR OTC": { vol: 3.0,    decimals: 0 },
  "USD/DZD OTC": { vol: 0.010,  decimals: 2 },
};

function generateExoticTick(symbol: string): void {
  const candles = getCandles(symbol);
  if (candles.length === 0) return;

  const cfg      = EXOTIC_PAIRS[symbol];
  if (!cfg) return;

  const lastClose = candles[candles.length - 1].close;
  const move      = (Math.random() - 0.5) * cfg.vol * 2;
  const newPrice  = parseFloat(Math.max(lastClose * 0.99, lastClose + move).toFixed(cfg.decimals));

  // Inject as a live tick so buildCandle() in twelvedata.ts handles it correctly
  setLiveTick(symbol, newPrice);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seed every symbol to Supabase on server startup.
 *
 * For each symbol:
 *   • DB has ≥ 100 rows → load 300 most-recent rows → set as in-memory cache
 *   • DB has  < 100 rows → generate 300 synthetic candles → push to DB + memory
 *
 * Staggered 250 ms between symbols (≈ 16 s for 63 symbols) to stay within
 * Supabase free-tier rate limits.
 */
export async function seedAllSymbolsToSupabase(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.warn("Supabase not configured — candle seed skipped");
    return;
  }

  logger.info({ total: SYMBOLS.length }, "Candle seed/load starting for all symbols");

  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i]!;

    // Stagger to avoid concurrent DB connections flooding Supabase
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 250));

    try {
      const count = await countInDB(sym);

      if (count >= 100) {
        // ── Load existing DB candles into memory so the UI shows real history ──
        const dbCandles = await loadFromDB(sym);
        if (dbCandles.length >= 50) {
          // ── Price sanity check — catch stale/wrong-price seed data ────────────
          //
          // The symptom: old seed data generated at 1.0 fallback price for pairs
          // that were missing from BASE_PRICES. The chart shows a massive spike
          // from the historical 1.0-price zone up to the real current price.
          //
          // Check strategy: compare the FIRST (oldest) candle's close to the
          // expected base price. The last candle might already be at the correct
          // price (from Deriv ticks) so checking only the last candle misses the spike.
          // Also detect large internal swings (max/min ratio > 1.3 across 5h of data).
          //
          // Fix: generate correct seed candles and UPSERT (ON CONFLICT overwrites)
          // — deletion is not used because anon key may lack DELETE RLS permission.
          const expectedBase = getBasePriceForSymbol(sym);
          const firstClose   = dbCandles[0]!.close;   // oldest (most likely wrong)
          const lastClose    = dbCandles[dbCandles.length - 1]!.close;  // most recent

          const firstVsBase  = firstClose / expectedBase;
          const internalSwing = Math.max(firstClose, lastClose) / Math.min(firstClose, lastClose);

          const isStale =
            firstVsBase < 0.25 || firstVsBase > 4.0   // first candle price is wildly off expected
            || internalSwing > 1.10;                    // or chart has >10% internal swing over 5h

          if (isStale) {
            logger.warn(
              {
                symbol:        sym,
                firstClose,
                lastClose,
                expectedBase,
                firstVsBase:   firstVsBase.toFixed(3),
                internalSwing: internalSwing.toFixed(3),
              },
              "Stale/wrong-price DB candles detected — overwriting with correct seed via upsert",
            );
            // UPSERT correct seed candles — ON CONFLICT overwrites wrong-priced rows
            // at the same timestamps without needing DELETE permission.
            // Use lastClose as the anchor price so seed matches the real current market price.
            // Generate 500 candles (8h window) to overwrite old wrong-price rows across
            // both the current and the previous seed window.
            const correctSeed = generateSeedCandles(sym, 500, lastClose);
            setCandles(sym, correctSeed);
            await upsertCandles(sym, correctSeed);
            logger.info({ symbol: sym, seeded: correctSeed.length, anchorPrice: lastClose }, "Corrected seed upserted → Supabase + memory");
          } else {
            setCandles(sym, dbCandles);
            logger.info({ symbol: sym, loaded: dbCandles.length, stored: count }, "Loaded candles from Supabase → memory");
          }
        } else {
          // Too few rows loaded — re-seed fresh
          const seedData = generateSeedCandles(sym, 300);
          setCandles(sym, seedData);
          await upsertCandles(sym, seedData);
          logger.info({ symbol: sym, seeded: seedData.length }, "Re-seeded (too few DB rows) → Supabase + memory");
        }
      } else {
        // ── Seed: generate synthetic candles, push to DB + memory ──────────────
        // Prefer existing in-memory data (may have real prices from free feed)
        const memCandles = getCandles(sym);
        const seedData   = memCandles.length >= 100 ? memCandles : generateSeedCandles(sym, 300);

        setCandles(sym, seedData);
        await upsertCandles(sym, seedData);
        logger.info({ symbol: sym, seeded: seedData.length, wasinDB: count }, "Seeded synthetic candles → Supabase + memory");
      }
    } catch (err) {
      logger.warn({ err, symbol: sym }, "Symbol candle seed/load failed (non-fatal)");
    }
  }

  logger.info("Candle seed/load complete — all 63 symbols populated");
}

/**
 * Start the background candle flush loop (runs every 60 seconds).
 *
 * Each cycle:
 *   1. For exotic OTC pairs (no live feed) — inject a synthetic price tick so the
 *      1-min candle continues building correctly.
 *   2. For every symbol — upsert the last 15 minutes of in-memory candles to
 *      Supabase so new candles generated from live ticks are persisted.
 *
 * Symbols are staggered 50 ms apart so Supabase is not hit with 63 concurrent
 * requests each minute.
 */
export function startCandleFlush(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.warn("Supabase not configured — candle flush skipped");
    return;
  }

  setInterval(async () => {
    // Candles older than 15 min don't need re-upserted (already in DB from prior flush)
    const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    let flushed  = 0;
    let errors   = 0;

    for (const sym of SYMBOLS) {
      // ── Step 1: Generate exotic-pair tick before flushing so the candle that
      //    gets written includes the latest synthetic price movement.
      if (sym in EXOTIC_PAIRS) {
        generateExoticTick(sym);
      }

      // ── Step 2: Upsert recent candles to Supabase
      try {
        const candles = getCandles(sym);
        const recent  = candles.filter((c) => c.time >= cutoff);
        if (recent.length > 0) {
          await upsertCandles(sym, recent);
          flushed++;
        }
      } catch (err) {
        errors++;
        logger.warn({ err, symbol: sym }, "Candle flush error (non-fatal)");
      }

      // 50 ms stagger between symbols
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    logger.debug({ flushed, errors, symbols: SYMBOLS.length }, "Candle flush cycle complete");
  }, 60_000);

  logger.info("Candle flush loop started (every 60 s, all 63 symbols → Supabase)");
}
