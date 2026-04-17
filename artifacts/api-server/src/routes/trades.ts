import { Router, type IRouter } from "express";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import {
  CreateSimulatedTradeBody,
  ResolveSimulatedTradeParams,
  ResolveSimulatedTradeBody,
  GetTradeHistoryQueryParams,
  GetTradeStatsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", async (req, res): Promise<void> => {
  try {
    const qp = GetTradeHistoryQueryParams.safeParse(req.query);
    const symbol = qp.success ? qp.data.symbol : undefined;
    const limit = qp.success ? (qp.data.limit ?? 50) : 50;

    const rows = await db
      .select()
      .from(tradesTable)
      .where(symbol ? eq(tradesTable.symbol, symbol) : undefined)
      .orderBy(desc(tradesTable.createdAt))
      .limit(limit);

    const mapped = rows.map((r) => ({
      ...r,
      entryPrice: parseFloat(r.entryPrice),
      exitPrice: r.exitPrice != null ? parseFloat(r.exitPrice) : null,
      confidence: parseFloat(r.confidence),
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }));

    res.json(mapped);
  } catch (err) {
    req.log?.error({ err }, "GET /trades failed — returning empty array");
    res.json([]);
  }
});

router.post("/trades", async (req, res): Promise<void> => {
  const parsed = CreateSimulatedTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { symbol, direction, entryPrice, confidence, expirySeconds, reasons } = parsed.data;

  const [trade] = await db
    .insert(tradesTable)
    .values({
      symbol,
      direction,
      entryPrice: entryPrice.toString(),
      confidence: confidence.toString(),
      expirySeconds,
      reasons: reasons as string[],
    })
    .returning();

  res.status(201).json({
    ...trade,
    entryPrice: parseFloat(trade.entryPrice),
    exitPrice: null,
    confidence: parseFloat(trade.confidence),
    reasons: Array.isArray(trade.reasons) ? trade.reasons : [],
    createdAt: trade.createdAt.toISOString(),
    resolvedAt: null,
  });
});

router.get("/trades/stats", async (req, res): Promise<void> => {
  const ZERO_STATS = { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, avgConfidence: 0, bestStreak: 0, currentStreak: 0 };
  try {
    const qp = GetTradeStatsQueryParams.safeParse(req.query);
    const symbol = qp.success ? qp.data.symbol : undefined;

    const rows = await db
      .select()
      .from(tradesTable)
      .where(symbol ? eq(tradesTable.symbol, symbol) : undefined)
      .orderBy(tradesTable.createdAt);

    const resolved = rows.filter((r) => r.outcome);
    const wins = resolved.filter((r) => r.outcome === "WIN").length;
    const losses = resolved.filter((r) => r.outcome === "LOSS").length;
    const pending = rows.filter((r) => !r.outcome).length;
    const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0;
    const avgConfidence = rows.length > 0
      ? rows.reduce((a, b) => a + parseFloat(b.confidence), 0) / rows.length
      : 0;

    let bestStreak = 0;
    let currentStreak = 0;
    let streak = 0;
    for (const r of resolved) {
      if (r.outcome === "WIN") {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
      } else {
        streak = 0;
      }
    }
    if (resolved.length > 0) {
      const last = resolved[resolved.length - 1];
      if (last.outcome === "WIN") currentStreak = streak;
    }

    res.json({ totalTrades: rows.length, wins, losses, pending, winRate, avgConfidence, bestStreak, currentStreak });
  } catch (err) {
    req.log?.error({ err }, "GET /trades/stats failed — returning zero stats");
    res.json(ZERO_STATS);
  }
});

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

  const [trade] = await db
    .update(tradesTable)
    .set({
      exitPrice: parsed.data.exitPrice.toString(),
      outcome: parsed.data.outcome,
      resolvedAt: new Date(),
    })
    .where(eq(tradesTable.id, params.data.id))
    .returning();

  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }

  res.json({
    ...trade,
    entryPrice: parseFloat(trade.entryPrice),
    exitPrice: trade.exitPrice != null ? parseFloat(trade.exitPrice) : null,
    confidence: parseFloat(trade.confidence),
    reasons: Array.isArray(trade.reasons) ? trade.reasons : [],
    createdAt: trade.createdAt.toISOString(),
    resolvedAt: trade.resolvedAt ? trade.resolvedAt.toISOString() : null,
  });
});

export default router;
