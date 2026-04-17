import { Router, type IRouter } from "express";
import { getCandles, getPrice, setCandles, isWarmedUp, SYMBOLS } from "../lib/twelvedata.js";
import { analyzeSignal } from "../lib/signals.js";
import { getSentiment } from "../lib/sentiment.js";
import { fetchAndCacheCandles } from "../lib/datastore.js";
import { fetchTwelveDataQuote } from "../lib/twelvedata-rest.js";
import { GetHistoricalDataQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function extractSymbol(req: { params: Record<string, string | string[]> }): string {
  const splat = req.params["splat"];
  const raw = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
  return decodeURIComponent(raw);
}

const SYMBOL_META: Record<string, { name: string; type: string }> = {
  "EUR/USD": { name: "Euro / US Dollar",       type: "forex" },
  "GBP/USD": { name: "British Pound / US Dollar", type: "forex" },
  "USD/JPY": { name: "US Dollar / Japanese Yen", type: "forex" },
  "BTC/USD": { name: "Bitcoin / US Dollar",     type: "crypto" },
  "ETH/USD": { name: "Ethereum / US Dollar",    type: "crypto" },
};

router.get("/market/symbols", async (_req, res): Promise<void> => {
  const list = SYMBOLS.map((s) => ({
    symbol: s,
    name: SYMBOL_META[s]?.name ?? s,
    type: SYMBOL_META[s]?.type ?? "forex",
  }));
  res.json(list);
});

/**
 * GET /api/market/sentiment/:symbol*
 * Returns NLP sentiment from Alpha Vantage News API for a given symbol.
 */
router.get("/market/sentiment/*splat", async (req, res): Promise<void> => {
  const symbol = extractSymbol(req);
  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }
  try {
    const sentiment = await getSentiment(symbol);
    res.json(sentiment);
  } catch {
    res.json({ label: "Neutral", score: 0, articleCount: 0, summary: "Fetch error", cached: false, updatedAt: Date.now() });
  }
});

/**
 * GET /api/market/quote/:symbol*
 * Returns the latest known price for a symbol.
 */
router.get("/market/quote/*splat", async (req, res): Promise<void> => {
  const symbol = extractSymbol(req);
  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  let price = getPrice(symbol);

  if (!price || price === 0) {
    const fetched = await fetchTwelveDataQuote(symbol);
    if (fetched && fetched > 0) {
      price = fetched;
    }
  }

  res.json({
    symbol,
    price: price || null,
    timestamp: Date.now(),
  });
});

/**
 * GET /api/market/historical/:symbol*
 * Returns OHLC candle array.  Priority: in-memory → DB → AV → TD REST → synthetic.
 */
router.get("/market/historical/*splat", async (req, res): Promise<void> => {
  const symbol = extractSymbol(req);
  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  const qp = GetHistoricalDataQueryParams.safeParse(req.query);
  const interval = qp.success ? (qp.data.interval ?? "1min") : "1min";

  try {
    let candles = getCandles(symbol);

    if (candles.length < 10) {
      const result = await fetchAndCacheCandles(symbol, interval);
      candles = result.candles;
      setCandles(symbol, candles);
    }

    res.json(candles);
  } catch (err) {
    req.log?.error({ err, symbol }, "Historical data fetch failed — returning empty array");
    res.json([]);
  }
});

/**
 * GET /api/market/signal/:symbol*
 * Returns the AI signal analysis including sentiment-weighted decision.
 */
router.get("/market/signal/*splat", async (req, res): Promise<void> => {
  const symbol = extractSymbol(req);
  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  let candles = getCandles(symbol);

  if (candles.length < 5) {
    const result = await fetchAndCacheCandles(symbol);
    candles = result.candles;
    setCandles(symbol, candles);
  }

  if (candles.length < 5) {
    res.status(400).json({ error: "Insufficient data to compute signal" });
    return;
  }

  // Fetch sentiment (cached — does not block if AV rate-limited)
  let sentimentBias: string | undefined;
  try {
    const sentiment = await getSentiment(symbol);
    sentimentBias = sentiment.label;
  } catch {
    sentimentBias = undefined;
  }

  const warming = !isWarmedUp(symbol);
  const signal = analyzeSignal(candles, warming, sentimentBias);
  const currentPrice = getPrice(symbol) || candles[candles.length - 1].close;

  res.json({
    symbol,
    direction: signal.direction,
    confidence: signal.confidence,
    safeMode: signal.safeMode,
    warming: signal.warming,
    entropyReduced: signal.entropyReduced,
    sentimentBias: signal.sentimentBias,
    sentimentSuppressed: signal.sentimentSuppressed,
    reasons: signal.reasons,
    factors: signal.factors,
    factorCount: signal.factorCount,
    ghostCandle: signal.ghostCandle,
    executionTime: signal.executionTime,
    indicators: signal.indicators,
    timestamp: new Date().toISOString(),
    currentPrice,
  });
});

export default router;
