import type { OHLC } from "./signals.js";

/**
 * Realistic base prices for all 63 trading pairs (approximate current market rates).
 * Used as the anchor for synthetic seed candles when no live/DB data is available.
 * OTC variants share their underlying pair price since they track the same instrument.
 *
 * NOTE: These values are intentionally approximate. Once Deriv WebSocket connects
 * (within 2-5 s of startup), real prices override the synthetic seed via setLiveTick().
 * The seed only matters during the initial loading window before the first live tick.
 */
const BASE_PRICES: Record<string, number> = {
  // ── Crypto (24/7) ──────────────────────────────────────────────────────────
  "BTC/USD":       104500,
  "ETH/USD":        3420,
  "SOL/USD":         175,
  // ── Commodity ──────────────────────────────────────────────────────────────
  "XAU/USD":        3350,
  // ── Major forex ────────────────────────────────────────────────────────────
  "EUR/USD":       1.1650,   "EUR/USD OTC":   1.1650,
  "GBP/USD":       1.3430,   "GBP/USD OTC":   1.3430,
  "AUD/USD":       0.7150,   "AUD/USD OTC":   0.7150,
  "NZD/USD":       0.5870,   "NZD/USD OTC":   0.5870,
  "USD/JPY":     158.90,     "USD/JPY OTC": 158.90,
  "USD/CAD":       1.3820,   "USD/CAD OTC":   1.3820,
  "USD/CHF":       0.7860,   "USD/CHF OTC":   0.7860,
  // ── JPY crosses ────────────────────────────────────────────────────────────
  "GBP/JPY":     213.50,     "GBP/JPY OTC": 213.50,
  "AUD/JPY":     113.60,     "AUD/JPY OTC": 113.60,
  "EUR/JPY":     185.00,     "EUR/JPY OTC": 185.00,
  "NZD/JPY":      93.30,     "NZD/JPY OTC":  93.30,
  "CAD/JPY":     115.50,     "CAD/JPY OTC": 115.50,
  "CHF/JPY":     202.00,     "CHF/JPY OTC": 202.00,
  // ── EUR crosses ────────────────────────────────────────────────────────────
  "EUR/GBP":       0.9190,   "EUR/GBP OTC":   0.9190,
  "EUR/CAD":       1.6010,   "EUR/CAD OTC":   1.6010,
  "EUR/AUD":       1.6280,   "EUR/AUD OTC":   1.6280,
  "EUR/CHF":       1.0480,   "EUR/CHF OTC":   1.0480,
  "EUR/NZD":       1.9680,   "EUR/NZD OTC":   1.9680,
  // ── GBP crosses ────────────────────────────────────────────────────────────
  "GBP/AUD":       1.8760,   "GBP/AUD OTC":   1.8760,
  "GBP/CAD":       1.8460,   "GBP/CAD OTC":   1.8460,
  "GBP/CHF":       1.0000,   "GBP/CHF OTC":   1.0000,
  "GBP/NZD":       2.1420,   "GBP/NZD OTC":   2.1420,
  // ── AUD crosses ────────────────────────────────────────────────────────────
  "AUD/CAD":       0.9890,   "AUD/CAD OTC":   0.9890,
  "AUD/CHF":       0.5630,   "AUD/CHF OTC":   0.5630,
  "AUD/NZD":       1.2210,   "AUD/NZD OTC":   1.2210,
  // ── NZD crosses ────────────────────────────────────────────────────────────
  "NZD/CAD":       0.8050,   "NZD/CAD OTC":   0.8050,
  "NZD/CHF":       0.4620,   "NZD/CHF OTC":   0.4620,
  // ── CAD/CHF cross ──────────────────────────────────────────────────────────
  "CAD/CHF":       0.5700,   "CAD/CHF OTC":   0.5700,
  // ── Exotic OTC (synthetic — no external feed) ──────────────────────────────
  "USD/EGP OTC":  48.80,
  "USD/IDR OTC":  16350,
  "USD/DZD OTC":  134.50,
};

/**
 * Per-pip trend strength — defines how much price drifts per candle.
 * Must be proportional to the pair's typical pip size.
 */
