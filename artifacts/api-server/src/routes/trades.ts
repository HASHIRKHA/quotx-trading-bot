import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  CreateSimulatedTradeBody,
  ResolveSimulatedTradeParams,
  ResolveSimulatedTradeBody,
  GetTradeHistoryQueryParams,
  GetTradeStatsQueryParams,
} from "@workspace/api-zod";
import { recordSignalOutcome, linkLastSignalToTrade } from "../lib/learningEngine.js";

const router: IRouter = Router();

// ── Supabase HTTP REST client ─────────────────────────────────────────────────
// Uses fetch() to call PostgREST — avoids direct TCP issues with Supabase free tier.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// Fetch one attempt with AbortController timeout
async function sbFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Retry once on PGRST002 (schema cache not ready) with 5s back-off.
// Uses 30s timeout per attempt so we always receive the 503 body before aborting.
async function sbRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const PER_ATTEMPT_MS = 30_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await sbFetch(url, init, PER_ATTEMPT_MS);
    if (res.status === 503) {
      const text = await res.text();
      if (attempt === 0 && text.includes("PGRST002")) {
        // Schema cache not ready yet — wait and retry once
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
      throw new Error(`Supabase HTTP 503: ${text}`);
    }
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
  throw new Error("Supabase returned 503 PGRST002 twice — schema cache still loading");
}

async function sbGet<T>(path: string): Promise<T> {
  return sbRequest<T>(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(),
  });
}

async function sbPost<T>(path: string, body: unknown): Promise<T> {
  return sbRequest<T>(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: sbHeaders({ "Prefer": "return=representation" }),
    body: JSON.stringify(body),
  });
}

async function sbPatch<T>(path: string, body: unknown): Promise<T> {
  return sbRequest<T>(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: sbHeaders({ "Prefer": "return=representation" }),
    body: JSON.stringify(body),
  });
}

// ── In-memory fallback store ──────────────────────────────────────────────────
// Used automatically when Supabase PostgREST is unavailable (e.g. free-tier pause/resume).
// Cleared on server restart; all CRUD works identically to the DB-backed paths.
interface MemTrade {
  id: number;
  symbol: string;
  direction: string;
  entry_price: string;
  exit_price: string | null;
  confidence: string;
  expiry_seconds: number;
  binary_result: string | null;
  reasons: string[];
  created_at: string;
  closed_at: string | null;
}

let memIdCounter = 900_000; // high range avoids collision with real DB IDs
const memStore = new Map<number, MemTrade>();
let sbAvailable: boolean | null = null; // null = untested
let sbLastCheck = 0;
const SB_CHECK_TTL = 60_000; // re-check every 60s

async function checkSbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (sbAvailable !== null && now - sbLastCheck < SB_CHECK_TTL) return sbAvailable;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: sbHeaders(),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    // 200 or 401 = PostgREST is responding; 503 = not ready
    sbAvailable = res.status !== 503;
    // Even if root returns ok, table queries may fail — do a quick table probe
    if (sbAvailable) {
      const probe = new AbortController();
      const pt = setTimeout(() => probe.abort(), 8_000);
      const tableRes = await fetch(`${SUPABASE_URL}/rest/v1/trades?limit=1&select=id`, {
        headers: sbHeaders(),
        signal: probe.signal,
      }).finally(() => clearTimeout(pt));
      sbAvailable = tableRes.ok || tableRes.status === 406; // 406 = no rows, still up
    }
  } catch {
    sbAvailable = false;
  }
  sbLastCheck = Date.now();
  return sbAvailable;
}

function memTradeToRow(t: MemTrade): Record<string, unknown> {
  return { ...t };
}

