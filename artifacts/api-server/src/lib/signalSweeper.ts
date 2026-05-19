/**
 * Signal Sweeper — Autonomous Training Data Generator
 *
 * Runs every 60 s in the background and generates signals for EVERY symbol
 * across ALL three timeframes (1m, 5m, 10m).  Each directional signal is
 * logged to Supabase with entry_price so the auto-resolver can verify it
 * 60 s / 5 min / 10 min later and update per-symbol factor weights.
 *
 * Result: the AI trains on all 63 pairs × 3 intervals = 189 combinations
 * continuously, 24 / 7, with zero human interaction required.
 *
 * DB efficiency rules:
 *  - NEUTRAL signals are skipped (no learning value, saves rows)
 *  - Each (symbol, interval) is logged at most once per interval period
 *    (tracked via in-memory lastSwept map)
 *  - Sweeps are staggered with a small delay between symbols so Supabase
 *    isn't hammered with 189 simultaneous inserts
 */

import { SYMBOLS, getCandles, getHourlyCandles, getPrice, isWarmedUp } from "./twelvedata.js";
import { analyzeSignal, type OHLC } from "./signals.js";
import { getFactorWeightsBySymbol, logSignal, detectRegime } from "./learningEngine.js";
import { getSentiment } from "./sentiment.js";
import { getQuotexSignal, getQuotexAssetForSymbol } from "./quotexFeed.js";
import { logger } from "./logger.js";

// ── Interval definitions ───────────────────────────────────────────────────────

interface IntervalDef {
  secs:    number;    // interval duration in seconds
  aggMins: number;    // candle aggregation window in minutes
  label:   string;
}

const INTERVALS: IntervalDef[] = [
  { secs:  60,  aggMins:  5, label: "1m"  },
  { secs: 300,  aggMins:  5, label: "5m"  },
  { secs: 600,  aggMins: 10, label: "10m" },
];

// ── Last-swept tracker (deduplicate per symbol × interval) ─────────────────────
// Only one signal per (symbol, interval) per interval period is ever logged.

const lastSwept = new Map<string, number>(); // key: `${symbol}:${secs}` → epoch ms

// ── Candle aggregation (mirrors market.ts logic) ───────────────────────────────

function aggregateCandles(candles: OHLC[], minutesPer: number): OHLC[] {
  if (candles.length < minutesPer * 5) return [];
  const sorted     = [...candles].sort((a, b) => a.time - b.time);
  const bucketSecs = minutesPer * 60;
  const buckets    = new Map<number, OHLC[]>();
  for (const c of sorted) {
    const bucket = Math.floor(c.time / bucketSecs) * bucketSecs;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(c);
  }
  const result: OHLC[] = [];
  for (const [t, cs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({
      time:   t,
      open:   cs[0].open,
      high:   Math.max(...cs.map((c) => c.high)),
      low:    Math.min(...cs.map((c) => c.low)),
      close:  cs[cs.length - 1].close,
      volume: cs.reduce((a, c) => a + c.volume, 0),
    });
  }
  return result;
}

// ── Per-symbol × per-interval sweep ───────────────────────────────────────────

async function sweepOne(symbol: string, interval: IntervalDef): Promise<void> {
  const key = `${symbol}:${interval.secs}`;
  const now  = Date.now();
  const last = lastSwept.get(key) ?? 0;

  // Skip if swept too recently — wait at least 90% of interval before next log
  if (now - last < interval.secs * 900) return;

  // Need live candle data and a warm price
  const candles      = getCandles(symbol);
  const currentPrice = getPrice(symbol);
  if (!candles.length || !currentPrice || !isWarmedUp(symbol)) return;

  // Build signal candles: aggregate 1m bars into the target window
  const aggCandles   = aggregateCandles(candles, interval.aggMins);
  const hourlyCandles = getHourlyCandles(symbol);

  let signalCandles: OHLC[] = candles;

  if (interval.secs >= 600 && hourlyCandles.length >= 30 && aggCandles.length > 0) {
    // 10m: prefer hourly if entropy is lower (more structured), else aggregated
    const { calcEntropy } = await import("./signals.js");
    const hourlyEnt = calcEntropy(hourlyCandles.map((c) => c.close));
    const aggEnt    = calcEntropy(aggCandles.map((c) => c.close));
    signalCandles   = hourlyEnt <= aggEnt ? hourlyCandles : aggCandles;
  } else if (aggCandles.length > 0) {
    signalCandles = aggCandles;
  }

  if (signalCandles.length < 20) return; // not enough bars

  // Fetch per-symbol weights and sentiment in parallel (both cached)
  const [weights, sentimentResult] = await Promise.all([
    getFactorWeightsBySymbol(symbol),
    getSentiment(symbol).catch(() => ({ label: undefined as string | undefined })),
  ]);

  // Quotex platform signal as 9th factor (null for non-OTC during closed markets)
  const quotexAsset = getQuotexAssetForSymbol(symbol);
  const quotexSignal = quotexAsset ? getQuotexSignal(quotexAsset, interval.secs) : null;

  const signal = analyzeSignal(
    signalCandles,
    false,                      // not warming
    sentimentResult?.label,
    interval.secs,
    weights,
    quotexSignal,
  );

  // Skip NEUTRAL — no directional prediction = no learning value
  if (signal.direction === "NEUTRAL") return;

  // Mark swept BEFORE the async DB write so rapid re-calls are deduplicated
  lastSwept.set(key, now);

  const regime = detectRegime(signal.indicators);

  // Fire-and-forget — sweeper never blocks on DB latency
  logSignal(
    symbol,
    signal.direction,
    signal.confidence,
    interval.secs,
    signal.factors,
    signal.indicators,
    regime,
    null,          // trade_id linked via linkLastSignalToTrade if trade is placed
    currentPrice,  // entry_price — essential for auto-resolver outcome verification
  ).catch(() => { /* non-fatal */ });
}

// ── Full sweep across all symbols × all intervals ─────────────────────────────

async function sweepAll(): Promise<void> {
  let logged = 0;

  for (const interval of INTERVALS) {
    for (const symbol of SYMBOLS) {
      try {
        const before = lastSwept.get(`${symbol}:${interval.secs}`) ?? 0;
        await sweepOne(symbol, interval);
        if ((lastSwept.get(`${symbol}:${interval.secs}`) ?? 0) > before) logged++;
      } catch {
        // non-fatal per symbol — never let one bad pair break the sweep loop
      }

      // Small stagger between symbols to avoid hammering Supabase
      await new Promise<void>((r) => setTimeout(r, 15));
    }
  }

  if (logged > 0) {
    logger.debug({ logged }, "Signal sweeper batch complete");
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background signal sweeper.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * First sweep fires after 45 s (enough time for candles to be seeded and
 * TwelveData WebSocket to deliver its first ticks).
 * Then runs every 60 s.
 */
export function startSignalSweeper(): void {
  if (sweeperTimer) return;

  // Warm-up delay — let candle seeds and live feed settle first
  setTimeout(() => sweepAll().catch(() => {}), 45_000);

  sweeperTimer = setInterval(() => {
    sweepAll().catch(() => {});
  }, 60_000);

  logger.info(
    { symbols: SYMBOLS.length, intervals: INTERVALS.map((i) => i.label) },
    "Signal sweeper started — all pairs × [1m, 5m, 10m] every 60 s",
  );
}

export function stopSignalSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
