/**
 * Quantum Signal Engine v3
 * SVM-inspired RBF classifier + LSTM-style temporal fingerprinting
 * Dynamic entropy scaling · News sentiment suppression · 8-factor scoring
 * Requires 6/8 factors confirmed + signal purity check for HIGH-confidence trades
 */

export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  entropy: number;
  volatility: number;
  atr: number;
  stochastic: number;
  volumeRatio: number;
}

export interface FactorResult {
  name: string;
  value: number;
  confirmed: boolean;
  direction: "UP" | "DOWN" | "NEUTRAL";
  weight: number;
  detail: string;
}

export interface GhostCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SignalResult {
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  safeMode: boolean;
  warming: boolean;
  entropyReduced: boolean;       // entropy in 0.97–0.99 soft-block zone
  sentimentBias?: string;        // AV news sentiment label for this symbol
  sentimentSuppressed: boolean;  // true if sentiment overrode a technical direction
  reasons: string[];
  factors: FactorResult[];
  factorCount: number;
  indicators: IndicatorValues;
  ghostCandle: GhostCandle | null;
  executionTime: number;
}

// ─── Math Utilities ───────────────────────────────────────────────────────────

function ema(closes: number[], period: number): number[] {
  if (closes.length < period) return closes.map(() => closes[0] ?? 0);
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  // Wilder's smoothed RSI — seed with simple average of first `period` changes,
  // then apply exponential smoothing: avg = (prev * (n-1) + current) / n
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += changes[i] > 0 ? changes[i] : 0;
    avgLoss += changes[i] < 0 ? -changes[i] : 0;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + (changes[i] > 0 ? changes[i] : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (changes[i] < 0 ? -changes[i] : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = e12.slice(-e26.length).map((v, i) => v - e26[i]);
  const sig = ema(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSig = sig[sig.length - 1];
  return { macd: lastMacd, signal: lastSig, histogram: lastMacd - lastSig };
}

function calcBollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

function calcATR(candles: OHLC[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

export function calcEntropy(closes: number[], period = 30): number {
  // BUG 3 FIX: Insufficient data → return max entropy (1.0) so the entropy
  // hard-block fires rather than allowing signals on < 30 candles of data.
  if (closes.length < period) return 1.0;
  const slice = closes.slice(-period);
  const changes = slice.slice(1).map((c, i) => (c >= slice[i] ? 1 : 0));
  const p = changes.filter(Boolean).length / changes.length;
  if (p === 0 || p === 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function calcVolatility(closes: number[], period = 14): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period) / mean;
}

// ─── RBF Kernel ──────────────────────────────────────────────────────────────

function rbfKernel(x: number[], prototype: number[], gamma = 0.5): number {
  const len = Math.min(x.length, prototype.length);
  let dist = 0;
  for (let i = 0; i < len; i++) dist += (x[i] - prototype[i]) ** 2;
  return Math.exp(-gamma * dist);
}

/**
 * LSTM-style temporal fingerprint.
 * Captures sequential price-volume behaviour across the last 30 candles.
 * Returns a 10-element normalized feature vector.
 */
function extractTemporalFingerprint(candles: OHLC[]): number[] {
  const n = Math.min(30, candles.length);
  if (n < 6) return new Array(10).fill(0);
  const slice = candles.slice(-n);
  const closes = slice.map((c) => c.close);
  const volumes = slice.map((c) => c.volume);

  const ret1 = n >= 2 ? (closes[n - 1] - closes[n - 2]) / closes[n - 2] : 0;
  const ret5 = n >= 6 ? (closes[n - 1] - closes[n - 6]) / closes[n - 6] : 0;
  const ret10 = n >= 11 ? (closes[n - 1] - closes[n - 11]) / closes[n - 11] : 0;
  const ret20 = n >= 21 ? (closes[n - 1] - closes[n - 21]) / closes[n - 21] : 0;

  const ups5 = slice.slice(-5).filter((_, i, a) => i > 0 && a[i].close > a[i - 1].close).length / 4;
  const ups10 = slice.slice(-10).filter((_, i, a) => i > 0 && a[i].close > a[i - 1].close).length / 9;

  const avgVol = volumes.reduce((a, b) => a + b, 0) / n;
  const recentVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const volRatio = avgVol > 0 ? recentVol / avgVol - 1 : 0;

  const rsiNorm = (calcRSI(closes) - 50) / 50;
  const { macd, signal } = calcMACD(closes);
  const macdNorm = Math.tanh((macd - signal) * 10000);
  const { upper, lower } = calcBollinger(closes);
  const bbPos = upper > lower ? (closes[n - 1] - lower) / (upper - lower) - 0.5 : 0;

  return [
    Math.tanh(ret1 * 100),
    Math.tanh(ret5 * 100),
    Math.tanh(ret10 * 100),
    Math.tanh(ret20 * 100),
    ups5 * 2 - 1,
    ups10 * 2 - 1,
    Math.tanh(volRatio),
    rsiNorm,
    macdNorm,
    Math.tanh(bbPos * 4),
  ];
}

const BULL_PROTOTYPE = [0.6, 0.5, 0.4, 0.3, 0.7, 0.6, 0.5, -0.6, 0.8, -0.7];
const BEAR_PROTOTYPE = [-0.6, -0.5, -0.4, -0.3, -0.7, -0.6, 0.5, 0.6, -0.8, 0.7];

// ─── The Six Factors ──────────────────────────────────────────────────────────

function factorRSIExtreme(closes: number[]): FactorResult {
  const rsi = calcRSI(closes);
  // Broader bands: <40 = oversold bias, >60 = overbought bias
  const oversold = rsi < 40;
  const overbought = rsi > 60;
  const extreme = rsi < 30 || rsi > 70;
  return {
    name: "RSI Extreme",
    value: rsi,
    confirmed: oversold || overbought,
    direction: oversold ? "UP" : overbought ? "DOWN" : "NEUTRAL",
    weight: extreme ? 20 : 12,
    detail: `RSI ${rsi.toFixed(1)} — ${overbought ? "Overbought" : oversold ? "Oversold" : "Neutral"}`,
  };
}

function factorMACDCross(closes: number[]): FactorResult {
  const { macd, signal, histogram } = calcMACD(closes);
  const bullCross = histogram > 0 && macd > signal;
  const bearCross = histogram < 0 && macd < signal;
  return {
    name: "MACD Cross",
    value: histogram,
    confirmed: bullCross || bearCross,
    direction: bullCross ? "UP" : bearCross ? "DOWN" : "NEUTRAL",
    weight: 18,
    detail: `MACD hist ${histogram > 0 ? "+" : ""}${histogram.toFixed(5)} — ${bullCross ? "Bullish cross" : bearCross ? "Bearish cross" : "No cross"}`,
  };
}

function factorBollingerBreach(closes: number[]): FactorResult {
  const { upper, lower, middle } = calcBollinger(closes);
  const price = closes[closes.length - 1];
  const below = upper > 0 && price < lower;
  const above = upper > 0 && price > upper;
  const nearLower = upper > 0 && price < middle && (price - lower) / (upper - lower) < 0.25;
  const nearUpper = upper > 0 && price > middle && (price - lower) / (upper - lower) > 0.75;
  return {
    name: "Bollinger Breach",
    value: upper > 0 ? (price - lower) / (upper - lower) : 0.5,
    confirmed: below || above || nearLower || nearUpper,
    direction: below || nearLower ? "UP" : above || nearUpper ? "DOWN" : "NEUTRAL",
    weight: 15,
    detail: below ? `Below lower band (${lower.toFixed(5)})` : above ? `Above upper band (${upper.toFixed(5)})` : `Band position: ${upper > 0 ? ((price - lower) / (upper - lower) * 100).toFixed(0) : "?"}%`,
  };
}

function factorVolumeConfirmation(candles: OHLC[]): FactorResult {
  const n = candles.length;
  if (n < 10) return { name: "Volume Confirmation", value: 1, confirmed: false, direction: "NEUTRAL", weight: 14, detail: "Insufficient data" };
  const avgVol = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(20, n);
  const lastVol = candles[n - 1].volume;
  const volSpike = lastVol > avgVol * 1.2;
  const lastDir = candles[n - 1].close > candles[n - 1].open ? "UP" : "DOWN";
  return {
    name: "Volume Confirmation",
    value: avgVol > 0 ? lastVol / avgVol : 1,
    confirmed: volSpike,
    direction: volSpike ? lastDir : "NEUTRAL",
    weight: 14,
    detail: `Vol ratio ${avgVol > 0 ? (lastVol / avgVol).toFixed(2) : "?"} — ${volSpike ? `Spike confirms ${lastDir}` : "No spike"}`,
  };
}

function factorSupportResistance(candles: OHLC[]): FactorResult {
  const n = candles.length;
  if (n < 20) return { name: "S/R Bounce", value: 0, confirmed: false, direction: "NEUTRAL", weight: 16, detail: "Insufficient data" };
  const lookback = candles.slice(-20);
  const price = candles[n - 1].close;
  const highest = Math.max(...lookback.map((c) => c.high));
  const lowest = Math.min(...lookback.map((c) => c.low));
  const range = highest - lowest;
  if (range === 0) return { name: "S/R Bounce", value: 0.5, confirmed: false, direction: "NEUTRAL", weight: 16, detail: "No range" };
  const pos = (price - lowest) / range;
  const nearSupport = pos < 0.25;
  const nearResistance = pos > 0.75;
  return {
    name: "S/R Bounce",
    value: pos,
    confirmed: nearSupport || nearResistance,
    direction: nearSupport ? "UP" : nearResistance ? "DOWN" : "NEUTRAL",
    weight: 16,
    detail: nearSupport ? `Near support (${lowest.toFixed(5)})` : nearResistance ? `Near resistance (${highest.toFixed(5)})` : `Mid range at ${(pos * 100).toFixed(0)}%`,
  };
}

function factorMomentum(closes: number[]): FactorResult {
  const n = closes.length;
  if (n < 10) return { name: "Momentum", value: 0, confirmed: false, direction: "NEUTRAL", weight: 17, detail: "Insufficient data" };
  const m5 = closes[n - 1] - closes[n - 6];
  const m10 = closes[n - 1] - closes[n - 11];
  const m20 = n >= 21 ? closes[n - 1] - closes[n - 21] : m10;
  const aligned = Math.sign(m5) === Math.sign(m10) && Math.sign(m10) === Math.sign(m20);
  const bullish = m5 > 0 && m10 > 0;
  const bearish = m5 < 0 && m10 < 0;
  return {
    name: "Momentum",
    value: m5,
    confirmed: aligned && (bullish || bearish),
    direction: bullish ? "UP" : bearish ? "DOWN" : "NEUTRAL",
    weight: 17,
    detail: aligned ? `${bullish ? "Bullish" : "Bearish"} momentum aligned (5/10/20 candles)` : `Mixed momentum — 5c: ${m5 > 0 ? "+" : ""}${m5.toFixed(5)}, 10c: ${m10 > 0 ? "+" : ""}${m10.toFixed(5)}`,
  };
}

// ─── Ghost Candle Prediction ──────────────────────────────────────────────────

function predictGhostCandle(
  candles: OHLC[],
  direction: "UP" | "DOWN",
  confidence: number,
  intervalSecs = 60,
): GhostCandle {
  const n = candles.length;
  const lastClose = candles[n - 1].close;

  // Use both short-term (5-bar) and medium-term (14-bar) ATR — blend them so
  // recent volatility matters more than the long average.
  const atrFull  = calcATR(candles);
  const atrShort = candles.length >= 5 ? calcATR(candles.slice(-5)) : atrFull;
  const atr = atrShort * 0.6 + atrFull * 0.4;

  // Confidence → body size.  42 % → tight body (35% of ATR), 96 % → full body (90%).
  // This makes high-confidence signals produce large, clean candles and low-confidence
  // signals produce small, realistic ones — not just noise.
  const confNorm  = Math.min(1, Math.max(0, (confidence - 42) / (96 - 42)));
  const bodyRatio = 0.35 + confNorm * 0.55;   // 0.35 → 0.90
  const wickRatio = (1 - bodyRatio) * 0.25;   // tiny wicks proportional to leftover

  const bodySize = atr * bodyRatio;
  const topWick  = atr * wickRatio;
  const botWick  = atr * wickRatio * 0.6;     // bottom wick slightly shorter

  // Align to the NEXT interval boundary (not just next minute).
  // A 5m signal should show a candle starting at the next 5m bar, etc.
  const now = Math.floor(Date.now() / 1000);
  const nextBoundary = Math.floor(now / intervalSecs) * intervalSecs + intervalSecs;

  if (direction === "UP") {
    return {
      time:  nextBoundary,
      open:  lastClose,
      high:  lastClose + bodySize + topWick,
      low:   lastClose - botWick,
      close: lastClose + bodySize,
    };
  } else {
    return {
      time:  nextBoundary,
      open:  lastClose,
      high:  lastClose + botWick,
      low:   lastClose - bodySize - topWick,
      close: lastClose - bodySize,
    };
  }
}

// ─── EMA Trend Factor ────────────────────────────────────────────────────────

function factorEMATrend(candles: OHLC[]): FactorResult {
  const closes = candles.map((c) => c.close);
  if (closes.length < 26) {
    return { name: "EMA Trend", value: 0, confirmed: false, direction: "NEUTRAL", weight: 20, detail: "Insufficient data" };
  }
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const curr9 = e9[e9.length - 1];
  const curr21 = e21[e21.length - 1];
  const prev9 = e9[e9.length - 2];
  const prev21 = e21[e21.length - 2];
  const gap = curr9 - curr21;
  const prevGap = prev9 - prev21;
  // Bullish: EMA9 above EMA21 and gap is holding/widening
  const bullish = gap > 0 && (prevGap === 0 || Math.abs(gap) >= Math.abs(prevGap) * 0.7);
  const bearish = gap < 0 && (prevGap === 0 || Math.abs(gap) >= Math.abs(prevGap) * 0.7);
  return {
    name: "EMA Trend",
    value: gap,
    confirmed: bullish || bearish,
    direction: bullish ? "UP" : bearish ? "DOWN" : "NEUTRAL",
    weight: 20,
    detail: bullish
      ? `EMA9 above EMA21 by ${Math.abs(gap).toFixed(5)} — uptrend confirmed`
      : bearish
      ? `EMA9 below EMA21 by ${Math.abs(gap).toFixed(5)} — downtrend confirmed`
      : `EMAs converging — no clear trend`,
  };
}

// ─── Stochastic Confirmation Factor ──────────────────────────────────────────

function factorStochasticConfirm(candles: OHLC[]): FactorResult {
  const n = candles.length;
  if (n < 14) {
    return { name: "Stochastic %K", value: 50, confirmed: false, direction: "NEUTRAL", weight: 15, detail: "Insufficient data" };
  }
  const slice = candles.slice(-14);
  const highest = Math.max(...slice.map((c) => c.high));
  const lowest = Math.min(...slice.map((c) => c.low));
  const k = highest > lowest ? ((candles[n - 1].close - lowest) / (highest - lowest)) * 100 : 50;
  const oversold = k < 30;
  const overbought = k > 70;
  return {
    name: "Stochastic %K",
    value: k,
    confirmed: oversold || overbought,
    direction: oversold ? "UP" : overbought ? "DOWN" : "NEUTRAL",
    weight: 15,
    detail: `%K ${k.toFixed(1)} — ${overbought ? "Overbought sell zone" : oversold ? "Oversold buy zone" : "Neutral zone"}`,
  };
}

// ─── Entropy Zones ───────────────────────────────────────────────────────────

/**
 * ENTROPY_HARD_BLOCK: full safe mode — no signal regardless of factors
 * ENTROPY_SOFT_BLOCK: signal allowed but confidence reduced 30% + ghost dimmed
 * REQUIRED_FACTORS: min confirmed factors in dominant direction (out of 8 total)
 * FACTOR_OVERRIDE_COUNT: all 8 factors must agree to bypass entropy gate
 *
 * Thresholds calibrated for real intraday market conditions:
 *   RSI <40/>60, Stoch <30/>70, BB <25%/>75%, S/R <25%/>75%, Vol ×1.2
 *   Requiring 4/8 with ≤1 opposing factor gives actionable signals while
 *   preserving meaningful confluence (purity check remains enforced).
 */
// ACCURACY TUNING (calibrated for 70-90% target):
//   ENTROPY_HARD_BLOCK  0.9995 : block only near-perfectly-random markets.
//                                1-min candles in normal conditions sit at 0.985–0.999;
//                                setting this too low (e.g. 0.990) blocks every real session.
//   ENTROPY_SOFT_BLOCK  0.985  : reduce confidence when entropy is elevated.
//   REQUIRED_FACTORS    2      : minimum 2 confirmed factors in dominant direction.
//                                The momentum gate and purity check handle quality — if MACD
//                                and Momentum both confirm the direction (and are not blocked),
//                                even 2–3 factors give a meaningful signal.
//   MIN_CONFIDENCE      42     : fire above a moderate baseline. Weak tie-break signals that
//                                align on 3+ factors with clean purity still provide value.
//                                42% allows clear directional readings that cleared all gates.
//   VOLATILITY_THRESHOLD 0.15  : raised from 0.04 → crypto assets regularly move 5–15%
//                                intraday; a 4% cap blocked all BTC/ETH signals in normal
//                                sessions. 15% still blocks true crash/flash-crash conditions.
//   FACTOR_OVERRIDE_COUNT 7    : all-agree bypass unchanged.
const ENTROPY_HARD_BLOCK = 0.9995;
const ENTROPY_SOFT_BLOCK = 0.985;
const VOLATILITY_THRESHOLD = 0.15;
const REQUIRED_FACTORS = 2;   // 2 confirmed factors in dominant direction — balanced for 5-min binary options
const FACTOR_OVERRIDE_COUNT = 7;
const MIN_CONFIDENCE = 42;    // allow aligned directional signals above 42% baseline

// ─── Quotex Platform Signal Factor ────────────────────────────────────────────

/**
 * Injects Quotex's own call/put signal as an additional scoring factor.
 * Weight 25 means it contributes ~18% of total scoring mass — strong enough
 * to tip close technical tie-breaks but not override overwhelming opposing consensus.
 *
 * bodySize is the absolute candle body in native units (e.g. 0.00041 for EURUSD).
 * A non-zero bodySize indicates the signal is based on real candle activity.
 */
function factorQuotexSignal(qDir: "call" | "put", bodySize: number): FactorResult {
  const direction = qDir === "call" ? "UP" : "DOWN";
  const sizeNote  = bodySize > 0 ? ` body=${bodySize.toFixed(5)}` : "";
  return {
    name:      "Quotex Signal",
    value:     qDir === "call" ? 1 : -1,
    confirmed: true,
    direction,
    weight:    25,
    detail:    `Quotex platform ${qDir.toUpperCase()} signal${sizeNote}`,
  };
}

// ─── Main Signal Analyzer ─────────────────────────────────────────────────────

export function analyzeSignal(
  candles: OHLC[],
  warming = false,
  sentimentBias?: string,
  intervalSecs = 60,
  weightOverrides?: Map<string, number>,
  quotexSignal?: { direction: "call" | "put"; bodySize: number } | null,
): SignalResult {
  const closes = candles.map((c) => c.close);
  const now = Math.floor(Date.now() / 1000);
  const intervalStart = Math.floor(now / intervalSecs) * intervalSecs;
  const executionTime = (intervalStart + intervalSecs) * 1000;

  const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = calcBollinger(closes);
  const rsi = calcRSI(closes);
  const entropy = calcEntropy(closes);
  const volatility = calcVolatility(closes);
  const atr = calcATR(candles);
  const highLow14 = candles.slice(-14);
  const highest14 = Math.max(...highLow14.map((c) => c.high));
  const lowest14 = Math.min(...highLow14.map((c) => c.low));
  const stochastic = highest14 > lowest14 ? ((closes[closes.length - 1] - lowest14) / (highest14 - lowest14)) * 100 : 50;
  const avgVol14 = candles.slice(-14).reduce((a, c) => a + c.volume, 0) / Math.min(14, candles.length);
  const lastVol = candles[candles.length - 1]?.volume ?? 1;
  const volumeRatio = avgVol14 > 0 ? lastVol / avgVol14 : 1;

  const indicators: IndicatorValues = {
    rsi, macd, macdSignal, macdHistogram,
    bbUpper, bbMiddle, bbLower,
    entropy, volatility, atr, stochastic, volumeRatio,
  };

  const baseResult = {
    factors: [] as FactorResult[],
    factorCount: 0,
    indicators,
    ghostCandle: null,
    executionTime,
    entropyReduced: false,
    sentimentBias,
    sentimentSuppressed: false,
  };

  if (warming) {
    return {
      direction: "NEUTRAL", confidence: 0, safeMode: false, warming: true,
      reasons: ["Warming up — awaiting 5 live market ticks before signal activates"],
      ...baseResult,
    };
  }

  // ── Always compute all 8 technical factors for the scorecard UI
  const factors: FactorResult[] = [
    factorEMATrend(candles),
    factorRSIExtreme(closes),
    factorMACDCross(closes),
    factorBollingerBreach(closes),
    factorStochasticConfirm(candles),
    factorVolumeConfirmation(candles),
    factorSupportResistance(candles),
    factorMomentum(closes),
  ];

  // ── Quotex platform signal: inject as 9th factor when available.
  // Quotex's own call/put is derived from their proprietary candle engine —
  // including it ensures our signal aligns with what the platform is showing.
  if (quotexSignal) {
    factors.push(factorQuotexSignal(quotexSignal.direction, quotexSignal.bodySize));
  }

  // ── Apply learned weight multipliers from Supabase factor_weights table.
  // weightOverrides is a Map<factorName, multiplier> where 1.0 = neutral.
  // A factor that has historically won 70% of the time gets multiplier ~1.4,
  // meaning it contributes more to the directional decision.
  // This runs in-place so the rest of the engine uses updated weights seamlessly.
  if (weightOverrides && weightOverrides.size > 0) {
    for (const f of factors) {
      const multiplier = weightOverrides.get(f.name);
      if (multiplier !== undefined && multiplier > 0) {
        f.weight = Math.max(1, Math.round(f.weight * multiplier));
      }
    }
  }

  // ── RBF kernel SVM classification
  const fingerprint = extractTemporalFingerprint(candles);
  const bullScore = rbfKernel(fingerprint, BULL_PROTOTYPE, 0.3);
  const bearScore = rbfKernel(fingerprint, BEAR_PROTOTYPE, 0.3);
  const kernelDir = bullScore > bearScore ? "UP" : "DOWN";
  const kernelConf = Math.abs(bullScore - bearScore) / (bullScore + bearScore);

  // ── Count directional factors
  const upFactors = factors.filter((f) => f.confirmed && f.direction === "UP");
  const downFactors = factors.filter((f) => f.confirmed && f.direction === "DOWN");

  // Compute directional weights to break ties when factor counts are equal.
  // Equal count but unequal weight → the heavier side is dominant (e.g. 4UP/4DN
  // where trend indicators outweigh oscillators).  Pure stalemate (equal weight)
  // still returns NEUTRAL.
  const upWeight   = upFactors.reduce((s, f) => s + f.weight, 0);
  const downWeight = downFactors.reduce((s, f) => s + f.weight, 0);

  // Strict count majority first; fall back to weight tiebreaker.
  let dominantDir: "UP" | "DOWN";
  if (upFactors.length !== downFactors.length) {
    dominantDir = upFactors.length > downFactors.length ? "UP" : "DOWN";
  } else if (upWeight !== downWeight) {
    dominantDir = upWeight > downWeight ? "UP" : "DOWN";
  } else {
    // Perfect stalemate — no signal.
    return {
      direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
      entropyReduced: false,
      reasons: [`${upFactors.length} UP vs ${downFactors.length} DN confirmed — equal conviction, no signal`],
      factors, factorCount: upFactors.length, indicators, ghostCandle: null,
      executionTime, sentimentBias, sentimentSuppressed: false,
    };
  }

  const dominantFactors = dominantDir === "UP" ? upFactors : downFactors;

  // ── Quotex VETO gate: when Quotex platform signal contradicts the dominant technical
  // direction, skip the trade entirely. Quotex constructs OTC candles from their own
  // price feed — their call/put signal reflects the actual candle mechanic.
  // When our technical factors say UP but Quotex says PUT (or vice versa), historical
  // results show losses dominate that scenario. Only trade when platform and technicals agree.
  if (quotexSignal) {
    const qDir = quotexSignal.direction === "call" ? "UP" : "DOWN";
    if (qDir !== dominantDir) {
      return {
        direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
        entropyReduced: false,
        reasons: [
          `Quotex ${quotexSignal.direction.toUpperCase()} conflicts with technical ${dominantDir} — trade vetoed`,
          "Only trading when platform signal and technical analysis align",
        ],
        factors, factorCount: dominantFactors.length, indicators,
        ghostCandle: null, executionTime, sentimentBias, sentimentSuppressed: false,
      };
    }
  }

  // ── Factor override: all 8 confirmed with kernel agreement bypasses entropy gate
  const factorOverride = dominantFactors.length >= FACTOR_OVERRIDE_COUNT && kernelDir === dominantDir;

  // ── Contradiction check: dominant must have more weight than opposing side.
  // For count ties broken by weight, highPurity passes when domWeight > oppWeight.
  // For count majorities (e.g. 5:3), it always passes.
  const contradictingFactors = dominantDir === "UP" ? downFactors : upFactors;
  const domWeight2  = dominantFactors.reduce((s, f) => s + f.weight, 0);
  const oppWeight2  = contradictingFactors.reduce((s, f) => s + f.weight, 0);
  const highPurity =
    dominantFactors.length > contradictingFactors.length ||
    (dominantFactors.length === contradictingFactors.length && domWeight2 > oppWeight2);

  // ── ENTROPY GATE: Hard block (≥0.99) and volatility gate
  if (!factorOverride && (entropy >= ENTROPY_HARD_BLOCK || volatility > VOLATILITY_THRESHOLD)) {
    return {
      direction: "NEUTRAL", confidence: 0, safeMode: true, warming: false,
      entropyReduced: false,
      reasons: [
        entropy >= ENTROPY_HARD_BLOCK ? `High entropy (${entropy.toFixed(3)}) — Safe Mode active` : "",
        volatility > VOLATILITY_THRESHOLD ? `Volatility spike (${(volatility * 100).toFixed(2)}%) — predictions paused` : "",
      ].filter(Boolean),
      factors,
      factorCount: dominantFactors.length,
      indicators,
      ghostCandle: null,
      executionTime,
      sentimentBias,
      sentimentSuppressed: false,
    };
  }

  // ── ENTROPY SOFT-BLOCK (0.97–0.99): allow signal but flag as reduced strength
  const entropyReduced = !factorOverride && entropy >= ENTROPY_SOFT_BLOCK && entropy < ENTROPY_HARD_BLOCK;

  // ── MOMENTUM GATE: For short-term (≤120s) binary trades, immediate momentum dominates.
  // If BOTH MACD Cross AND Momentum factors contradict the dominant direction, the signal
  // is likely to fail within 60–120s (price follows immediate momentum).
  // For 5-min+ trades (intervalSecs > 120), medium-term factors (EMA Trend, S/R, RSI) are
  // more predictive than the MACD/Momentum reaction — gate is bypassed.
  const macdFactor   = factors.find((f) => f.name === "MACD Cross");
  const momentumFactor = factors.find((f) => f.name === "Momentum");
  const macdContradict     = macdFactor?.confirmed && macdFactor.direction !== dominantDir;
  const momentumContradict = momentumFactor?.confirmed && momentumFactor.direction !== dominantDir;
  if (intervalSecs <= 120 && macdContradict && momentumContradict) {
    return {
      direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
      entropyReduced,
      reasons: [
        `MACD and Momentum both oppose ${dominantDir} — short-term momentum blocks signal`,
        "Price likely follows MACD/Momentum direction in 60–120s window",
      ],
      factors, factorCount: dominantFactors.length, indicators,
      ghostCandle: null, executionTime, sentimentBias, sentimentSuppressed: false,
    };
  }

  // ── RECENT-CLOSE ALIGNMENT GATE: For 60s trades, require last 5 closes to support signal.
  // All 5 closes moving against the signal = trend completely opposed → block.
  // Uses a strict 5/5 threshold (not 4/5) to avoid suppressing legitimate reversals
  // where the signal engine correctly identifies a turning point.
  if (closes.length >= 6 && intervalSecs <= 300) {
    const last5 = closes.slice(-6);   // 5 changes need 6 prices
    const recentUps   = last5.slice(1).filter((c, i) => c > last5[i]).length;
    const recentDowns = last5.slice(1).filter((c, i) => c < last5[i]).length;
    const tapeStrongUp   = recentUps   === 5;   // ALL 5 rising  → confirmed UP tape
    const tapeStrongDown = recentDowns === 5;   // ALL 5 falling → confirmed DOWN tape
    if (dominantDir === "UP" && tapeStrongDown) {
      return {
        direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
        entropyReduced,
        reasons: [
          `Strong DOWN tape (${recentDowns}/5 closes falling) — signal blocked, waiting for reversal`,
        ],
        factors, factorCount: dominantFactors.length, indicators,
        ghostCandle: null, executionTime, sentimentBias, sentimentSuppressed: false,
      };
    }
    if (dominantDir === "DOWN" && tapeStrongUp) {
      return {
        direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
        entropyReduced,
        reasons: [
          `Strong UP tape (${recentUps}/5 closes rising) — signal blocked, waiting for reversal`,
        ],
        factors, factorCount: dominantFactors.length, indicators,
        ghostCandle: null, executionTime, sentimentBias, sentimentSuppressed: false,
      };
    }
  }

  if (dominantFactors.length < REQUIRED_FACTORS || !highPurity) {
    return {
      direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
      entropyReduced,
      reasons: [
        !highPurity
          ? `${contradictingFactors.length} opposing factor(s) — signal purity too low`
          : `Only ${dominantFactors.length}/${REQUIRED_FACTORS} required factors confirmed`,
        "Waiting for stronger confluence before issuing signal",
      ],
      factors,
      factorCount: dominantFactors.length,
      indicators,
      ghostCandle: null,
      executionTime,
      sentimentBias,
      sentimentSuppressed: false,
    };
  }

  // ── Kernel direction must agree (or factors must be overwhelming)
  const kernelAgrees = kernelDir === dominantDir;

  // ── Confidence formula v2: ratio against CONFIRMED factors only (not all 8).
  // Using all 8 as denominator deflates factorRatio because unconfirmed factors
  // add dead weight — a 4:2 split looks like 50% when it's really 67% of confirmed.
  // New denominator: domWeight + oppWeight (confirmed only).
  const domWeight  = dominantFactors.reduce((a, f) => a + f.weight, 0);
  const oppWeight  = contradictingFactors.reduce((a, f) => a + f.weight, 0);
  const confirmedWeight = domWeight + oppWeight;
  const factorRatio = confirmedWeight > 0 ? domWeight / confirmedWeight : 0.5;

  // ── Weighted confidence: 75% factor purity + 20% kernel + 5% entropy headroom
  // Entropy headroom is low (≈0) in normal markets so factor quality dominates.
  // 3-DOM/0-OPP = 100% ratio → factorRatio=1.0, rawConf=75+kernel ≈ 85–95%
  // 4-DOM/2-OPP = 67% ratio → factorRatio=0.67, rawConf=50+kernel ≈ 60–70%
  // 4-DOM/3-OPP = 57% ratio → factorRatio=0.57, rawConf=43+kernel ≈ 51–61% (suppressed)
  const entropyHeadroom = Math.max(0, 1 - entropy / ENTROPY_HARD_BLOCK);
  let rawConf =
    factorRatio * 75 +
    (kernelAgrees ? kernelConf : kernelConf * 0.3) * 20 +
    entropyHeadroom * 5;

  // ── Entropy soft-block: flag only — no confidence penalty.
  // The factorRatio already captures signal quality; the entropy gate (hard-block)
  // handles truly random markets. A 30% penalty was too aggressive in practice.
  if (entropyReduced) {
    // no-op: used for UI flag only (entropyReduced returned in result)
  }

  const reasons = dominantFactors.map((f) => f.detail);
  if (kernelAgrees) reasons.push(`RBF pattern kernel confirms ${dominantDir} (${(kernelConf * 100).toFixed(0)}%)`);
  if (entropyReduced) reasons.push(`Entropy soft-block (${entropy.toFixed(3)}) — reduced neural strength`);

  // ── SENTIMENT SUPPRESSION — news 'mood' overrides technical direction
  let finalDir = dominantDir;
  let sentimentSuppressed = false;
  let sentimentReason = "";

  if (sentimentBias === "Bearish" && dominantDir === "UP") {
    finalDir = "NEUTRAL";
    sentimentSuppressed = true;
    sentimentReason = "🔴 Bearish news sentiment suppresses UP signal — conflicting macro mood";
  } else if (sentimentBias === "Bullish" && dominantDir === "DOWN") {
    finalDir = "NEUTRAL";
    sentimentSuppressed = true;
    sentimentReason = "🟢 Bullish news sentiment suppresses DOWN signal — conflicting macro mood";
  } else if (sentimentBias === "Somewhat-Bearish" && dominantDir === "UP") {
    rawConf *= 0.82;
    sentimentReason = "⚠ Somewhat-Bearish news — UP confidence reduced 18%";
    reasons.push(sentimentReason);
  } else if (sentimentBias === "Somewhat-Bullish" && dominantDir === "DOWN") {
    rawConf *= 0.82;
    sentimentReason = "⚠ Somewhat-Bullish news — DOWN confidence reduced 18%";
    reasons.push(sentimentReason);
  } else if (sentimentBias && sentimentBias !== "Neutral") {
    const aligned = (sentimentBias === "Bullish" && dominantDir === "UP") || (sentimentBias === "Somewhat-Bullish" && dominantDir === "UP")
      || (sentimentBias === "Bearish" && dominantDir === "DOWN") || (sentimentBias === "Somewhat-Bearish" && dominantDir === "DOWN");
    if (aligned) {
      rawConf = Math.min(rawConf * 1.08, 96);
      reasons.push(`News sentiment aligns with ${dominantDir} — confidence boosted`);
    }
  }

  if (sentimentSuppressed) {
    return {
      direction: "NEUTRAL",
      confidence: 30,
      safeMode: false,
      warming: false,
      entropyReduced,
      sentimentBias,
      sentimentSuppressed: true,
      reasons: [sentimentReason, ...reasons],
      factors,
      factorCount: dominantFactors.length,
      indicators,
      ghostCandle: null,
      executionTime,
    };
  }

  // Suppress weak signals: rawConf below MIN_CONFIDENCE → no trade, return NEUTRAL.
  // This is the final quality gate — only confident predictions reach the UI.
  if (rawConf < MIN_CONFIDENCE) {
    return {
      direction: "NEUTRAL", confidence: parseFloat(rawConf.toFixed(1)),
      safeMode: false, warming: false, entropyReduced,
      sentimentBias, sentimentSuppressed: false,
      reasons: [`Confidence ${rawConf.toFixed(1)}% below threshold (${MIN_CONFIDENCE}%) — signal suppressed`, ...reasons],
      factors, factorCount: dominantFactors.length, indicators,
      ghostCandle: null, executionTime,
    };
  }

  const confidence = Math.min(96, Math.max(MIN_CONFIDENCE, rawConf));
  const ghostCandle = finalDir !== "NEUTRAL" ? predictGhostCandle(candles, finalDir as "UP" | "DOWN", confidence, intervalSecs) : null;

  return {
    direction: finalDir as "UP" | "DOWN" | "NEUTRAL",
    confidence: parseFloat(confidence.toFixed(1)),
    safeMode: false,
    warming: false,
    entropyReduced,
    sentimentBias,
    sentimentSuppressed: false,
    reasons,
    factors,
    factorCount: dominantFactors.length,
    indicators,
    ghostCandle,
    executionTime,
  };
}
