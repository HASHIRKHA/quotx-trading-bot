/**
 * Autonomous Signal Resolver — Self-Learning Loop
 *
 * Runs every 60 s as a background job.
 *
 * Algorithm:
 *   1. Fetch non-NEUTRAL signals that have an entry_price, are unresolved,
 *      and are at least (interval_secs + 5s) old.
 *   2. Get the current live price from the in-memory TwelveData store.
 *   3. Compare predicted direction → actual price movement → WIN / LOSS / TIE.
 *   4. Write outcome + resolved_price + auto_resolved=true to Supabase.
 *   5. Trigger factor-weight update so the engine learns without any human trade.
 *
 * Result: every signal the system emits becomes a training sample.
 * Factor weights evolve continuously based on real prediction accuracy.
 */

import { getPrice } from "./twelvedata.js";
import { updateWeightsFromResolvedSignal, invalidateWeightCache } from "./learningEngine.js";
import { logger } from "./logger.js";
import type { FactorResult } from "./signals.js";

// ── Supabase REST helpers (mirrors learningEngine.ts pattern) ─────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

function sbHeaders(): Record<string, string> {
  return {
    apikey:          SUPABASE_ANON_KEY,
    Authorization:   `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type":  "application/json",
    Prefer:          "return=representation",
  };
}

async function sbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SB GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function sbPatch(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method:  "PATCH",
    headers: sbHeaders(),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SB PATCH ${path} → ${res.status}: ${await res.text()}`);
}

// ── Pending signal shape from Supabase ───────────────────────────────────────

interface PendingSignal {
  id:           number;
  symbol:       string;
  direction:    "UP" | "DOWN";
  confidence:   number;
  interval_secs: number;
  entry_price:  number;
  factors:      FactorResult[];
  created_at:   string;
}

// ── Price-change noise floor ─────────────────────────────────────────────────
// Moves < TIE_THRESHOLD are counted as TIE (no weight update).
// 0.01% = 10 pips for BTC at $80K → ~$8; for EUR/USD it's ~0.1 pip.
const TIE_THRESHOLD = 0.0001;

// ── Core resolver tick ────────────────────────────────────────────────────────

async function resolvePendingSignals(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    // Fetch all unresolved directional signals that have an entry_price.
    // Use a 65s lookback (minimum interval + buffer) — Node.js filters per-interval below.
    const earliest = new Date(Date.now() - 65_000).toISOString();

    const rows = await sbGet<PendingSignal[]>(
      `signals` +
      `?direction=neq.NEUTRAL` +
      `&outcome=is.null` +
      `&entry_price=not.is.null` +
      `&created_at=lt.${earliest}` +
      `&select=id,symbol,direction,confidence,interval_secs,entry_price,factors,created_at` +
      `&order=created_at.asc` +
      `&limit=200`,
    );

    if (rows.length === 0) return;

    const now   = Date.now();
    let resolved = 0;

    for (const signal of rows) {
      const signalAge = now - new Date(signal.created_at).getTime();
      const requiredAge = signal.interval_secs * 1_000 + 5_000; // interval + 5s buffer

      if (signalAge < requiredAge) continue; // not old enough yet

      // Get live price from in-memory store (fastest path — no HTTP call)
      const currentPrice = getPrice(signal.symbol);
      if (!currentPrice || currentPrice <= 0) continue;

      const entryPrice  = Number(signal.entry_price);
      const priceChange = (currentPrice - entryPrice) / entryPrice;

      let outcome: "WIN" | "LOSS" | "TIE";
      if (Math.abs(priceChange) < TIE_THRESHOLD) {
        outcome = "TIE";
      } else if (signal.direction === "UP") {
        outcome = priceChange > 0 ? "WIN" : "LOSS";
      } else {
        outcome = priceChange < 0 ? "WIN" : "LOSS";
      }

      // Persist outcome to Supabase
      await sbPatch(`signals?id=eq.${signal.id}`, {
        outcome,
        resolved_price: currentPrice,
        auto_resolved:  true,
        resolved_at:    new Date().toISOString(),
      });

      // Fire-and-forget weight update — never blocks the resolver loop
      // Pass symbol so both global and per-symbol tables are updated.
      updateWeightsFromResolvedSignal(
        signal.id,
        signal.direction,
        outcome,
        signal.factors,
        signal.symbol,
      ).catch(() => { /* non-fatal */ });

      logger.debug(
        { signalId: signal.id, symbol: signal.symbol, direction: signal.direction,
          outcome, entryPrice, currentPrice, changePct: (priceChange * 100).toFixed(4) },
        "Signal auto-resolved",
      );

      resolved++;
    }

    if (resolved > 0) {
      invalidateWeightCache(); // next signal request will reload updated weights
      logger.info({ resolved, total: rows.length }, "Auto-resolver batch complete");
    }
  } catch (err) {
    logger.warn({ err }, "Auto-resolver tick failed (non-fatal)");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let resolverTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background auto-resolver.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startAutoResolver(): void {
  if (resolverTimer) return; // already running
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.warn("Auto-resolver disabled: SUPABASE_URL / SUPABASE_ANON_KEY not set");
    return;
  }

  // Kick off one immediate run (catches any backlog from a restart)
  resolvePendingSignals().catch(() => { /* non-fatal */ });

  // Then run every 60 s
  resolverTimer = setInterval(() => {
    resolvePendingSignals().catch(() => { /* non-fatal */ });
  }, 60_000);

  logger.info("Signal auto-resolver started (60s tick)");
}

export function stopAutoResolver(): void {
  if (resolverTimer) {
    clearInterval(resolverTimer);
    resolverTimer = null;
  }
}
