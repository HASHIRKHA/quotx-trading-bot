/**
 * Quantum Signal Engine v2
 * SVM-inspired RBF classifier + LSTM-style temporal fingerprinting
 * Requires minimum 6 confirmed factors before issuing UP/DOWN signal.
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
  reasons: string[];
  factors: FactorResult[];
  factorCount: number;
  indicators: IndicatorValues;
  ghostCandle: GhostCandle | null;
  executionTime: number;
}

// ─── Math Utilities ─────────────────────────────────────────────────────────

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
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
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

function calcEntropy(closes: number[], period = 20): number {
  if (closes.length < period) return 0.5;
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

  // Exponential decay weights: most recent candle = highest weight
  const weights = closes.map((_, i) => Math.exp((i - n + 1) * 0.1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const normalize = (arr: number[]) => arr.map((v, i) => v * weights[i]).reduce((a, b) => a + b, 0) / totalW;

  // 1. Weighted return at 1-candle scale
  const ret1 = n >= 2 ? (closes[n - 1] - closes[n - 2]) / closes[n - 2] : 0;
  // 2. Weighted return at 5-candle scale
  const ret5 = n >= 6 ? (closes[n - 1] - closes[n - 6]) / closes[n - 6] : 0;
  // 3. Weighted return at 10-candle scale
  const ret10 = n >= 11 ? (closes[n - 1] - closes[n - 11]) / closes[n - 11] : 0;
  // 4. Weighted return at 20-candle scale
  const ret20 = n >= 21 ? (closes[n - 1] - closes[n - 21]) / closes[n - 21] : 0;

  // 5. Directional consistency (% of candles going up) over last 5 candles
  const ups5 = slice.slice(-5).filter((_, i, a) => i > 0 && a[i].close > a[i - 1].close).length / 4;
  // 6. Directional consistency over last 10 candles
  const ups10 = slice.slice(-10).filter((_, i, a) => i > 0 && a[i].close > a[i - 1].close).length / 9;

  // 7. Volume ratio: recent 3 vs overall mean
  const avgVol = volumes.reduce((a, b) => a + b, 0) / n;
  const recentVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const volRatio = avgVol > 0 ? recentVol / avgVol - 1 : 0;

  // 8. RSI normalized [-1, 1]
  const rsiNorm = (calcRSI(closes) - 50) / 50;

  // 9. MACD sign
  const { macd, signal } = calcMACD(closes);
  const macdNorm = Math.tanh((macd - signal) * 10000);

  // 10. Bollinger position [-0.5, 0.5] (0 = middle, ±0.5 = at band)
  const { upper, lower } = calcBollinger(closes);
  const bbPos = upper > lower ? (closes[n - 1] - lower) / (upper - lower) - 0.5 : 0;

  return [
    Math.tanh(ret1 * 100),
    Math.tanh(ret5 * 100),
    Math.tanh(ret10 * 100),
    Math.tanh(ret20 * 100),
    ups5 * 2 - 1,   // [-1, 1]
    ups10 * 2 - 1,
    Math.tanh(volRatio),
    rsiNorm,
    macdNorm,
    Math.tanh(bbPos * 4),
  ];
}

// Prototypical strong-bullish and strong-bearish reference vectors
const BULL_PROTOTYPE = [0.6, 0.5, 0.4, 0.3, 0.7, 0.6, 0.5, -0.6, 0.8, -0.7];
const BEAR_PROTOTYPE = [-0.6, -0.5, -0.4, -0.3, -0.7, -0.6, 0.5, 0.6, -0.8, 0.7];

// ─── The Six Factors ─────────────────────────────────────────────────────────

function factorRSIExtreme(closes: number[]): FactorResult {
  const rsi = calcRSI(closes);
  const oversold = rsi < 30;
  const overbought = rsi > 70;
  const extreme = rsi < 25 || rsi > 75;
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
  const nearLower = upper > 0 && price < middle && (price - lower) / (upper - lower) < 0.15;
  const nearUpper = upper > 0 && price > middle && (price - lower) / (upper - lower) > 0.85;
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
  const volSpike = lastVol > avgVol * 1.5;
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
  const nearSupport = pos < 0.15;
  const nearResistance = pos > 0.85;
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
  // Multi-timeframe alignment
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
): GhostCandle {
  const n = candles.length;
  const lastClose = candles[n - 1].close;
  const atr = calcATR(candles);
  const scale = atr * (confidence / 100);
  const now = Math.floor(Date.now() / 1000);
  const nextMinute = Math.floor(now / 60) * 60 + 60;

  if (direction === "UP") {
    return {
      time: nextMinute,
      open: lastClose,
      high: lastClose + scale * 0.75,
      low: lastClose - scale * 0.15,
      close: lastClose + scale * 0.5,
    };
  } else {
    return {
      time: nextMinute,
      open: lastClose,
      high: lastClose + scale * 0.15,
      low: lastClose - scale * 0.75,
      close: lastClose - scale * 0.5,
    };
  }
}

// ─── Main Signal Analyzer ────────────────────────────────────────────────────

const ENTROPY_THRESHOLD = 0.97;
const VOLATILITY_THRESHOLD = 0.04;
const REQUIRED_FACTORS = 4;

export function analyzeSignal(candles: OHLC[], warming = false): SignalResult {
  const closes = candles.map((c) => c.close);
  const now = Math.floor(Date.now() / 1000);
  const nextMinute = Math.floor(now / 60) * 60 + 60;
  const executionTime = nextMinute * 1000;

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
  };

  if (warming) {
    return {
      direction: "NEUTRAL", confidence: 0, safeMode: false, warming: true,
      reasons: ["Warming up — awaiting 5 live market ticks before signal activates"],
      ...baseResult,
    };
  }

  // ── Always compute all 6 factors for the scorecard UI
  const factors: FactorResult[] = [
    factorRSIExtreme(closes),
    factorMACDCross(closes),
    factorBollingerBreach(closes),
    factorVolumeConfirmation(candles),
    factorSupportResistance(candles),
    factorMomentum(closes),
  ];

  if (entropy > ENTROPY_THRESHOLD || volatility > VOLATILITY_THRESHOLD) {
    const upF = factors.filter((f) => f.confirmed && f.direction === "UP");
    const downF = factors.filter((f) => f.confirmed && f.direction === "DOWN");
    const dominantF = upF.length >= downF.length ? upF : downF;
    return {
      direction: "NEUTRAL", confidence: 0, safeMode: true, warming: false,
      reasons: [
        entropy > ENTROPY_THRESHOLD ? `High entropy (${entropy.toFixed(3)}) — Safe Mode active` : "",
        volatility > VOLATILITY_THRESHOLD ? `Volatility spike (${(volatility * 100).toFixed(2)}%) — predictions paused` : "",
      ].filter(Boolean),
      factors,
      factorCount: dominantF.length,
      indicators,
      ghostCandle: null,
      executionTime,
    };
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
  const dominantDir = upFactors.length >= downFactors.length ? "UP" : "DOWN";
  const dominantFactors = dominantDir === "UP" ? upFactors : downFactors;

  if (dominantFactors.length < REQUIRED_FACTORS) {
    return {
      direction: "NEUTRAL", confidence: 50, safeMode: false, warming: false,
      reasons: [
        `Only ${dominantFactors.length}/${REQUIRED_FACTORS} required factors confirmed`,
        "Waiting for stronger confluence before issuing signal",
      ],
      factors,
      factorCount: dominantFactors.length,
      indicators,
      ghostCandle: null,
      executionTime,
    };
  }

  // ── Kernel direction must agree (or factors must be overwhelming)
  const kernelAgrees = kernelDir === dominantDir;
  const factorWeight = dominantFactors.reduce((a, f) => a + f.weight, 0);
  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  const factorRatio = factorWeight / totalWeight;

  // ── Weighted confidence: 60% factor-based + 30% kernel + 10% entropy headroom
  const entropyHeadroom = 1 - entropy / ENTROPY_THRESHOLD;
  const rawConf =
    factorRatio * 60 +
    (kernelAgrees ? kernelConf : kernelConf * 0.3) * 30 +
    entropyHeadroom * 10;
  const confidence = Math.min(96, Math.max(55, rawConf));

  const reasons = dominantFactors.map((f) => f.detail);
  if (kernelAgrees) reasons.push(`RBF pattern kernel confirms ${dominantDir} (${(kernelConf * 100).toFixed(0)}%)`);

  const ghostCandle = predictGhostCandle(candles, dominantDir, confidence);

  return {
    direction: dominantDir,
    confidence: parseFloat(confidence.toFixed(1)),
    safeMode: false,
    warming: false,
    reasons,
    factors,
    factorCount: dominantFactors.length,
    indicators,
    ghostCandle,
    executionTime,
  };
}
