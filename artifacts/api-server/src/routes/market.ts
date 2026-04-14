import { Router, type IRouter } from "express";
import { getCandles, getPrice, setCandles, isWarmedUp } from "../lib/twelvedata.js";
import { analyzeSignal } from "../lib/signals.js";
import { fetchAndCacheCandles } from "../lib/datastore.js";
import { fetchTwelveDataQuote } from "../lib/twelvedata-rest.js";
import { GetHistoricalDataQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function extractSymbol(req: { params: Record<string, string | string[]> }): string {
  const splat = req.params["splat"];
  const raw = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
  return decodeURIComponent(raw);
}

router.get("/market/symbols", async (_req, res): Promise<void> => {
  res.json([
    { symbol: "EUR/USD", name: "Euro / US Dollar", type: "forex" },
    { symbol: "BTC/USD", name: "Bitcoin / US Dollar", type: "crypto" },
  ]);
});

/**
 * GET /api/market/quote/:symbol*
 * Returns the latest known price for a symbol.
 * Performs a REST "last quote" lookup against Twelve Data if the in-memory
 * cache is empty (e.g. market closed / server just started).
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
 * Returns OHLC candle array.  Priority: in-memory cache → DB → AV → TD REST → synthetic.
 */
router.get("/market/historical/*splat", async (req, res): Promise<void> => {
  const symbol = extractSymbol(req);
  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  const qp = GetHistoricalDataQueryParams.safeParse(req.query);
  const interval = qp.success ? (qp.data.interval ?? "1min") : "1min";

  let candles = getCandles(symbol);

  if (candles.length < 10) {
    const result = await fetchAndCacheCandles(symbol, interval);
    candles = result.candles;
    // Update in-memory cache so signal endpoint benefits too
    setCandles(symbol, candles);
  }

  res.json(candles);
});

/**
 * GET /api/market/signal/:symbol*
 * Returns the AI signal analysis.  Passes the warm-up flag to the signal engine
 * so entropy/volatility guards are skipped until 5 real-time ticks have been received.
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

  const warming = !isWarmedUp(symbol);
  const signal = analyzeSignal(candles, warming);
  const currentPrice = getPrice(symbol) || candles[candles.length - 1].close;

  res.json({
    symbol,
    direction: signal.direction,
    confidence: signal.confidence,
    safeMode: signal.safeMode,
    warming: signal.warming,
    reasons: signal.reasons,
    indicators: signal.indicators,
    timestamp: new Date().toISOString(),
    currentPrice,
  });
});

export default router;
