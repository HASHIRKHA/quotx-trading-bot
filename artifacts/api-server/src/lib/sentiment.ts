/**
 * News Sentiment Module — Alpha Vantage NEWS_SENTIMENT API
 * Polls real-time financial headlines and returns a per-symbol sentiment score.
 * Cache TTL: 5 minutes (respects AV free tier rate limits).
 */

import { logger } from "./logger.js";

export type SentimentLabel =
  | "Bullish"
  | "Somewhat-Bullish"
  | "Neutral"
  | "Somewhat-Bearish"
  | "Bearish";

export interface SentimentResult {
  label: SentimentLabel;
  score: number;       // -1.0 (full bearish) to +1.0 (full bullish)
  articleCount: number;
  summary: string;
  cached: boolean;
  updatedAt: number;
}

/** Maps internal trading symbols to AV News API ticker format */
const TICKER_MAP: Record<string, string> = {
  "BTC/USD": "CRYPTO:BTC",
  "ETH/USD": "CRYPTO:ETH",
  "XAU/USD": "FOREX:XAU",   // Alpha Vantage uses FOREX:XAU for Gold sentiment
  "SOL/USD": "CRYPTO:SOL",
};

const cache = new Map<string, SentimentResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const NEUTRAL_RESULT = (reason: string): SentimentResult => ({
  label: "Neutral",
  score: 0,
  articleCount: 0,
  summary: reason,
  cached: false,
  updatedAt: Date.now(),
});

function scoreToLabel(score: number): SentimentLabel {
  if (score >= 0.35) return "Bullish";
  if (score >= 0.15) return "Somewhat-Bullish";
  if (score >= -0.15) return "Neutral";
  if (score >= -0.35) return "Somewhat-Bearish";
  return "Bearish";
}

export async function getSentiment(symbol: string): Promise<SentimentResult> {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.updatedAt < CACHE_TTL_MS) {
    return { ...cached, cached: true };
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  const avTicker = TICKER_MAP[symbol];

  if (!apiKey || !avTicker) {
    return NEUTRAL_RESULT("API key or ticker not configured");
  }

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(avTicker)}&sort=LATEST&limit=20&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`AV HTTP ${res.status}`);

    const data = await res.json() as {
      feed?: Array<{
        ticker_sentiment?: Array<{
          ticker: string;
          ticker_sentiment_score: string;
          ticker_sentiment_label: string;
        }>;
      }>;
      Information?: string;
      Note?: string;
    };

    if (data.Information || data.Note) {
      logger.warn({ symbol }, "Alpha Vantage rate limit — returning cached or Neutral");
      const stale = cache.get(symbol);
      if (stale) return { ...stale, cached: true };
      return NEUTRAL_RESULT("AV rate-limited — defaulting to Neutral");
    }

    if (!data.feed || data.feed.length === 0) {
      const result = NEUTRAL_RESULT("No recent news articles found");
      cache.set(symbol, result);
      return result;
    }

    // Collect ticker_sentiment_score from all articles that explicitly mention this ticker
    const upperTicker = avTicker.toUpperCase();
    const scores: number[] = [];
    for (const article of data.feed) {
      for (const ts of article.ticker_sentiment ?? []) {
        if (ts.ticker.toUpperCase() === upperTicker) {
          const s = parseFloat(ts.ticker_sentiment_score);
          if (!isNaN(s)) scores.push(s);
        }
      }
    }

    if (scores.length === 0) {
      const result = NEUTRAL_RESULT(`${data.feed.length} articles — no direct ${avTicker} mentions`);
      cache.set(symbol, result);
      return result;
    }

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const label = scoreToLabel(avgScore);
    const result: SentimentResult = {
      label,
      score: avgScore,
      articleCount: scores.length,
      summary: `${scores.length} articles — avg ${avgScore >= 0 ? "+" : ""}${avgScore.toFixed(3)}`,
      cached: false,
      updatedAt: now,
    };

    cache.set(symbol, result);
    logger.info({ symbol, label, score: avgScore, articles: scores.length }, "Sentiment updated");
    return result;
  } catch (err) {
    logger.error({ err, symbol }, "Sentiment fetch failed — returning cached or Neutral");
    const stale = cache.get(symbol);
    if (stale) return { ...stale, cached: true };
    return NEUTRAL_RESULT("Fetch error — defaulting to Neutral");
  }
}

/** Fire-and-forget sentiment pre-warm — staggers requests to respect AV free tier (1 req/12s). */
export function warmSentimentCache(symbols: string[]): void {
  let delay = 0;
  for (const sym of symbols) {
    setTimeout(() => {
      getSentiment(sym).catch(() => { /* non-fatal */ });
    }, delay);
    delay += 13_000;
  }
}
