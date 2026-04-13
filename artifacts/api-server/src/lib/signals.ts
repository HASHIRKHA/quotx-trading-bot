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
}

export interface SignalResult {
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  safeMode: boolean;
  reasons: string[];
  indicators: IndicatorValues;
}

function ema(closes: number[], period: number): number[] {
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
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.slice(-(ema26.length)).map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  return { macd: lastMacd, signal: lastSignal, histogram: lastMacd - lastSignal };
}

function calcBollinger(closes: number[], period = 20, stdMult = 2): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + stdMult * std, middle: mean, lower: mean - stdMult * std };
}

function calcEntropy(closes: number[], period = 20): number {
  if (closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const changes = slice.slice(1).map((c, i) => (c >= slice[i] ? 1 : 0));
  const ups = changes.filter(Boolean).length;
  const p = ups / changes.length;
  if (p === 0 || p === 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function calcVolatility(closes: number[], period = 14): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  return Math.sqrt(variance) / mean;
}

export function analyzeSignal(candles: OHLC[]): SignalResult {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi = calcRSI(closes);
  const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = calcBollinger(closes);
  const entropy = calcEntropy(closes);
  const volatility = calcVolatility(closes);

  const currentPrice = closes[closes.length - 1];

  const indicators: IndicatorValues = {
    rsi,
    macd,
    macdSignal,
    macdHistogram,
    bbUpper,
    bbMiddle,
    bbLower,
    entropy,
    volatility,
  };

  const ENTROPY_THRESHOLD = 0.97;
  const VOLATILITY_THRESHOLD = 0.04;

  if (entropy > ENTROPY_THRESHOLD || volatility > VOLATILITY_THRESHOLD) {
    return {
      direction: "NEUTRAL",
      confidence: 0,
      safeMode: true,
      reasons: [
        entropy > ENTROPY_THRESHOLD ? `Market entropy too high (${entropy.toFixed(3)}) — Safe Mode` : "",
        volatility > VOLATILITY_THRESHOLD ? `Extreme volatility detected (${(volatility * 100).toFixed(2)}%) — Paused` : "",
      ].filter(Boolean),
      indicators,
    };
  }

  const signals: { direction: "UP" | "DOWN"; weight: number; reason: string }[] = [];

  if (rsi < 30) {
    signals.push({ direction: "UP", weight: 30, reason: `RSI Oversold (${rsi.toFixed(1)})` });
  } else if (rsi > 70) {
    signals.push({ direction: "DOWN", weight: 30, reason: `RSI Overbought (${rsi.toFixed(1)})` });
  } else if (rsi < 45) {
    signals.push({ direction: "UP", weight: 10, reason: `RSI Bearish zone (${rsi.toFixed(1)})` });
  } else if (rsi > 55) {
    signals.push({ direction: "DOWN", weight: 10, reason: `RSI Bullish zone (${rsi.toFixed(1)})` });
  }

  if (macdHistogram > 0 && macd > macdSignal) {
    signals.push({ direction: "UP", weight: 25, reason: `MACD Bullish Cross (hist: ${macdHistogram.toFixed(5)})` });
  } else if (macdHistogram < 0 && macd < macdSignal) {
    signals.push({ direction: "DOWN", weight: 25, reason: `MACD Bearish Cross (hist: ${macdHistogram.toFixed(5)})` });
  }

  if (bbLower > 0 && currentPrice < bbLower) {
    signals.push({ direction: "UP", weight: 20, reason: `Price below Bollinger Lower Band (${bbLower.toFixed(5)})` });
  } else if (bbUpper > 0 && currentPrice > bbUpper) {
    signals.push({ direction: "DOWN", weight: 20, reason: `Price above Bollinger Upper Band (${bbUpper.toFixed(5)})` });
  }

  const recentCloses = closes.slice(-10);
  const trend = recentCloses[recentCloses.length - 1] - recentCloses[0];
  if (trend > 0) {
    signals.push({ direction: "UP", weight: 15, reason: `Bullish momentum (last 10 candles)` });
  } else if (trend < 0) {
    signals.push({ direction: "DOWN", weight: 15, reason: `Bearish momentum (last 10 candles)` });
  }

  const highLow14 = candles.slice(-14);
  const highest = Math.max(...highLow14.map((c) => c.high));
  const lowest = Math.min(...highLow14.map((c) => c.low));
  const stochastic = ((currentPrice - lowest) / (highest - lowest)) * 100;
  if (stochastic < 20) {
    signals.push({ direction: "UP", weight: 10, reason: `Stochastic oversold (${stochastic.toFixed(1)})` });
  } else if (stochastic > 80) {
    signals.push({ direction: "DOWN", weight: 10, reason: `Stochastic overbought (${stochastic.toFixed(1)})` });
  }

  if (signals.length === 0) {
    return {
      direction: "NEUTRAL",
      confidence: 50,
      safeMode: false,
      reasons: ["No strong signal — market is consolidating"],
      indicators,
    };
  }

  const upWeight = signals.filter((s) => s.direction === "UP").reduce((a, b) => a + b.weight, 0);
  const downWeight = signals.filter((s) => s.direction === "DOWN").reduce((a, b) => a + b.weight, 0);
  const totalWeight = upWeight + downWeight;

  const direction = upWeight > downWeight ? "UP" : "DOWN";
  const dominantWeight = Math.max(upWeight, downWeight);
  const rawConf = (dominantWeight / totalWeight) * 100;
  const confidence = Math.min(99, Math.max(51, rawConf));

  const reasons = signals
    .filter((s) => s.direction === direction)
    .map((s) => s.reason);

  return { direction, confidence, safeMode: false, reasons, indicators };
}
