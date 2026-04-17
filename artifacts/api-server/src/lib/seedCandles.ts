import type { OHLC } from "./signals.js";

const BASE_PRICES: Record<string, number> = {
  "EUR/USD": 1.1685,
  "GBP/USD": 1.2720,
  "USD/JPY": 149.85,
  "BTC/USD": 104500,
  "ETH/USD": 3420,
};

const TREND_STRENGTH: Record<string, number> = {
  "EUR/USD": 0.00015,
  "GBP/USD": 0.00018,
  "USD/JPY": 0.018,
  "BTC/USD": 80,
  "ETH/USD": 3.5,
};

const VOLATILITY: Record<string, number> = {
  "EUR/USD": 0.00012,
  "GBP/USD": 0.00015,
  "USD/JPY": 0.014,
  "BTC/USD": 55,
  "ETH/USD": 2.8,
};

export function generateSeedCandles(symbol: string, count = 200): OHLC[] {
  const basePrice = BASE_PRICES[symbol] ?? 1.0;
  const trendStrength = TREND_STRENGTH[symbol] ?? 0.0001;
  const vol = VOLATILITY[symbol] ?? 0.0001;
  const isCrypto = symbol.includes("BTC") || symbol.includes("ETH");
  const isJpy = symbol.includes("JPY");
  const decimals = isCrypto ? 2 : isJpy ? 3 : 5;
  const now = Math.floor(Date.now() / 1000);
  const minuteNow = Math.floor(now / 60) * 60;

  const candles: OHLC[] = [];
  let price = basePrice;

  let trendDir = 1;
  let trendCount = 0;

  for (let i = count - 1; i >= 0; i--) {
    const time = minuteNow - i * 60;

    if (trendCount <= 0) {
      trendDir = Math.random() > 0.5 ? 1 : -1;
      trendCount = Math.floor(Math.random() * 15) + 8;
    }
    trendCount--;

    const trend = trendDir * trendStrength * (0.5 + Math.random() * 0.5);
    const noise = (Math.random() - 0.5) * vol;
    const move = trend + noise;

    const open = price;
    price = price + move;

    const wickRange = vol * (0.5 + Math.random());
    const high = Math.max(open, price) + wickRange * Math.random();
    const low = Math.min(open, price) - wickRange * Math.random();
    const close = price;

    candles.push({
      time,
      open: parseFloat(open.toFixed(decimals)),
      high: parseFloat(high.toFixed(decimals)),
      low: parseFloat(low.toFixed(decimals)),
      close: parseFloat(close.toFixed(decimals)),
      volume: Math.floor(Math.random() * 400) + 200,
    });
  }

  return candles;
}