function computeStats(trades: MemTrade[], symbol?: string) {
  const filtered = symbol ? trades.filter((t) => t.symbol === symbol) : trades;
  const sorted = [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let wins = 0, losses = 0, pending = 0, confSum = 0, confCount = 0;
  let bestStreak = 0, streak = 0;
  for (const r of sorted) {
    if (r.binary_result === "WIN") { wins++; streak++; if (streak > bestStreak) bestStreak = streak; }
    else if (r.binary_result === "LOSS") { losses++; streak = 0; }
    else pending++;
    const conf = parseFloat(r.confidence);
    if (!isNaN(conf)) { confSum += conf; confCount++; }
  }
  const lastResult = sorted.length > 0 ? sorted[sorted.length - 1].binary_result : null;
  const decisive = wins + losses;
  return {
    totalTrades: sorted.length,
    wins,
    losses,
    pending,
    winRate: decisive > 0 ? (wins / decisive) * 100 : 0,
    avgConfidence: confCount > 0 ? (confSum / confCount) * 100 : 0,
    bestStreak,
    currentStreak: lastResult === "WIN" ? streak : 0,
  };
}

// ── Row mapper ────────────────────────────────────────────────────────────────
// Normalises raw DB rows (snake_case, CALL/PUT direction, decimal confidence)
// to the API shape the frontend expects.
function mapTradeRow(r: Record<string, unknown>) {
  const dir = String(r.direction ?? "");
  return {
    id: r.id,
    symbol: r.symbol,
    direction: dir === "CALL" ? "UP" : dir === "PUT" ? "DOWN" : dir,
    entryPrice: parseFloat(String(r.entry_price ?? "0")),
    exitPrice: r.exit_price != null ? parseFloat(String(r.exit_price)) : null,
    confidence: parseFloat(String(r.confidence ?? "0")) * 100,
    expirySeconds: r.expiry_seconds ?? 60,
    outcome: r.binary_result ?? null,
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    createdAt: r.created_at instanceof Date
      ? (r.created_at as Date).toISOString()
      : String(r.created_at),
    resolvedAt: r.closed_at
      ? (r.closed_at instanceof Date ? (r.closed_at as Date).toISOString() : String(r.closed_at))
      : null,
  };
}

// ── Stats cache ───────────────────────────────────────────────────────────────
let statsCache: { data: Record<string, unknown>; ts: number } | null = null;
const STATS_CACHE_MS = 20_000;

// ── GET /trades ───────────────────────────────────────────────────────────────
router.get("/trades", async (req, res): Promise<void> => {
  try {
    const qp = GetTradeHistoryQueryParams.safeParse(req.query);
    const symbol = qp.success ? qp.data.symbol : undefined;
    const limit = qp.success ? (qp.data.limit ?? 50) : 50;

    if (await checkSbAvailable()) {
      let path = `trades?select=id,symbol,direction,entry_price,exit_price,confidence,expiry_seconds,binary_result,reasons,created_at,closed_at&order=created_at.desc&limit=${limit}`;
      if (symbol) path += `&symbol=eq.${encodeURIComponent(symbol)}`;
      const rows = await sbGet<Record<string, unknown>[]>(path);
      res.json(rows.map(mapTradeRow));
      return;
    }

    // In-memory fallback
    let trades = [...memStore.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (symbol) trades = trades.filter((t) => t.symbol === symbol);
    res.json(trades.slice(0, limit).map((t) => mapTradeRow(memTradeToRow(t))));
  } catch (err) {
    req.log?.error({ err }, "GET /trades failed — falling back to memory store");
    let trades = [...memStore.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const qp = GetTradeHistoryQueryParams.safeParse(req.query);
    const limit = qp.success ? (qp.data.limit ?? 50) : 50;
    res.json(trades.slice(0, limit).map((t) => mapTradeRow(memTradeToRow(t))));
  }
});

// ── POST /trades ──────────────────────────────────────────────────────────────
router.post("/trades", async (req, res): Promise<void> => {
  const parsed = CreateSimulatedTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { symbol, direction, entryPrice, confidence, expirySeconds, reasons } = parsed.data;
  const dbDirection = direction === "UP" ? "CALL" : direction === "DOWN" ? "PUT" : direction;
  const dbConfidence = (confidence / 100).toFixed(4);

  // Try Supabase first
  if (await checkSbAvailable()) {
    try {
      const rows = await sbPost<Record<string, unknown>[]>("trades", {
        symbol,
        direction: dbDirection,
        entry_price: entryPrice.toString(),
        confidence: dbConfidence,
        expiry_seconds: expirySeconds,
        reasons: reasons ?? [],
      });
      const row = rows[0];
      if (!row) throw new Error("Insert returned no row");
      statsCache = null;
      // Link the most recently logged signal for this symbol → enables trigger-based learning
      const newTradeId = row.id as number;
      linkLastSignalToTrade(symbol, newTradeId).catch(() => { /* non-fatal */ });
      res.status(201).json(mapTradeRow(row));
      return;
    } catch (err: unknown) {
      req.log?.warn({ err }, "POST /trades Supabase insert failed — falling back to memory");
      sbAvailable = false;
      sbLastCheck = Date.now();
    }
  }

  // In-memory fallback
  const id = ++memIdCounter;
  const trade: MemTrade = {
    id,
    symbol,
    direction: dbDirection,
    entry_price: entryPrice.toString(),
    exit_price: null,
    confidence: dbConfidence,
    expiry_seconds: expirySeconds ?? 60,
    binary_result: null,
    reasons: reasons ?? [],
    created_at: new Date().toISOString(),
    closed_at: null,
  };
  memStore.set(id, trade);
  statsCache = null;
  // Link signal even for in-memory trades so future Supabase reconnect can learn
  linkLastSignalToTrade(symbol, id).catch(() => { /* non-fatal */ });
  res.status(201).json(mapTradeRow(memTradeToRow(trade)));
});

// ── GET /trades/stats ─────────────────────────────────────────────────────────
router.get("/trades/stats", async (req, res): Promise<void> => {
  const ZERO_STATS = { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, avgConfidence: 0, bestStreak: 0, currentStreak: 0 };
  try {
    const qp = GetTradeStatsQueryParams.safeParse(req.query);
    const symbol = qp.success ? qp.data.symbol : undefined;

    // Serve stale cache when not symbol-filtered and cache is fresh
    if (!symbol && statsCache && Date.now() - statsCache.ts < STATS_CACHE_MS) {
      res.json(statsCache.data);
      return;
    }

    if (await checkSbAvailable()) {
      let path = "trades?select=binary_result,confidence,created_at";
      if (symbol) path += `&symbol=eq.${encodeURIComponent(symbol)}`;
      path += "&order=created_at.asc";
      const rows = await sbGet<Array<{ binary_result: string | null; confidence: string; created_at: string }>>(path);

      let wins = 0, losses = 0, pending = 0, confSum = 0, confCount = 0;
      let bestStreak = 0, streak = 0;
      for (const r of rows) {
        if (r.binary_result === "WIN") { wins++; streak++; if (streak > bestStreak) bestStreak = streak; }
        else if (r.binary_result === "LOSS") { losses++; streak = 0; }
        else pending++;
        const conf = parseFloat(r.confidence);
        if (!isNaN(conf)) { confSum += conf; confCount++; }
      }
      const decisive = wins + losses;
      const payload = {
        totalTrades: rows.length, wins, losses, pending,
        winRate: decisive > 0 ? (wins / decisive) * 100 : 0,
        avgConfidence: confCount > 0 ? (confSum / confCount) * 100 : 0,
        bestStreak,
        currentStreak: rows.length > 0 && rows[rows.length - 1].binary_result === "WIN" ? streak : 0,
      };
      if (!symbol) statsCache = { data: payload, ts: Date.now() };
      res.json(payload);
      return;
    }

    // In-memory fallback
    const payload = computeStats([...memStore.values()], symbol);
    if (!symbol) statsCache = { data: payload, ts: Date.now() };
    res.json(payload);
  } catch (err) {
    req.log?.error({ err }, "GET /trades/stats — using memory store");
    const qp = GetTradeStatsQueryParams.safeParse(req.query);
    const symbol = qp.success ? qp.data.symbol : undefined;
    if (memStore.size > 0) {
      res.json(computeStats([...memStore.values()], symbol));
      return;
    }
    if (statsCache) { res.json(statsCache.data); return; }
    res.json(ZERO_STATS);
  }
});

// ── GET /trades/performance ───────────────────────────────────────────────────
router.get("/trades/performance", async (req, res): Promise<void> => {
  const ZERO = { winRate: 0, last10Rate: 0, wins: 0, total: 0, bySymbol: [], last20: [] };
  try {
    if (await checkSbAvailable()) {
      const rows = await sbGet<Array<{
        binary_result: string | null;
        symbol: string;
        confidence: string;
        direction: string;
        created_at: string;
      }>>("trades?select=binary_result,symbol,confidence,direction,created_at&order=created_at.desc");

      const resolved = rows.filter((r) => r.binary_result != null);
      const wins = resolved.filter((r) => r.binary_result === "WIN").length;
      const total = resolved.length;
      const last10 = resolved.slice(0, 10);
      const symMap = new Map<string, { wins: number; total: number }>();
      for (const r of resolved) {
        const e = symMap.get(r.symbol) ?? { wins: 0, total: 0 };
        e.total++;
        if (r.binary_result === "WIN") e.wins++;
        symMap.set(r.symbol, e);
      }
      res.json({
        winRate: total > 0 ? (wins / total) * 100 : 0,
        last10Rate: last10.length > 0 ? (last10.filter((r) => r.binary_result === "WIN").length / last10.length) * 100 : 0,
        wins, total,
        bySymbol: [...symMap.entries()].map(([symbol, s]) => ({ symbol, wins: s.wins, total: s.total, winRate: s.total > 0 ? (s.wins / s.total) * 100 : 0 })),
        last20: resolved.slice(0, 20).map((r) => ({ outcome: r.binary_result, symbol: r.symbol, confidence: parseFloat(r.confidence) * 100, direction: r.direction === "CALL" ? "UP" : r.direction === "PUT" ? "DOWN" : r.direction })),
      });
      return;
    }

    // In-memory fallback
    const all = [...memStore.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const resolved = all.filter((t) => t.binary_result != null);
    const wins = resolved.filter((t) => t.binary_result === "WIN").length;
    const total = resolved.length;
    const last10 = resolved.slice(0, 10);
    const symMap = new Map<string, { wins: number; total: number }>();
    for (const r of resolved) {
      const e = symMap.get(r.symbol) ?? { wins: 0, total: 0 };
      e.total++;
      if (r.binary_result === "WIN") e.wins++;
      symMap.set(r.symbol, e);
    }
    res.json({
      winRate: total > 0 ? (wins / total) * 100 : 0,
      last10Rate: last10.length > 0 ? (last10.filter((t) => t.binary_result === "WIN").length / last10.length) * 100 : 0,
      wins, total,
      bySymbol: [...symMap.entries()].map(([symbol, s]) => ({ symbol, wins: s.wins, total: s.total, winRate: s.total > 0 ? (s.wins / s.total) * 100 : 0 })),
      last20: resolved.slice(0, 20).map((r) => ({ outcome: r.binary_result, symbol: r.symbol, confidence: parseFloat(r.confidence) * 100, direction: r.direction === "CALL" ? "UP" : "DOWN" })),
    });
  } catch (err) {
    req.log?.error({ err }, "GET /trades/performance failed");
    res.json(ZERO);
  }
});

// ── PATCH /trades/:id/resolve ─────────────────────────────────────────────────
router.patch("/trades/:id/resolve", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idNum = parseInt(raw, 10);
  const params = ResolveSimulatedTradeParams.safeParse({ id: idNum });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ResolveSimulatedTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const tradeId = params.data.id;

  // For real DB IDs always try Supabase directly — do NOT gate on checkSbAvailable().
  // The availability cache has a 60-second TTL; a stale "false" result would skip
  // Supabase entirely and return 404 for trades that ARE in the DB (they're not in
  // the in-memory store).  A direct attempt is more robust than relying on the cache.
  if (tradeId < 900_000) {
    try {
      const rows = await sbPatch<Record<string, unknown>[]>(
        `trades?id=eq.${tradeId}`,
        {
          exit_price: parsed.data.exitPrice.toString(),
          binary_result: parsed.data.outcome,
          closed_at: new Date().toISOString(),
        },
      );
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "Trade not found" });
        return;
      }
      statsCache = null;
      // Re-mark Supabase as available since the request just succeeded
      sbAvailable = true;
      sbLastCheck = Date.now();
      // Fire-and-forget: update signal outcome → triggers DB weight learning
      recordSignalOutcome(tradeId, parsed.data.outcome).catch(() => { /* non-fatal */ });
      res.json(mapTradeRow(row));
      return;
    } catch (err: unknown) {
      req.log?.warn({ err }, "PATCH /trades resolve Supabase failed — trying memory");
      sbAvailable = false;
      sbLastCheck = Date.now();
    }
  }

  // In-memory fallback
  const trade = memStore.get(tradeId);
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  trade.exit_price = parsed.data.exitPrice.toString();
  trade.binary_result = parsed.data.outcome;
  trade.closed_at = new Date().toISOString();
  statsCache = null;
  // Fire-and-forget: update signal outcome even for in-memory trades
  recordSignalOutcome(tradeId, parsed.data.outcome).catch(() => { /* non-fatal */ });
  res.json(mapTradeRow(memTradeToRow(trade)));
});

export default router;
