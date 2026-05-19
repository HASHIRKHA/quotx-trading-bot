import { Router, type IRouter } from "express";
import { getCandles, getPrice, setPrice, getPriceAge, setCandles, isWarmedUp, SYMBOLS, getHourlyCandles, getLiveTicks, isPriceFrozen } from "../lib/twelvedata.js";
import { analyzeSignal, calcEntropy, type OHLC } from "../lib/signals.js";
import { getSentiment } from "../lib/sentiment.js";
import { fetchAndCacheCandles } from "../lib/datastore.js";
import { fetchTwelveDataQuote } from "../lib/twelvedata-rest.js";
import { fetchFreePrices } from "../lib/freePriceFeed.js";
import { GetHistoricalDataQueryParams } from "@workspace/api-zod";
import { logSignal, detectRegime, getFactorWeightsBySymbol } from "../lib/learningEngine.js";
import { getAllQuotexSignals, getQuotexSignal, getQuotexAssetForSymbol } from "../lib/quotexFeed.js";

const router: IRouter = Router();

/**
 * Aggregate 1-minute candles into N-minute candles for signal analysis.
 * Keeps chart display on 1-minute while signals use longer-term context.
 */
function aggregateCandles(candles: OHLC[], minutesPer = 5): OHLC[] {
  // Return empty (not raw candles) when there's insufficient data to aggregate —
  // callers treat [] as a warming state rather than silently using 1-min data for
  // a signal that expects 5-min or 10-min context.
  if (candles.length < minutesPer * 5) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const bucketSecs = minutesPer * 60;
  const buckets = new Map<number, OHLC[]>();
  for (const c of sorted) {
    const bucket = Math.floor(c.time / bucketSecs) * bucketSecs;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(c);
  }
  const result: OHLC[] = [];
  for (const [t, cs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({
      time: t,
      open: cs[0].open,
      high: Math.max(...cs.map((c) => c.high)),
      low: Math.min(...cs.map((c) => c.low)),
      close: cs[cs.length - 1].close,
      volume: cs.reduce((a, c) => a + c.volume, 0),
    });
  }
  return result;
}

function extractSymbol(req: { params: Record<string, string | string[]> }): string {
  const splat = req.params["splat"];
  const raw = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
  return decodeURIComponent(raw);
}

const SYMBOL_META: Record<string, { name: string; type: string }> = {
  // ── Crypto ─────────────────────────────────────────────────────────────────
  "BTC/USD":       { name: "Bitcoin / US Dollar",            type: "crypto"    },
  "ETH/USD":       { name: "Ethereum / US Dollar",           type: "crypto"    },
  "SOL/USD":       { name: "Solana / US Dollar",             type: "crypto"    },
  // ── Commodity ──────────────────────────────────────────────────────────────
  "XAU/USD":       { name: "Gold / US Dollar",               type: "commodity" },
  // ── Major forex ────────────────────────────────────────────────────────────
  "EUR/USD":       { name: "Euro / US Dollar",               type: "forex" },
  "GBP/USD":       { name: "Pound / US Dollar",              type: "forex" },
  "AUD/USD":       { name: "Aussie / US Dollar",             type: "forex" },
  "NZD/USD":       { name: "Kiwi / US Dollar",               type: "forex" },
  "USD/JPY":       { name: "Dollar / Japanese Yen",          type: "forex" },
  "USD/CAD":       { name: "Dollar / Canadian Dollar",       type: "forex" },
  "USD/CHF":       { name: "Dollar / Swiss Franc",           type: "forex" },
  // ── JPY crosses ────────────────────────────────────────────────────────────
  "GBP/JPY":       { name: "Pound / Japanese Yen",           type: "forex" },
  "AUD/JPY":       { name: "Aussie / Japanese Yen",          type: "forex" },
  "EUR/JPY":       { name: "Euro / Japanese Yen",            type: "forex" },
  "NZD/JPY":       { name: "Kiwi / Japanese Yen",            type: "forex" },
  "CAD/JPY":       { name: "Canadian / Japanese Yen",        type: "forex" },
  "CHF/JPY":       { name: "Swiss / Japanese Yen",           type: "forex" },
  // ── EUR crosses ────────────────────────────────────────────────────────────
  "EUR/GBP":       { name: "Euro / British Pound",           type: "forex" },
  "EUR/CAD":       { name: "Euro / Canadian Dollar",         type: "forex" },
  "EUR/AUD":       { name: "Euro / Aussie Dollar",           type: "forex" },
  "EUR/CHF":       { name: "Euro / Swiss Franc",             type: "forex" },
  "EUR/NZD":       { name: "Euro / New Zealand Dollar",      type: "forex" },
  // ── GBP crosses ────────────────────────────────────────────────────────────
  "GBP/AUD":       { name: "Pound / Aussie Dollar",          type: "forex" },
  "GBP/CAD":       { name: "Pound / Canadian Dollar",        type: "forex" },
  "GBP/CHF":       { name: "Pound / Swiss Franc",            type: "forex" },
  "GBP/NZD":       { name: "Pound / New Zealand Dollar",     type: "forex" },
  // ── AUD / NZD / CAD crosses ────────────────────────────────────────────────
  "AUD/CAD":       { name: "Aussie / Canadian Dollar",       type: "forex" },
  "AUD/CHF":       { name: "Aussie / Swiss Franc",           type: "forex" },
  "AUD/NZD":       { name: "Aussie / New Zealand Dollar",    type: "forex" },
  "NZD/CAD":       { name: "Kiwi / Canadian Dollar",         type: "forex" },
  "NZD/CHF":       { name: "Kiwi / Swiss Franc",             type: "forex" },
  "CAD/CHF":       { name: "Canadian / Swiss Franc",         type: "forex" },
  // ── OTC variants — all 24/7 on Quotex ─────────────────────────────────────
  "EUR/USD OTC":   { name: "EUR/USD OTC",    type: "otc" },
  "GBP/USD OTC":   { name: "GBP/USD OTC",    type: "otc" },
  "AUD/USD OTC":   { name: "AUD/USD OTC",    type: "otc" },
  "NZD/USD OTC":   { name: "NZD/USD OTC",    type: "otc" },
  "USD/JPY OTC":   { name: "USD/JPY OTC",    type: "otc" },
  "USD/CAD OTC":   { name: "USD/CAD OTC",    type: "otc" },
  "USD/CHF OTC":   { name: "USD/CHF OTC",    type: "otc" },
  "GBP/JPY OTC":   { name: "GBP/JPY OTC",    type: "otc" },
  "AUD/JPY OTC":   { name: "AUD/JPY OTC",    type: "otc" },
  "EUR/JPY OTC":   { name: "EUR/JPY OTC",    type: "otc" },
  "NZD/JPY OTC":   { name: "NZD/JPY OTC",    type: "otc" },
  "CAD/JPY OTC":   { name: "CAD/JPY OTC",    type: "otc" },
  "CHF/JPY OTC":   { name: "CHF/JPY OTC",    type: "otc" },
  "EUR/GBP OTC":   { name: "EUR/GBP OTC",    type: "otc" },
  "EUR/CAD OTC":   { name: "EUR/CAD OTC",    type: "otc" },
  "EUR/AUD OTC":   { name: "EUR/AUD OTC",    type: "otc" },
  "EUR/CHF OTC":   { name: "EUR/CHF OTC",    type: "otc" },
  "EUR/NZD OTC":   { name: "EUR/NZD OTC",    type: "otc" },
  "GBP/AUD OTC":   { name: "GBP/AUD OTC",    type: "otc" },
  "GBP/CAD OTC":   { name: "GBP/CAD OTC",    type: "otc" },
  "GBP/CHF OTC":   { name: "GBP/CHF OTC",    type: "otc" },
  "GBP/NZD OTC":   { name: "GBP/NZD OTC",    type: "otc" },
  "AUD/CAD OTC":   { name: "AUD/CAD OTC",    type: "otc" },
  "AUD/CHF OTC":   { name: "AUD/CHF OTC",    type: "otc" },
  "AUD/NZD OTC":   { name: "AUD/NZD OTC",    type: "otc" },
  "NZD/CAD OTC":   { name: "NZD/CAD OTC",    type: "otc" },
  "NZD/CHF OTC":   { name: "NZD/CHF OTC",    type: "otc" },
  "CAD/CHF OTC":   { name: "CAD/CHF OTC",    type: "otc" },
  // ── Exotic OTC ─────────────────────────────────────────────────────────────
  "USD/EGP OTC":   { name: "USD/EGP OTC",    type: "otc" },
  "USD/IDR OTC":   { name: "USD/IDR OTC",    type: "otc" },
  "USD/DZD OTC":   { name: "USD/DZD OTC",    type: "otc" },
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

  // Refresh stale prices for:
  //   • Symbols with no live WebSocket feed (getLiveTicks === 0), OR
  //   • Symbols with "frozen" feeds — ticks arriving but price never changing
  //     (TwelveData free tier sends heartbeat ticks for XAU at the same stale price).
  // In both cases we override with Binance (crypto) or Yahoo Finance (XAU).
  if ((getLiveTicks(symbol) === 0 || isPriceFrozen(symbol)) && getPriceAge(symbol) > 30_000) {
    let refreshed = false;

    // 1. TwelveData REST — skip for frozen symbols: TwelveData also returns the
    //    same stale price for XAU (free tier has no real commodity feed), so going
    //    there first would set refreshed=true and block Yahoo Finance / Binance.
    if (!isPriceFrozen(symbol)) {
      try {
        const fresh = await fetchTwelveDataQuote(symbol);
        if (fresh && fresh > 0) {
          price = fresh;
          setPrice(symbol, fresh);
          refreshed = true;
        }
      } catch { /* fall through */ }
    }

    // 2. Free feeds: Binance (crypto) + Yahoo Finance (XAU) — for frozen/no-feed
    if (!refreshed) {
      try {
        const fp = await fetchFreePrices();
        const fpPrice = (fp as Record<string, number>)[symbol];
        if (fpPrice && fpPrice > 0) {
          price = fpPrice;
          setPrice(symbol, fpPrice);
          refreshed = true;
        }
      } catch { /* ignore */ }
    }
  }

  // Hard fallbacks — price still missing entirely (first boot before any cache)
  if (!price || price === 0) {
    try {
      const fetched = await fetchTwelveDataQuote(symbol);
      if (fetched && fetched > 0) price = fetched;
    } catch { /* ignore */ }
  }

  if (!price || price === 0) {
    try {
      const fp = await fetchFreePrices();
      const fpPrice = (fp as Record<string, number>)[symbol];
      if (fpPrice && fpPrice > 0) price = fpPrice;
    } catch { /* ignore */ }
  }

  // Last resort: most recent candle close (always available after warm-up)
  if (!price || price === 0) {
    const candles = getCandles(symbol);
    if (candles.length > 0) price = candles[candles.length - 1].close;
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

    // ── Clean candles before sending to chart ──────────────────────────
    // Some sources (TwelveData forex) return candles with:
    //   • Non-minute-aligned timestamps (e.g. +23 s offset from minute boundary)
    //   • Volume = 0 and open=high=low=close (single-price tick artifacts)
    // These interleave with real OHLC candles and break the chart time axis.
    // Fix: round all timestamps to the nearest minute, then deduplicate by
    // keeping the most "real" candle (widest spread > higher volume > latest).
    const minuteMap = new Map<number, typeof candles[0]>();
    for (const c of candles) {
      const t = Math.floor(c.time / 60) * 60;
      const existing = minuteMap.get(t);
      if (!existing) {
        minuteMap.set(t, { ...c, time: t });
        continue;
      }
      // A "real" candle has spread (high > low) or different open/close
      const existingReal = existing.high > existing.low || existing.open !== existing.close;
      const newReal      = c.high > c.low || c.open !== c.close;
      if (newReal && !existingReal) {
        // Incoming real candle beats existing tick artifact
        minuteMap.set(t, { ...c, time: t });
      } else if (newReal && existingReal) {
        // Both real — merge: keep earliest open, latest close, max high, min low, sum volume
        minuteMap.set(t, {
          time:   t,
          open:   existing.open,
          high:   Math.max(existing.high, c.high),
          low:    Math.min(existing.low, c.low),
          close:  c.close,
          volume: (existing.volume ?? 0) + (c.volume ?? 0),
        });
      }
      // else: incoming is also a tick artifact, existing wins — skip
    }
    const clean = [...minuteMap.values()].sort((a, b) => a.time - b.time);

    // ── Aggregate to requested timeframe ──────────────────────────────
    // The in-memory store always holds 1m candles.  Aggregate on the fly
    // so the chart receives the correct interval (5m, 10m, etc.).
    const aggMins = interval === "5m" ? 5 : interval === "10m" ? 10 : 1;
    const result  = aggMins === 1 ? clean : aggregateCandles(clean, aggMins);

    res.json(result);
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

  // Fetch sentiment + per-symbol learned factor weights in parallel (both cached — no added latency)
  // Per-symbol weights take priority over global weights; globals fill cold-start gaps.
  let sentimentBias: string | undefined;
  let factorWeights: Map<string, number> = new Map();
  try {
    const [sentiment, weights] = await Promise.all([
      getSentiment(symbol),
      getFactorWeightsBySymbol(symbol),
    ]);
    sentimentBias = sentiment.label;
    factorWeights = weights;
  } catch {
    sentimentBias = undefined;
  }

  // Map expiry seconds → candle interval when ?interval is not explicitly given.
  // run_40trades.py passes ?expiry=300 (5 min) — use 5-min aggregated candles for
  // that window so EMA/MACD see real trend context rather than noisy 1-min data.
  const expiryS = req.query.expiry ? parseInt(req.query.expiry as string, 10) : 60;
  const intervalParam = (req.query.interval as string) ||
    (expiryS >= 600 ? '10m' : expiryS >= 300 ? '5m' : '1m');
  const intervalSecs = intervalParam === '5m' ? 300 : intervalParam === '10m' ? 600 : 60;

  // Timeframe selection — match signal window to trade expiry:
  //   1m expiry  → 5-min aggregated 1-min candles (~40 min context, fast-reacting)
  //   5m expiry  → 5-min aggregated 1-min candles (same, more bars)
  //  10m expiry  → 10-min aggregated 1-min candles + hourly allowed
  //
  // Hourly candles (200-bar) are only eligible for ≥10m trades.
  // Using hourly data for 60s trades creates a timeframe mismatch: hourly
  // trend direction ≠ 60-second price action, producing many false NEUTRAL
  // blocks from the momentum gate.
  const hourlyCandles = getHourlyCandles(symbol);
  const aggMins = intervalParam === '10m' ? 10 : 5;
  const aggCandles = candles.length >= aggMins * 30
    ? aggregateCandles(candles, aggMins)
    : null;

  const allowHourly = intervalParam === '10m';   // only use hourly for longer trades
  let signalCandles = candles;
  if (allowHourly && hourlyCandles.length >= 30 && aggCandles) {
    const hourlyEnt = calcEntropy(hourlyCandles.map((c) => c.close));
    const aggEnt    = calcEntropy(aggCandles.map((c) => c.close));
    signalCandles = hourlyEnt <= aggEnt ? hourlyCandles : aggCandles;
  } else if (allowHourly && hourlyCandles.length >= 30) {
    signalCandles = hourlyCandles;
  } else if (aggCandles) {
    signalCandles = aggCandles;
  }

  // ── XAU/USD market-hours guard ─────────────────────────────────────────────
  // COMEX gold trades ~23 h/day Mon–Fri. On weekends the market is closed:
  //   Friday 21:00 UTC → Sunday 22:00 UTC (approx)
  // When closed, the free price feed serves a stale last-traded price, so any
  // signal would be based on frozen data and the outcome is a guaranteed tie/loss.
  // Guard: return NEUTRAL if it is Saturday (all day) or Sunday before 22:00 UTC.
  if (symbol === "XAU/USD") {
    const now = new Date();
    const utcDay  = now.getUTCDay();   // 0=Sun 6=Sat
    const utcHour = now.getUTCHours();
    const xauMarketClosed = utcDay === 6 || (utcDay === 0 && utcHour < 22);
    if (xauMarketClosed) {
      res.json({
        symbol,
        direction: "NEUTRAL",
        confidence: 0,
        safeMode: true,
        warming: false,
        entropyReduced: false,
        sentimentBias,
        sentimentSuppressed: false,
        reasons: ["XAU/USD market closed — COMEX gold does not trade on weekends"],
        factors: [],
        factorCount: 0,
        ghostCandle: null,
        executionTime: 0,
        indicators: { rsi: 50, macd: 0, macdSignal: 0, macdHistogram: 0, bbUpper: 0, bbMiddle: 0, bbLower: 0, entropy: 1, volatility: 0, atr: 0, stochastic: 50, volumeRatio: 1 },
        marketClosed: true,
      });
      return;
    }
  }

  const warming = !isWarmedUp(symbol);

  // ── Quotex platform signal: look up the call/put signal for this symbol+expiry.
  // When available it is injected as a 9th factor (weight 25) inside analyzeSignal,
  // biasing the prediction toward Quotex's own candle direction.
  // Use the nearest period Quotex supports: prefer exact match, then fall back to
  // 60s (most common), then 300s for longer-expiry trades.
  let quotexBias: { direction: "call" | "put"; bodySize: number } | null = null;
  const qAsset = getQuotexAssetForSymbol(symbol);
  if (qAsset) {
    const preferredPeriod = intervalSecs <= 60 ? 60 : intervalSecs <= 300 ? 300 : 900;
    // Try periods in order: exact → forex standard → crypto-friendly progressions.
  // Crypto pairs (BTC/ETH/SOL/etc.) only have 300s+ signals on Quotex.
  const qSig =
      getQuotexSignal(qAsset, intervalSecs)        ??   // exact match
      getQuotexSignal(qAsset, preferredPeriod)     ??   // nearest sensible period
      getQuotexSignal(qAsset, 60)                  ??   // standard forex period
      getQuotexSignal(qAsset, 30)                  ??   // short forex period
      getQuotexSignal(qAsset, 300)                 ??   // crypto minimum (5 min)
      getQuotexSignal(qAsset, 600)                 ??   // crypto 10 min
      getQuotexSignal(qAsset, 900);                     // crypto 15 min
    if (qSig) quotexBias = { direction: qSig.direction, bodySize: qSig.bodySize };
  }

  const signal = analyzeSignal(signalCandles, warming, sentimentBias, intervalSecs, factorWeights, quotexBias);
  const currentPrice = getPrice(symbol) || candles[candles.length - 1].close;

  // ── Fire-and-forget: log signal to Supabase for learning system ───────────
  // entry_price is stored so the auto-resolver can verify the prediction later
  // without a trade being placed — every signal becomes a training sample.
  const regime = detectRegime(signal.indicators);
  logSignal(
    symbol,
    signal.direction,
    signal.confidence,
    intervalSecs,
    signal.factors,
    signal.indicators,
    regime,
    null,         // trade_id linked later via linkLastSignalToTrade after POST /trades
    currentPrice, // entry_price — enables autonomous outcome verification
  ).catch(() => { /* non-fatal */ });

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
    // Quotex platform signal included in this analysis (null if feed not yet received)
    quotexSignal: quotexBias
      ? { asset: qAsset, direction: quotexBias.direction, period: intervalSecs }
      : null,
  });
});