const TREND_STRENGTH: Record<string, number> = {
  // Crypto
  "BTC/USD":      80.0,
  "ETH/USD":       3.5,
  "SOL/USD":       0.8,
  // Commodity
  "XAU/USD":       2.0,
  // USD majors
  "EUR/USD":       0.00015,
  "GBP/USD":       0.00018,
  "AUD/USD":       0.00012,
  "NZD/USD":       0.00010,
  "USD/JPY":       0.020,
  "USD/CAD":       0.00014,
  "USD/CHF":       0.00012,
  // JPY crosses
  "GBP/JPY":       0.025,
  "AUD/JPY":       0.018,
  "EUR/JPY":       0.022,
  "NZD/JPY":       0.015,
  "CAD/JPY":       0.016,
  "CHF/JPY":       0.020,
  // EUR crosses
  "EUR/GBP":       0.00010,
  "EUR/CAD":       0.00016,
  "EUR/AUD":       0.00018,
  "EUR/CHF":       0.00010,
  "EUR/NZD":       0.00020,
  // GBP crosses
  "GBP/AUD":       0.00022,
  "GBP/CAD":       0.00020,
  "GBP/CHF":       0.00015,
  "GBP/NZD":       0.00025,
  // AUD crosses
  "AUD/CAD":       0.00012,
  "AUD/CHF":       0.00010,
  "AUD/NZD":       0.00012,
  // NZD crosses
  "NZD/CAD":       0.00010,
  "NZD/CHF":       0.00009,
  // CAD/CHF
  "CAD/CHF":       0.00010,
  // Exotic OTC
  "USD/EGP OTC":   0.008,
  "USD/IDR OTC":   5.0,
  "USD/DZD OTC":   0.015,
};

/**
 * Per-candle volatility (noise amplitude).
 * Slightly lower than trend strength so direction is clear in seeds.
 */
const VOLATILITY: Record<string, number> = {
  // Crypto
  "BTC/USD":      55.0,
  "ETH/USD":       2.8,
  "SOL/USD":       0.6,
  // Commodity
  "XAU/USD":       1.5,
  // USD majors
  "EUR/USD":       0.00012,
  "GBP/USD":       0.00015,
  "AUD/USD":       0.00010,
  "NZD/USD":       0.00008,
  "USD/JPY":       0.016,
  "USD/CAD":       0.00012,
  "USD/CHF":       0.00010,
  // JPY crosses
  "GBP/JPY":       0.020,
  "AUD/JPY":       0.015,
  "EUR/JPY":       0.018,
  "NZD/JPY":       0.012,
  "CAD/JPY":       0.013,
  "CHF/JPY":       0.017,
  // EUR crosses
  "EUR/GBP":       0.00008,
  "EUR/CAD":       0.00013,
  "EUR/AUD":       0.00015,
  "EUR/CHF":       0.00008,
  "EUR/NZD":       0.00017,
  // GBP crosses
  "GBP/AUD":       0.00018,
  "GBP/CAD":       0.00016,
  "GBP/CHF":       0.00012,
  "GBP/NZD":       0.00020,
  // AUD crosses
  "AUD/CAD":       0.00010,
  "AUD/CHF":       0.00008,
  "AUD/NZD":       0.00010,
  // NZD crosses
  "NZD/CAD":       0.00008,
  "NZD/CHF":       0.00007,
  // CAD/CHF
  "CAD/CHF":       0.00008,
  // Exotic OTC
  "USD/EGP OTC":   0.005,
  "USD/IDR OTC":   3.0,
  "USD/DZD OTC":   0.010,
};

/** Resolve OTC variants to their underlying pair for parameters lookup */
function resolveBasePair(symbol: string): string {
  return symbol.endsWith(" OTC") ? symbol.slice(0, -4) : symbol;
}

/**
 * Returns the expected base price for a symbol (used for DB sanity checks).
 * OTC variants fall back to their underlying pair if not listed separately.
 */
export function getBasePriceForSymbol(symbol: string): number {
  if (BASE_PRICES[symbol] !== undefined) return BASE_PRICES[symbol]!;
  const basePair = symbol.endsWith(" OTC") ? symbol.slice(0, -4) : symbol;
  return BASE_PRICES[basePair] ?? 1.0;
}

export function generateSeedCandles(symbol: string, count = 200, baseOverride?: number): OHLC[] {
  // OTC variants share the same parameters as the underlying pair
  const basePair = resolveBasePair(symbol);

  const basePrice = baseOverride ?? BASE_PRICES[symbol] ?? BASE_PRICES[basePair] ?? 1.0;
  const trendStrength = TREND_STRENGTH[symbol] ?? TREND_STRENGTH[basePair] ?? 0.0001;
  const vol = VOLATILITY[symbol] ?? VOLATILITY[basePair] ?? 0.0001;

  const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL");
  const isGold   = symbol.includes("XAU");
  const isJpy    = symbol.includes("JPY");
  const isIdr    = symbol.includes("IDR");
  const isDzd    = symbol.includes("DZD") || symbol.includes("EGP");
  const isHighValue = basePrice > 1000; // BTC, ETH range
  const decimals = isHighValue ? 2 : isGold ? 2 : isIdr ? 0 : isDzd ? 2 : isJpy ? 3 : 5;

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
      open:   parseFloat(open.toFixed(decimals)),
      high:   parseFloat(high.toFixed(decimals)),
      low:    parseFloat(low.toFixed(decimals)),
      close:  parseFloat(close.toFixed(decimals)),
      volume: Math.floor(Math.random() * 400) + 200,
    });
  }

  return candles;
}
