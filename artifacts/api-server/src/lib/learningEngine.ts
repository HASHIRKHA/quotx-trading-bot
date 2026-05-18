/**
 * Learning Engine — Quantum Terminal
 *
 * Reads factor weights from Supabase (cached 10 min) to feed into the signal engine.
 * Logs every signal emitted, and records outcomes when trades resolve.
 * All operations are fire-and-forget from the caller's perspective — errors are
 * swallowed so the signal/trade routes are never blocked by DB latency.
 */

import { logger } from "./logger.js";
import type { FactorResult, IndicatorValues } from "./signals.js";

// ── Supabase REST client (same pattern as routes/trades.ts) ──────────────────
const SUPABASE_URL     = process.env.SUPABASE_URL     ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey:         SUPABASE_ANON_KEY,
    Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer:         "return=representation",
    ...extra,
  };
}

async function sbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders({ Prefer: "return=representation" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`SB GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function sbPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method:  "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`SB POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function sbPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method:  "PATCH",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`SB PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Factor weight cache ───────────────────────────────────────────────────────
// Refreshed from Supabase every 10 minutes so the signal engine always uses
// the latest learned weights without adding per-request latency.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let weightCache: Map<string, number> | null = null;
let weightCacheTs = 0;
let weightCacheInFlight: Promise<Map<string, number>> | null = null;

interface FactorWeightRow {
  factor_name: string;
  weight: string | number;
}

/**
 * Returns a Map<factorName, weightMultiplier> from Supabase factor_weights.
 * Cached for 10 min. Falls back to empty map (neutral weights) on any error.
 */
export async function getFactorWeights(): Promise<Map<string, number>> {
  const now = Date.now();
  if (weightCache && now - weightCacheTs < CACHE_TTL_MS) return weightCache;

  // Coalesce concurrent callers onto one in-flight request
  if (weightCacheInFlight) return weightCacheInFlight;

  weightCacheInFlight = (async () => {
    try {
      const rows = await sbGet<FactorWeightRow[]>("factor_weights?select=factor_name,weight");
      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(row.factor_name, parseFloat(String(row.weight)));
      }
      weightCache   = map;
      weightCacheTs = Date.now();
      logger.debug({ count: map.size }, "Factor weights loaded from Supabase");
      return map;
    } catch (err) {
      logger.warn({ err }, "Failed to load factor weights — using neutral weights");
      return weightCache ?? new Map<string, number>();
    } finally {
      weightCacheInFlight = null;
    }
  })();

  return weightCacheInFlight;
}

/** Force-invalidate the weight cache (called after backtest populates weights) */
export function invalidateWeightCache(): void {
  weightCache   = null;
  weightCacheTs = 0;
}

// ── Signal logging ─────────────────────────────────────────────────────────────

interface SignalInsert {
  trade_id?:      number | null;
  symbol:         string;
  direction:      string;
  confidence:     number;
  interval_secs:  number;
  factors:        FactorResult[];
  indicators:     IndicatorValues;
  regime:         string;
}

interface SignalRow {
  id: number;
}

// In-memory map: trade_id → signal_id (for linking outcome on resolve)
const tradeSignalMap = new Map<number, number>();

// In-memory map: symbol → most recent signal_id (for linking to newly created trades)
// Keyed by symbol so each pair's last signal can be linked to the trade placed on it.
const lastSignalIdBySymbol = new Map<string, number>();

/**
 * Logs a signal to Supabase `signals` table.
 * Returns the inserted signal ID (used later to link trade outcome).
 * Fire-and-forget safe — never throws.
 */
export async function logSignal(
  symbol:        string,
  direction:     string,
  confidence:    number,
  intervalSecs:  number,
  factors:       FactorResult[],
  indicators:    IndicatorValues,
  regime:        string,
  tradeId?:      number | null,
): Promise<number | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const payload: SignalInsert = {
      trade_id:     tradeId ?? null,
      symbol,
      direction,
      confidence,
      interval_secs: intervalSecs,
      factors:      factors as unknown as FactorResult[],
      indicators,
      regime,
    };

    const rows = await sbPost<SignalRow[]>("signals", payload);
    const signalId = rows?.[0]?.id ?? null;

    if (signalId) {
      // Track latest signal per symbol so trade creation can link it
      lastSignalIdBySymbol.set(symbol, signalId);
      if (tradeId) {
        tradeSignalMap.set(tradeId, signalId);
      }
    }

    logger.debug({ symbol, direction, confidence, signalId }, "Signal logged");
    return signalId;
  } catch (err) {
    logger.warn({ err, symbol }, "Signal log failed (non-fatal)");
    return null;
  }
}

/**
 * Links an existing signal to a newly created trade.
 * Called immediately after POST /trades returns the trade ID.
 */
export async function linkSignalToTrade(
  signalId: number,
  tradeId:  number,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    tradeSignalMap.set(tradeId, signalId);
    await sbPatch<unknown>(`signals?id=eq.${signalId}`, { trade_id: tradeId });
    logger.debug({ signalId, tradeId }, "Signal linked to trade");
  } catch (err) {
    logger.warn({ err }, "Signal→trade link failed (non-fatal)");
  }
}

/**
 * Links the most recently logged signal for a given symbol to a newly created trade.
 * Queries Supabase for the most recent unlinked signal within the last 60 s — this avoids
 * the in-memory race condition where the async logSignal insert may not have returned yet.
 * Called immediately after POST /trades succeeds so the trigger can find it on resolve.
 * Fire-and-forget safe — never throws.
 */
export async function linkLastSignalToTrade(
  symbol:  string,
  tradeId: number,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    // Small delay to allow the fire-and-forget logSignal insert to land first
    await new Promise((r) => setTimeout(r, 800));

    // Try in-memory map first (fastest path when logSignal already completed)
    let signalId = lastSignalIdBySymbol.get(symbol) ?? null;

    // Fall back to DB query: most recent unlinked signal for this symbol in last 60 s
    if (!signalId) {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const rows = await sbGet<{ id: number }[]>(
        `signals?symbol=eq.${encodeURIComponent(symbol)}&trade_id=is.null&created_at=gte.${cutoff}&select=id&order=created_at.desc&limit=1`,
      );
      signalId = rows?.[0]?.id ?? null;
    }

    if (!signalId) {
      logger.debug({ symbol, tradeId }, "No recent unlinked signal to link");
      return;
    }

    // Clear map entry so next trade for this symbol starts fresh
    lastSignalIdBySymbol.delete(symbol);
    tradeSignalMap.set(tradeId, signalId);

    await sbPatch<unknown>(`signals?id=eq.${signalId}`, { trade_id: tradeId });
    logger.debug({ signalId, tradeId, symbol }, "Signal linked to trade");
  } catch (err) {
    logger.warn({ err, symbol, tradeId }, "Signal→trade link failed (non-fatal)");
  }
}

/**
 * Records the outcome of a trade onto the linked signal row.
 * The Supabase trigger `trg_learn_from_trade` fires from the trades UPDATE
 * and updates factor_weights + market_patterns automatically.
 * This function just keeps the signals table in sync.
 * Fire-and-forget safe — never throws.
 */
export async function recordSignalOutcome(
  tradeId: number,
  outcome: string,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    // Find signal by trade_id
    const rows = await sbGet<{ id: number }[]>(
      `signals?trade_id=eq.${tradeId}&select=id&order=created_at.desc&limit=1`,
    );
    if (!rows || rows.length === 0) return;

    const signalId = rows[0].id;
    await sbPatch<unknown>(`signals?id=eq.${signalId}`, {
      outcome,
      resolved_at: new Date().toISOString(),
    });

    // Invalidate weight cache so next signal fetch picks up updated weights
    invalidateWeightCache();

    logger.debug({ tradeId, signalId, outcome }, "Signal outcome recorded");
  } catch (err) {
    logger.warn({ err, tradeId }, "Signal outcome record failed (non-fatal)");
  }
}

// ── Quotex signal snapshot logging ────────────────────────────────────────────
// Stores every instruments/list parse to Supabase `quotex_signals_log`.
// This gives the AI training data even when no trade is placed — it can learn
// which Quotex call/put signals correlate with profitable outcomes.

interface QuotexSignalLogRow {
  asset:         string;
  direction:     string;   // "call" | "put"
  period:        number;
  body_size:     number;
  is_open:       boolean;
  snapshot_at:   string;   // ISO timestamp of the instruments/list parse
}

// Deduplicate snapshots: only log if it's been >90s since last batch for any asset.
// instruments/list fires every ~120s so we don't want to log duplicates on reconnect.
let lastSnapshotAt = 0;

/**
 * Batch-inserts the full Quotex signal snapshot to `quotex_signals_log`.
 * Called after every successful instruments/list parse (~every 120s).
 * Fire-and-forget — never throws, never blocks the WS handler.
 */
export async function logQuotexSnapshot(
  signals: Array<{ asset: string; direction: "call" | "put"; period: number; bodySize: number; open: boolean }>,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  if (signals.length === 0) return;

  // Throttle: skip if last insert was <90s ago (reconnect de-dup)
  const now = Date.now();
  if (now - lastSnapshotAt < 90_000) return;
  lastSnapshotAt = now;

  try {
    const snapshotAt = new Date(now).toISOString();
    const rows: QuotexSignalLogRow[] = signals.map((s) => ({
      asset:       s.asset,
      direction:   s.direction,
      period:      s.period,
      body_size:   s.bodySize,
      is_open:     s.open,
      snapshot_at: snapshotAt,
    }));

    // Insert in batches of 200 to stay within Supabase row limits per request
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbPost<unknown>("quotex_signals_log", rows.slice(i, i + BATCH));
    }

    logger.info({ count: signals.length, snapshotAt }, "Quotex snapshot logged to Supabase");
  } catch (err) {
    logger.warn({ err }, "Quotex snapshot log failed (non-fatal)");
  }
}

// ── Regime detection helper ────────────────────────────────────────────────────
// Lightweight regime classifier used by the signal route to tag logged signals.

export function detectRegime(indicators: IndicatorValues): string {
  const { volatility, volumeRatio } = indicators;
  if (volatility > 0.015) return "volatile";
  if (volumeRatio > 1.3)  return "trending";
  return "ranging";
}
