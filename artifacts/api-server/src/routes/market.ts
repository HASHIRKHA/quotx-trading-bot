import { Router, type IRouter } from "express";
import { getCandles, getPrice } from "../lib/twelvedata.js";
import { fetchHistoricalForex } from "../lib/alphavantage.js";
import { analyzeSignal } from "../lib/signals.js";
import {
  GetMarketSignalParams,
  GetHistoricalDataParams,
  GetHistoricalDataQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/market/symbols", async (_req, res): Promise<void> => {
  res.json([
    { symbol: "EUR/USD", name: "Euro / US Dollar", type: "forex" },
    { symbol: "BTC/USD", name: "Bitcoin / US Dollar", type: "crypto" },
  ]);
});

router.get("/market/historical/:symbol", async (req, res): Promise<void> => {
  const params = GetHistoricalDataParams.safeParse({ symbol: decodeURIComponent(req.params.symbol ?? "") });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const qp = GetHistoricalDataQueryParams.safeParse(req.query);
  const interval = qp.success ? (qp.data.interval ?? "1min") : "1min";

  const symbol = params.data.symbol;

  let candles = getCandles(symbol);

  if (candles.length < 10) {
    candles = await fetchHistoricalForex(symbol, interval);
  }

  res.json(candles);
});

router.get("/market/signal/:symbol", async (req, res): Promise<void> => {
  const params = GetMarketSignalParams.safeParse({ symbol: decodeURIComponent(req.params.symbol ?? "") });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const symbol = params.data.symbol;
  let candles = getCandles(symbol);

  if (candles.length < 5) {
    candles = await fetchHistoricalForex(symbol);
  }

  if (candles.length < 5) {
    res.status(400).json({ error: "Insufficient data to compute signal" });
    return;
  }

  const signal = analyzeSignal(candles);
  const currentPrice = getPrice(symbol) || candles[candles.length - 1].close;

  res.json({
    symbol,
    direction: signal.direction,
    confidence: signal.confidence,
    safeMode: signal.safeMode,
    reasons: signal.reasons,
    indicators: signal.indicators,
    timestamp: new Date().toISOString(),
    currentPrice,
  });
});

export default router;