/**
 * GET /api/market/quotex-signals
 * Returns all current Quotex direction signals extracted from instruments/list.
 * Updated every ~120 seconds from the Quotex WebSocket feed.
 *
 * Each signal: { asset, direction ("call"|"put"), period (seconds), bodySize, open, updatedAt }
 */
router.get("/market/quotex-signals", (_req, res): void => {
  const signals = getAllQuotexSignals();
  res.json({
    count: signals.length,
    updatedAt: signals.length > 0 ? Math.max(...signals.map((s) => s.updatedAt)) : 0,
    signals,
  });
});

/**
 * GET /api/market/quotex-signals/:asset/:period
 * Returns the Quotex signal for a specific asset+period combo.
 * E.g. GET /api/market/quotex-signals/EURUSD_otc/60
 */
router.get("/market/quotex-signals/:asset/:period", (req, res): void => {
  const { asset, period } = req.params;
  const periodSecs = Number(period);
  if (!asset || Number.isNaN(periodSecs)) {
    res.status(400).json({ error: "Invalid asset or period" });
    return;
  }
  const signal = getQuotexSignal(asset, periodSecs);
  if (!signal) {
    res.status(404).json({ error: "Signal not yet available — Quotex instruments/list not yet received" });
    return;
  }
  res.json(signal);
});

