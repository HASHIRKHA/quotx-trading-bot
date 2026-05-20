/**
 * Signal Cleanup — Automatic DB Retention Manager
 *
 * Runs every hour in the background.
 *
 * What it does:
 *  1. Calls cleanup_old_signals(12)  — archives resolved signal counts to
 *     signal_stats (permanent, tiny), then deletes resolved rows older than
 *     12 hours. Keeps the signals table ≤ ~75 MB instead of growing forever.
 *
 *  2. Calls cleanup_old_quotex_logs(3) — deletes Quotex snapshot rows older
 *     than 3 days. Keeps quotex_signals_log ≤ ~15 MB.
 *
 *  3. Logs current DB size % vs Supabase free-tier limit (500 MB).
 *     Emits a WARN if > 70%, ERROR if > 85% so you can act before hitting the cap.
 *
 * The AI keeps learning continuously — factor_weights and factor_weights_by_symbol
 * are permanent and never touched by this cleanup. Only raw signal rows (which
 * have zero incremental learning value once resolved + weights updated) are pruned.
 *
 * Steady-state DB size target: ~150–180 MB (30–36% of 500 MB free tier).
 */

import { logger } from "./logger.js";

const SUPABASE_URL      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const FREE_TIER_MB      = 500;
const WARN_THRESHOLD    = 70;   // % — log WARN above this
const ERROR_THRESHOLD   = 85;   // % — log ERROR above this (act immediately)

const SIGNALS_KEEP_HOURS  = 12; // keep last 12h of raw signals
const QUOTEX_KEEP_DAYS    = 3;  // keep last 3 days of Quotex snapshots
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every 60 minutes
const STARTUP_DELAY_MS    = 3 * 60 * 1000;  // 3 min after server start (let sweeper warm up first)

// ── RPC caller ────────────────────────────────────────────────────────────────

async function callRpc<T>(fnName: string, params: Record<string, unknown>): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method:  "POST",
      headers: {
        apikey:         SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body:   JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RPC ${fnName} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    logger.warn({ err, fnName }, "Cleanup RPC call failed (non-fatal)");
    return null;
  }
}

// ── Main cleanup tick ─────────────────────────────────────────────────────────

async function runCleanup(): Promise<void> {
  // 1. Prune old resolved signals (archive counts to signal_stats first)
  const signalsDeleted = await callRpc<number>("cleanup_old_signals", {
    hours_to_keep: SIGNALS_KEEP_HOURS,
  });

  // 2. Prune old Quotex snapshot rows
  const quotexDeleted = await callRpc<number>("cleanup_old_quotex_logs", {
    days_to_keep: QUOTEX_KEEP_DAYS,
  });

  // 3. Check DB size vs free-tier limit
  const pctUsed = await callRpc<number>("get_db_size_pct", {});

  const logPayload = {
    signalsDeleted:  signalsDeleted ?? 0,
    quotexDeleted:   quotexDeleted  ?? 0,
    dbSizePct:       pctUsed        ?? 0,
    freeLimitMb:     FREE_TIER_MB,
    signalsKeepHours: SIGNALS_KEEP_HOURS,
    quotexKeepDays:  QUOTEX_KEEP_DAYS,
  };

  if (pctUsed !== null && pctUsed >= ERROR_THRESHOLD) {
    logger.error(logPayload,
      `🚨 DB at ${pctUsed}% of free tier — IMMEDIATE ACTION REQUIRED`);
  } else if (pctUsed !== null && pctUsed >= WARN_THRESHOLD) {
    logger.warn(logPayload,
      `⚠️  DB at ${pctUsed}% of free tier — approaching limit`);
  } else {
    logger.info(logPayload,
      `✅ DB cleanup complete — ${pctUsed ?? '?'}% of ${FREE_TIER_MB} MB used`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the hourly cleanup scheduler.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * First run fires 3 minutes after startup (after the sweeper warms up).
 * Then runs every 60 minutes.
 */
export function startSignalCleanup(): void {
  if (cleanupTimer) return;

  // Warm-up delay — let the sweeper and resolver settle first
  setTimeout(() => {
    runCleanup().catch(() => {});
  }, STARTUP_DELAY_MS);

  cleanupTimer = setInterval(() => {
    runCleanup().catch(() => {});
  }, CLEANUP_INTERVAL_MS);

  logger.info(
    {
      signalsKeepHours: SIGNALS_KEEP_HOURS,
      quotexKeepDays:   QUOTEX_KEEP_DAYS,
      intervalMins:     CLEANUP_INTERVAL_MS / 60_000,
      warnThresholdPct: WARN_THRESHOLD,
      errorThresholdPct: ERROR_THRESHOLD,
    },
    "Signal cleanup scheduler started — DB retention active",
  );
}

export function stopSignalCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
