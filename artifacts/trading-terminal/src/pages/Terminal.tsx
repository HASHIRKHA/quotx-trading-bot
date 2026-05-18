import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TradingChart } from '@/components/TradingChart';
import { IndicatorsPanel } from '@/components/IndicatorsPanel';
import { ReasoningSidebar } from '@/components/ReasoningSidebar';
import { TradePanel } from '@/components/TradePanel';
import { StatsPanel } from '@/components/StatsPanel';
import { PerformanceDashboard } from '@/components/PerformanceDashboard';
import { useGetMarketSymbols } from '@workspace/api-client-react';
import {
  Activity, Wifi, WifiOff, AlertTriangle, TrendingUp, TrendingDown,
  Zap, BarChart2, Bell,
  CheckCircle2, XCircle,
} from 'lucide-react';

const FALLBACK_SYMBOLS = [
  { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar',  type: 'crypto'    },
  { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', type: 'crypto'    },
  { symbol: 'XAU/USD', name: 'Gold / US Dollar',     type: 'commodity' },
  { symbol: 'SOL/USD', name: 'Solana / US Dollar',   type: 'crypto'    },
];

function formatPrice(symbol: string, price: number): string {
  if (symbol.includes('BTC')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (symbol.includes('ETH')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (symbol.includes('XAU')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (symbol.includes('SOL')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(5);
}

/* ─── Animated background light streaks ──────────────── */
function BackgroundStreaks() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Radial glow blobs */}
      <div
        className="absolute"
        style={{
          top: '-15%', right: '-5%',
          width: '55%', height: '70%',
          background: 'radial-gradient(ellipse, rgba(0,200,80,0.08) 0%, transparent 65%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute"
        style={{
          bottom: '-10%', left: '-5%',
          width: '40%', height: '50%',
          background: 'radial-gradient(ellipse, rgba(0,150,60,0.06) 0%, transparent 60%)',
          filter: 'blur(60px)',
        }}
      />
      {/* Diagonal streaks */}
      <div className="light-streak light-streak-a" />
      <div className="light-streak light-streak-b" />
      <div className="light-streak light-streak-c" />
      <div className="light-streak light-streak-d" />
    </div>
  );
}

/* ─── Ticker item ─────────────────────────────────────── */
function TickerItem({
  symbol, price, prevPrice,
}: { symbol: string; price?: number; prevPrice?: number }) {
  const up   = price !== undefined && prevPrice !== undefined && price > prevPrice;
  const down = price !== undefined && prevPrice !== undefined && price < prevPrice;
  const pct  = price && prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0;

  return (
    <div className="flex items-center gap-2 px-5 border-r border-white/5 shrink-0 select-none">
      <span className="text-xs font-mono text-[rgba(180,230,190,0.7)] tracking-wide">{symbol}</span>
      <motion.span
        key={price}
        initial={{ y: up ? 4 : down ? -4 : 0, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className={`text-xs font-mono font-semibold ${
          up ? 'text-[#00ff85]' : down ? 'text-red-400' : 'text-[rgba(200,240,210,0.8)]'
        }`}
      >
        {price ? formatPrice(symbol, price) : '—'}
      </motion.span>
      {Math.abs(pct) > 0.001 && (
        <span className={`text-[10px] font-mono ${up ? 'text-[#00ff85]/70' : 'text-red-400/70'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
      {up   && <TrendingUp  size={11} className="text-[#00ff85]/60" />}
      {down && <TrendingDown size={11} className="text-red-400/60" />}
    </div>
  );
}

/* ─── Symbol selector pill ────────────────────────────── */
function SymbolPill({
  sym, active, onClick,
}: { sym: { symbol: string; type: string }; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono transition-all duration-200 ${
        active
          ? 'bg-[#00ff85]/15 border border-[#00ff85]/40 text-[#00ff85] shadow-[0_0_12px_rgba(0,255,133,0.25)]'
          : 'border border-white/8 text-[rgba(180,230,190,0.5)] hover:border-[#00ff85]/20 hover:text-[rgba(180,230,190,0.8)]'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          sym.type === 'crypto' ? 'bg-amber-400' : 'bg-[#00ff85]'
        } ${active ? 'shadow-[0_0_6px_rgba(0,255,133,0.8)]' : 'opacity-50'}`}
      />
      {sym.symbol}
    </button>
  );
}

/* ─── Interval button ────────────────────────────────── */
function IntervalBtn({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-mono rounded transition-all duration-150 ${
        active
          ? 'bg-[#00ff85]/20 text-[#00ff85] border border-[#00ff85]/30'
          : 'text-[rgba(180,230,190,0.45)] hover:text-[rgba(180,230,190,0.8)] hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );
}

/* ─── Compact Factor Scorecard (always visible, no scroll needed) ─────────────── */
interface FactorResult {
  name: string;
  value: number;
  confirmed: boolean;
  direction: string;
  weight: number;
  detail: string;
}

function FactorScorecard({ factors, factorCount }: { factors: FactorResult[]; factorCount: number }) {
  if (factors.length === 0) return null;

  const abbrev: Record<string, string> = {
    'EMA Trend': 'EMA Trend', 'RSI Extreme': 'RSI', 'MACD Cross': 'MACD',
    'Bollinger Breach': 'Bollinger', 'Stochastic %K': 'Stochastic',
    'Volume Confirmation': 'Volume', 'S/R Bounce': 'S/R',
    'Momentum': 'Momentum', 'Quotex Signal': 'Quotex', 'RBF Kernel': 'RBF',
  };

  return (
    <div className="shrink-0 px-3 pt-1.5 pb-2" style={{ borderBottom: '1px solid rgba(0,255,100,0.08)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono tracking-widest text-[rgba(180,230,190,0.45)] uppercase">Signal Factors</span>
        <span className={`text-[10px] font-mono font-bold ${factorCount >= 4 ? 'text-[#00ff85]' : factorCount >= 2 ? 'text-amber-400' : 'text-[rgba(180,230,190,0.35)]'}`}>
          {factorCount}/{factors.length} confirmed
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
        {factors.map((factor, idx) => {
          const isUp = factor.confirmed && factor.direction === 'UP';
          const isDown = factor.confirmed && factor.direction === 'DOWN';
          const isQuotex = factor.name === 'Quotex Signal';
          return (
            <motion.div
              key={factor.name}
              initial={{ x: -4, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: idx * 0.02 }}
              className={`flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-mono ${
                isUp ? (isQuotex ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-green-500/8 border border-green-500/15')
                : isDown ? (isQuotex ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-red-500/8 border border-red-500/15')
                : 'bg-transparent border border-transparent'
              }`}
            >
              {factor.confirmed
                ? <CheckCircle2 size={9} className={`shrink-0 ${isUp ? (isQuotex ? 'text-blue-400' : 'text-green-400') : (isQuotex ? 'text-blue-400' : 'text-red-400')}`} />
                : <XCircle    size={9} className="shrink-0 text-[rgba(180,230,190,0.15)]" />
              }
              <span className={`flex-1 truncate ${isUp ? (isQuotex ? 'text-blue-300' : 'text-green-300') : isDown ? (isQuotex ? 'text-blue-300' : 'text-red-300') : 'text-[rgba(180,230,190,0.25)]'}`}>
                {abbrev[factor.name] ?? factor.name}
                {isQuotex && <span className="ml-0.5 text-[6px] opacity-50"> PLT</span>}
              </span>
              <span className={`shrink-0 font-bold text-[8px] ${isUp ? (isQuotex ? 'text-blue-400' : 'text-[#00ff85]') : isDown ? (isQuotex ? 'text-blue-400' : 'text-red-400') : 'text-[rgba(180,230,190,0.15)]'}`}>
                {isUp ? '↑' : isDown ? '↓' : '—'}
              </span>
              <span className="shrink-0 text-[7px] text-[rgba(180,230,190,0.18)] w-4 text-right tabular-nums">{factor.weight}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Terminal ───────────────────────────────────── */
export default function Terminal() {
  const [symbol, setSymbol]         = useState('BTC/USD');
  const [timeframe, setTimeframe]   = useState('1m');
  const [bottomTab, setBottomTab]   = useState<'HISTORY' | 'NEURAL'>('HISTORY');
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});

  const { prices, isConnected, circuitBreaker, latency } = useWebSocket();

  const { data: symbolsData } = useGetMarketSymbols();
  const symbols = Array.isArray(symbolsData) && symbolsData.length > 0
    ? symbolsData
    : FALLBACK_SYMBOLS;

  const currentPrice = prices[symbol];
  const intervalSecs = timeframe === '5m' ? 300 : timeframe === '10m' ? 600 : 60;

  // Track ALL symbols' previous prices so the ticker strip shows correct % change
  // for every symbol, not just the currently selected one.
  const allPrevRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const snapshot: Record<string, number> = {};
    for (const [sym, price] of Object.entries(prices)) {
      if (price !== undefined) {
        if (allPrevRef.current[sym] !== undefined) {
          snapshot[sym] = allPrevRef.current[sym];
        }
        allPrevRef.current[sym] = price;
      }
    }
    if (Object.keys(snapshot).length > 0) {
      setPrevPrices(p => ({ ...p, ...snapshot }));
    }
  }, [prices]);

  // Derive price direction for the selected symbol from prevPrices
  const priceDirection: 'up' | 'down' | null =
    currentPrice !== undefined && prevPrices[symbol] !== undefined
      ? currentPrice > prevPrices[symbol] ? 'up'
      : currentPrice < prevPrices[symbol] ? 'down'
      : null
      : null;

  const { data: signal } = useQuery<any>({
    queryKey: ['signal', symbol, timeframe],
    queryFn: () => {
      const base = (window as any).__QUOTX_API_BASE__ ?? '';
      return fetch(`${base}/api/market/signal/${encodeURIComponent(symbol)}?interval=${timeframe}`)
        .then(r => r.json());
    },
    refetchInterval: 7000,
  });

  const isDanger        = !!(signal?.indicators?.rsi && signal.indicators.rsi > 70);
  const isBull          = !!(signal?.indicators?.rsi && signal.indicators.rsi < 30);
  const ghostCandle     = (signal as any)?.ghostCandle ?? null;
  const entropyReduced  = (signal as any)?.entropyReduced === true;
  const sentimentBias   = (signal as any)?.sentimentBias as string | undefined;
  const sentimentSuppressed = (signal as any)?.sentimentSuppressed === true;

  const sigDir        = signal?.direction ?? 'NEUTRAL';
  const sigConf       = signal?.confidence ?? 0;
  const sigIsUp       = sigDir === 'UP';
  const sigIsDown     = sigDir === 'DOWN';
  const sigIsNeutral  = sigDir === 'NEUTRAL';
  const sigIsSafe     = !!signal?.safeMode;
  const sigIsWarming  = !!signal?.warming;
  const sigFactors    = ((signal as any)?.factors ?? []) as FactorResult[];
  const sigFactorCount = (signal as any)?.factorCount ?? 0;

  return (
    <div
      className="flex flex-col h-[100dvh] w-full overflow-hidden text-[rgba(200,240,210,0.9)] font-sans select-none"
      style={{ background: '#050d07' }}
    >
      <BackgroundStreaks />

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header
        className="relative z-10 h-[56px] shrink-0 flex items-center justify-between px-5 gap-4"
        style={{
          background: 'rgba(5,14,7,0.92)',
          borderBottom: '1px solid rgba(0,255,100,0.1)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative flex items-center justify-center w-7 h-7">
            <div
              className="absolute inset-0 rounded-md animate-pulse"
              style={{ background: 'rgba(0,255,100,0.15)', boxShadow: '0 0 10px rgba(0,255,100,0.3)' }}
            />
            <Zap size={16} className="relative text-[#00ff85]" />
          </div>
          <span
            className="text-base font-bold tracking-widest text-[#00ff85]"
            style={{ textShadow: '0 0 16px rgba(0,255,133,0.6)' }}
          >
            QUANTUM
          </span>
          <span className="text-base font-light tracking-widest text-[rgba(200,240,210,0.7)]">TERMINAL</span>
        </div>

        {/* Symbol selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {symbols.map(s => (
            <SymbolPill
              key={s.symbol}
              sym={s}
              active={symbol === s.symbol}
              onClick={() => setSymbol(s.symbol)}
            />
          ))}
        </div>

        {/* Interval selector */}
        <div className="flex items-center gap-1 bg-black/30 rounded-lg px-1 py-1 border border-white/6 shrink-0">
          {['1m', '5m', '10m'].map(i => (
            <IntervalBtn key={i} label={i} active={timeframe === i} onClick={() => setTimeframe(i)} />
          ))}
        </div>

        {/* Right: price + status */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Live price */}
          <motion.div
            key={currentPrice}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.25 }}
            className={`font-mono font-bold text-lg tracking-tight transition-colors duration-300 ${
              priceDirection === 'up'
                ? 'text-[#00ff85]'
                : priceDirection === 'down'
                ? 'text-red-400'
                : 'text-[rgba(200,240,210,0.9)]'
            }`}
            style={priceDirection === 'up'
              ? { textShadow: '0 0 12px rgba(0,255,133,0.7)' }
              : priceDirection === 'down'
              ? { textShadow: '0 0 12px rgba(255,80,80,0.6)' }
              : {}
            }
          >
            {currentPrice ? formatPrice(symbol, currentPrice) : '———'}
            {priceDirection === 'up'   && <span className="ml-1 text-sm">▲</span>}
            {priceDirection === 'down' && <span className="ml-1 text-sm text-red-400">▼</span>}
          </motion.div>

          {/* Status badges */}
          <div className="flex items-center gap-2 text-[11px] font-mono">
            {sigIsWarming && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 animate-pulse">
                <Activity size={10} /> WARMING
              </span>
            )}
            {sigIsSafe && !sigIsWarming && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 animate-pulse">
                <AlertTriangle size={10} /> SAFE MODE
              </span>
            )}
            {entropyReduced && !sigIsSafe && !sigIsWarming && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/8 border border-amber-500/20 text-amber-400/70">
                <AlertTriangle size={10} /> LOW ENT
              </span>
            )}

            {/* WS status */}
            <span
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                circuitBreaker
                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                  : isConnected
                  ? 'bg-[#00ff85]/8 border-[#00ff85]/25 text-[#00ff85]/80'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {isConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
              {circuitBreaker ? 'CB' : isConnected ? `${latency}ms` : 'OFFLINE'}
            </span>
          </div>

          <Bell size={15} className="text-[rgba(180,230,190,0.2)] transition-colors" aria-label="Notifications coming soon" />
        </div>
      </header>

      {/* ── TICKER STRIP ────────────────────────────────────── */}
      <div
        className="relative z-10 h-9 shrink-0 flex items-center overflow-hidden"
        style={{
          background: 'rgba(4,12,5,0.85)',
          borderBottom: '1px solid rgba(0,255,100,0.07)',
        }}
      >
        <div
          className="shrink-0 flex items-center gap-1.5 px-3 text-[10px] font-mono text-[#00ff85]/60 border-r border-white/6"
          style={{ minWidth: 110 }}
        >
          <TrendingUp size={11} className="text-[#00ff85]/50" />
          LIVE FEED
        </div>
        {/* Scrolling track — doubled for seamless loop */}
        <div className="flex-1 overflow-hidden">
          <div className="ticker-track">
            {[...symbols, ...symbols].map((s, i) => (
              <TickerItem
                key={`${s.symbol}-${i}`}
                symbol={s.symbol}
                price={prices[s.symbol]}
                prevPrice={prevPrices[s.symbol]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL: Signal + Trade ────────────────────── */}
        <div
          className="w-[285px] shrink-0 flex flex-col overflow-hidden"
          style={{
            background: 'rgba(5,12,7,0.7)',
            borderRight: '1px solid rgba(0,255,100,0.09)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {/* Signal direction indicator at top of panel */}
          <div
            className="shrink-0 px-4 pt-3 pb-2"
            style={{ borderBottom: '1px solid rgba(0,255,100,0.08)' }}
          >
            {/* Row 1: label + status */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-widest text-[rgba(180,230,190,0.5)] uppercase">
                Quantum AI Reasoner
              </span>
              <div className="flex items-center gap-1.5">
                <div className="relative w-2 h-2">
                  <div className={`absolute inset-0 rounded-full ${sigIsUp ? 'bg-[#00ff85]' : sigIsDown ? 'bg-red-400' : 'bg-[rgba(180,230,190,0.3)]'}`} />
                  {(sigIsUp || sigIsDown) && (
                    <div className={`absolute inset-0 rounded-full signal-ping ${sigIsUp ? 'bg-[#00ff85]' : 'bg-red-400'}`} />
                  )}
                </div>
                <span className={`text-[10px] font-mono font-bold ${sigIsUp ? 'text-[#00ff85]' : sigIsDown ? 'text-red-400' : 'text-[rgba(180,230,190,0.4)]'}`}>
                  {sigIsWarming ? 'WARMING' : sigIsSafe ? 'SAFE MODE' : sigDir}
                </span>
              </div>
            </div>

            {/* Row 2: direction badge */}
            {!sigIsWarming && (
              <motion.div
                key={sigDir}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`flex items-center justify-center gap-2 py-1.5 rounded-lg border mb-2 ${
                  sigIsNeutral ? 'border-gray-500/30 bg-gray-500/10 text-gray-400'
                  : sigIsUp    ? 'border-[#00ff85]/30 bg-[#00ff85]/10 text-[#00ff85]'
                  :              'border-red-500/30 bg-red-500/10 text-red-400'
                }`}
                style={{ boxShadow: sigIsNeutral ? 'none' : sigIsUp ? '0 0 12px rgba(0,255,133,0.15)' : '0 0 12px rgba(239,68,68,0.15)' }}
              >
                {sigIsUp   && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>}
                {sigIsDown && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>}
                <span className="text-sm font-bold tracking-widest">{sigIsWarming ? 'WARMING' : sigDir}</span>
              </motion.div>
            )}
            {sigIsWarming && (
              <div className="flex items-center justify-center gap-2 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 mb-2">
                <span className="text-sm font-bold tracking-widest animate-pulse">WARMING UP</span>
              </div>
            )}

            {/* Row 3: confidence bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  animate={{ width: `${sigConf}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  style={{
                    background: sigConf > 70 ? 'linear-gradient(90deg,#00cc60,#00ff85)' : sigConf > 50 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'rgba(107,114,128,0.6)',
                    boxShadow: sigConf > 70 ? '0 0 8px rgba(0,255,133,0.6)' : 'none',
                  }}
                />
              </div>
              <span className={`text-xs font-mono font-bold tabular-nums ${sigConf > 70 ? 'text-[#00ff85]' : sigConf > 50 ? 'text-amber-400' : 'text-[rgba(180,230,190,0.4)]'}`}>
                {sigConf.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Always-visible Factor Scorecard — no scrolling needed */}
          <FactorScorecard factors={sigFactors} factorCount={sigFactorCount} />

          {/* ReasoningSidebar — countdown + status alerts + reasons */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ReasoningSidebar signal={signal as any} symbol={symbol} intervalSecs={intervalSecs} />
          </div>

          {/* TradePanel */}
          <div className="shrink-0">
            <TradePanel symbol={symbol} currentPrice={currentPrice} signal={signal} />
          </div>
        </div>

        {/* ── CENTER: Chart + Indicators + History ──────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Chart header — symbol info + timeframe hint */}
          <div
            className="h-12 shrink-0 flex items-center justify-between px-4"
            style={{ borderBottom: '1px solid rgba(0,255,100,0.07)', background: 'rgba(4,10,5,0.6)' }}
          >
            <div className="flex items-center gap-3">
              {/* Symbol badge */}
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{
                    background: 'rgba(0,255,100,0.12)',
                    border: '1px solid rgba(0,255,100,0.25)',
                    color: '#00ff85',
                    boxShadow: '0 0 8px rgba(0,255,100,0.2)',
                  }}
                >
                  {symbol.split('/')[0].slice(0, 2)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-[rgba(200,240,210,0.9)] leading-none">{symbol}</div>
                  <div className="text-[10px] text-[rgba(180,230,190,0.45)] font-mono mt-0.5">
                    {symbols.find(s => s.symbol === symbol)?.name ?? symbol}
                  </div>
                </div>
              </div>

              {/* Price + change */}
              <div className="flex items-baseline gap-2 ml-2">
                <span className={`text-xl font-mono font-bold tabular-nums ${
                  priceDirection === 'up' ? 'text-[#00ff85]' : priceDirection === 'down' ? 'text-red-400' : 'text-[rgba(200,240,210,0.9)]'
                }`}>
                  {currentPrice ? formatPrice(symbol, currentPrice) : '———'}
                </span>
                {signal?.indicators?.rsi && (
                  <span className={`text-[11px] font-mono ${
                    signal.indicators.rsi < 30 ? 'text-[#00ff85]/70' :
                    signal.indicators.rsi > 70 ? 'text-red-400/70' :
                    'text-[rgba(180,230,190,0.4)]'
                  }`}>
                    RSI {signal.indicators.rsi.toFixed(0)}
                  </span>
                )}
              </div>
            </div>

            {/* Right: status chips */}
            <div className="flex items-center gap-2">
              {sentimentBias && sentimentBias !== 'Neutral' && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  sentimentBias.includes('Bullish')
                    ? 'border-[#00ff85]/25 bg-[#00ff85]/8 text-[#00ff85]/70'
                    : 'border-red-400/25 bg-red-400/8 text-red-400/70'
                }`}>
                  NEWS: {sentimentBias.toUpperCase()}
                </span>
              )}
              {sentimentSuppressed && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-purple-400/25 bg-purple-400/8 text-purple-400/70">
                  NEWS OVERRIDE
                </span>
              )}
            </div>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-2">
            <TradingChart
              symbol={symbol}
              currentPrice={currentPrice}
              interval={timeframe}
              isDanger={isDanger}
              isBull={isBull}
              ghostCandle={ghostCandle}
              ghostConfidence={(signal as any)?.confidence}
              ghostDimmed={entropyReduced}
            />
          </div>

          {/* Bottom panel */}
          <div
            className="h-[230px] shrink-0 flex flex-col"
            style={{ borderTop: '1px solid rgba(0,255,100,0.08)' }}
          >
            {/* Tab bar */}
            <div
              className="flex items-center h-8 shrink-0 px-4 gap-1"
              style={{ borderBottom: '1px solid rgba(0,255,100,0.07)', background: 'rgba(4,10,5,0.5)' }}
            >
              {([
                { id: 'HISTORY', label: 'TRADE HISTORY', icon: null },
                { id: 'NEURAL',  label: 'NEURAL AUDIT',  icon: <BarChart2 size={9} /> },
              ] as { id: 'HISTORY' | 'NEURAL'; label: string; icon: React.ReactNode }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setBottomTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 h-full text-[10px] font-mono tracking-widest transition-all duration-150 ${
                    bottomTab === tab.id
                      ? 'text-[#00ff85] border-b-2 border-[#00ff85] -mb-px'
                      : 'text-[rgba(180,230,190,0.4)] hover:text-[rgba(180,230,190,0.7)]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}

              {/* Indicators quick-stats in tab bar */}
              {signal?.indicators && (
                <div className="ml-auto flex items-center gap-3 text-[10px] font-mono text-[rgba(180,230,190,0.4)]">
                  <span>
                    MACD{' '}
                    <span className={signal.indicators.macdHistogram >= 0 ? 'text-[#00ff85]/70' : 'text-red-400/70'}>
                      {signal.indicators.macdHistogram > 0 ? '+' : ''}{signal.indicators.macdHistogram.toFixed(4)}
                    </span>
                  </span>
                  <span>
                    BB{' '}
                    <span className="text-[rgba(180,230,190,0.6)]">
                      {signal.indicators.bbMiddle.toFixed((symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('SOL')) ? 2 : 5)}
                    </span>
                  </span>
                  <span>
                    ATR{' '}
                    <span className="text-amber-400/60">
                      {signal.indicators.atr?.toFixed(symbol.includes('BTC') ? 1 : (symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('SOL')) ? 2 : 5)}
                    </span>
                  </span>
                </div>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden flex">
              {bottomTab === 'HISTORY' ? (
                <>
                  {/* Indicators mini panel */}
                  <div
                    className="w-[260px] shrink-0 overflow-hidden"
                    style={{ borderRight: '1px solid rgba(0,255,100,0.07)' }}
                  >
                    <IndicatorsPanel signal={signal} />
                  </div>
                  {/* Trade history */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <StatsPanel symbol={symbol} />
                  </div>
                </>
              ) : (
                <div className="flex-1 overflow-hidden">
                  <PerformanceDashboard />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