// ── Learning / accuracy analytics ─────────────────────────────────────────────

const SUPABASE_URL_MARKET      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY_MARKET = process.env.SUPABASE_ANON_KEY ?? "";

async function sbGetMarket<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL_MARKET}/rest/v1/${path}`, {
    headers: {
      apikey:         SUPABASE_ANON_KEY_MARKET,
      Authorization:  `Bearer ${SUPABASE_ANON_KEY_MARKET}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`SB GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * GET /api/market/learning
 * Returns the state of the self-learning system:
 * overall accuracy, per-factor win rates & weights, recent trend,
 * best performing symbols and time regimes.
 */
router.get("/market/learning", async (_req, res): Promise<void> => {
  if (!SUPABASE_URL_MARKET || !SUPABASE_ANON_KEY_MARKET) {
    res.status(503).json({ error: "Learning system offline — Supabase not configured" });
    return;
  }

  try {
    // Fetch in parallel for speed
    const [factorRows, recentSignals, summaryRows] = await Promise.all([
      // Factor weights + performance
      sbGetMarket<Array<{
        factor_name: string; weight: number; win_rate: number;
        sample_count: number; last_updated: string;
      }>>("factor_weights?select=factor_name,weight,win_rate,sample_count,last_updated&order=win_rate.desc"),

      // Last 200 resolved directional signals for trend analysis
      sbGetMarket<Array<{
        id: number; symbol: string; direction: string; confidence: number;
        outcome: string; regime: string; interval_secs: number; created_at: string;
        auto_resolved: boolean;
      }>>(
        "signals?outcome=not.is.null&direction=neq.NEUTRAL" +
        "&select=id,symbol,direction,confidence,outcome,regime,interval_secs,created_at,auto_resolved" +
        "&order=created_at.desc&limit=200",
      ),

      // Total counts
      sbGetMarket<Array<{ outcome: string; count: number }>>(
        "signals?direction=neq.NEUTRAL&select=outcome&order=outcome.asc",
      ),
    ]);

    // ── Overall stats ──────────────────────────────────────────────────────────
    const resolved = recentSignals.filter((s) => s.outcome === "WIN" || s.outcome === "LOSS");
    const wins200  = resolved.filter((s) => s.outcome === "WIN").length;
    const totalResolved = summaryRows.filter((r) => r.outcome === "WIN" || r.outcome === "LOSS").length;
    const totalWins     = summaryRows.filter((r) => r.outcome === "WIN").length;
    const totalSignals  = summaryRows.length;
    const totalPending  = summaryRows.filter((r) => r.outcome === null).length;
    const autoResolved  = recentSignals.filter((s) => s.auto_resolved).length;

    // ── Recent accuracy windows ────────────────────────────────────────────────
    const win = (arr: typeof resolved) =>
      arr.length > 0 ? Math.round((arr.filter((s) => s.outcome === "WIN").length / arr.length) * 1000) / 10 : null;

    const last10  = resolved.slice(0, 10);
    const last50  = resolved.slice(0, 50);
    const last100 = resolved.slice(0, 100);

    // ── By symbol ─────────────────────────────────────────────────────────────
    const symMap = new Map<string, { wins: number; total: number }>();
    for (const s of resolved) {
      const e = symMap.get(s.symbol) ?? { wins: 0, total: 0 };
      e.total++;
      if (s.outcome === "WIN") e.wins++;
      symMap.set(s.symbol, e);
    }
    const bySymbol = [...symMap.entries()]
      .map(([symbol, { wins, total }]) => ({
        symbol, wins, total, winRate: Math.round((wins / total) * 1000) / 10,
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10);

    // ── By regime ─────────────────────────────────────────────────────────────
    const regimeMap = new Map<string, { wins: number; total: number }>();
    for (const s of resolved) {
      const regime = s.regime ?? "unknown";
      const e = regimeMap.get(regime) ?? { wins: 0, total: 0 };
      e.total++;
      if (s.outcome === "WIN") e.wins++;
      regimeMap.set(regime, e);
    }
    const byRegime = Object.fromEntries(
      [...regimeMap.entries()].map(([regime, { wins, total }]) => [
        regime,
        { wins, total, winRate: Math.round((wins / total) * 1000) / 10 },
      ]),
    );

    // ── By interval ───────────────────────────────────────────────────────────
    const intMap = new Map<number, { wins: number; total: number }>();
    for (const s of resolved) {
      const e = intMap.get(s.interval_secs) ?? { wins: 0, total: 0 };
      e.total++;
      if (s.outcome === "WIN") e.wins++;
      intMap.set(s.interval_secs, e);
    }
    const byInterval = [...intMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([secs, { wins, total }]) => ({
        intervalSecs: secs,
        label: secs === 60 ? "1m" : secs === 300 ? "5m" : secs === 600 ? "10m" : `${secs}s`,
        wins, total, winRate: Math.round((wins / total) * 1000) / 10,
      }));

    // ── Factor rankings ────────────────────────────────────────────────────────
    const factors = factorRows.map((f) => ({
      name:         f.factor_name,
      weight:       parseFloat(Number(f.weight).toFixed(3)),
      winRate:      Math.round(Number(f.win_rate) * 1000) / 10,
      sampleCount:  f.sample_count,
      lastUpdated:  f.last_updated,
      strength:     Number(f.weight) > 1.1 ? "strong" : Number(f.weight) < 0.9 ? "weak" : "neutral",
    }));

    res.json({
      totalSignals,
      totalResolved,
      totalPending,
      totalWins,
      overallWinRate: totalResolved > 0 ? Math.round((totalWins / totalResolved) * 1000) / 10 : null,
      autoResolved,
      recentAccuracy: {
        last10:  win(last10),
        last50:  win(last50),
        last100: win(last100),
        recent200WinRate: win(resolved),
      },
      factors,
      bySymbol,
      byRegime,
      byInterval,
      learningActive: true,
      resolverInterval: "60s",
    });
  } catch (err) {
    res.status(500).json({ error: "Learning stats unavailable", detail: String(err) });
  }
});

export default router;
