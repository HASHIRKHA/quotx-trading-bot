import React from 'react';
import { useQuery } from '@tanstack/react-query';

interface BySymbol {
  symbol: string;
  wins: number;
  total: number;
  winRate: number;
}

interface Trade20 {
  outcome: string;
  symbol: string;
  confidence: number;
  direction: string;
}

interface PerformanceData {
  winRate: number;
  last10Rate: number;
  wins: number;
  total: number;
  bySymbol: BySymbol[];
  last20: Trade20[];
}

function getApiBase(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function usePerformanceData() {
  return useQuery<PerformanceData>({
    queryKey: ['trades', 'performance'],
    queryFn: async () => {
      const res = await fetch(`${getApiBase()}/api/trades/performance`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    refetchInterval: 5000,
    placeholderData: { winRate: 0, last10Rate: 0, wins: 0, total: 0, bySymbol: [], last20: [] },
  });
}

function AccuracyRing({ value, label, size = 80 }: { value: number; label: string; size?: number }) {
  const r = size * 0.42;
  const circ = 2 * Math.PI * r;
  const dash = circ - (circ * Math.min(value, 100)) / 100;
  const color = value >= 60 ? '#22c55e' : value >= 45 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={size * 0.09} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={size * 0.09}
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size, marginTop: -(size + 4) }}>
        <span className="font-mono font-bold text-sm" style={{ color }}>{value.toFixed(1)}%</span>
      </div>
      <span className="text-[9px] font-mono text-muted-foreground tracking-widest">{label}</span>
    </div>
  );
}

export function PerformanceDashboard() {
  const { data: perf } = usePerformanceData();

  if (!perf) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground font-mono text-xs animate-pulse">
        Loading neural performance data...
      </div>
    );
  }

  const { winRate, last10Rate, wins, total, bySymbol, last20 } = perf;
  const safeBySymbol = Array.isArray(bySymbol) ? bySymbol : [];
  const safeLast20 = Array.isArray(last20) ? last20 : [];

  const winColor = winRate >= 60 ? 'text-green-500' : winRate >= 45 ? 'text-amber-500' : 'text-red-500';
  const last10Color = last10Rate >= 60 ? 'text-green-500' : last10Rate >= 45 ? 'text-amber-500' : 'text-red-500';

  return (
    <div className="flex h-full p-4 gap-6 overflow-x-auto">
      {/* LEFT: Main accuracy meters */}
      <div className="flex flex-col gap-3 shrink-0">
        <h3 className="text-[10px] font-mono text-muted-foreground tracking-widest">NEURAL ACCURACY</h3>

        <div className="flex gap-6 items-end">
          {/* Overall */}
          <div className="flex flex-col items-center gap-1">
            <svg width={80} height={80} viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
              <circle
                cx="40" cy="40" r="34" fill="none"
                stroke={winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ef4444'}
                strokeWidth="7"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 - (2 * Math.PI * 34 * Math.min(winRate, 100)) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease' }}
              />
            </svg>
            <div className="text-center -mt-[84px] mb-[24px]">
              <div className={`font-mono font-bold text-sm ${winColor}`}>{winRate.toFixed(1)}%</div>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground tracking-wider">ALL TIME</span>
          </div>

          {/* Last 10 */}
          <div className="flex flex-col items-center gap-1">
            <svg width={64} height={64} viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="27" fill="none"
                stroke={last10Rate >= 60 ? '#22c55e' : last10Rate >= 45 ? '#f59e0b' : '#ef4444'}
                strokeWidth="6"
                strokeDasharray={2 * Math.PI * 27}
                strokeDashoffset={2 * Math.PI * 27 - (2 * Math.PI * 27 * Math.min(last10Rate, 100)) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease' }}
              />
            </svg>
            <div className="text-center -mt-[68px] mb-[20px]">
              <div className={`font-mono font-bold text-xs ${last10Color}`}>{last10Rate.toFixed(0)}%</div>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground tracking-wider">LAST 10</span>
          </div>
        </div>

        {/* Trade count */}
        <div className="flex gap-4 text-xs font-mono mt-1">
          <div className="text-center">
            <div className="text-muted-foreground text-[9px]">TOTAL</div>
            <div className="font-bold">{total}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-green-500">WIN</div>
            <div className="font-bold text-green-500">{wins}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-red-500">LOSS</div>
            <div className="font-bold text-red-500">{total - wins}</div>
          </div>
        </div>
      </div>

      {/* CENTER: By-symbol breakdown */}
      <div className="flex flex-col gap-2 min-w-[180px] shrink-0">
        <h3 className="text-[10px] font-mono text-muted-foreground tracking-widest">BY ASSET</h3>
        {safeBySymbol.length === 0 ? (
          <div className="text-[10px] font-mono text-muted-foreground italic mt-2">No resolved trades yet</div>
        ) : (
          safeBySymbol.map((s) => (
            <div key={s.symbol} className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground w-[60px] shrink-0">{s.symbol}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${s.winRate}%`,
                    backgroundColor: s.winRate >= 60 ? '#22c55e' : s.winRate >= 45 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className={`text-[9px] font-mono w-8 text-right ${s.winRate >= 60 ? 'text-green-500' : s.winRate >= 45 ? 'text-amber-500' : 'text-red-500'}`}>
                {s.winRate.toFixed(0)}%
              </span>
              <span className="text-[9px] font-mono text-muted-foreground/50">{s.total}t</span>
            </div>
          ))
        )}
      </div>

      {/* RIGHT: Last 20 trade tape */}
      <div className="flex flex-col gap-2 min-w-[160px] shrink-0">
        <h3 className="text-[10px] font-mono text-muted-foreground tracking-widest">TRADE TAPE</h3>
        <div className="flex flex-wrap gap-1">
          {safeLast20.length === 0 ? (
            <span className="text-[10px] font-mono text-muted-foreground italic">Awaiting trades...</span>
          ) : (
            safeLast20.map((t, i) => (
              <div
                key={i}
                title={`${t.symbol} ${t.direction} @ ${t.confidence.toFixed(0)}% conf`}
                className={`w-5 h-5 rounded text-[8px] font-mono font-bold flex items-center justify-center border ${
                  t.outcome === 'WIN'
                    ? 'bg-green-500/20 border-green-500/40 text-green-400'
                    : 'bg-red-500/20 border-red-500/40 text-red-400'
                }`}
              >
                {t.outcome === 'WIN' ? '✓' : '✗'}
              </div>
            ))
          )}
        </div>

        {safeLast20.length > 0 && (
          <div className="text-[9px] font-mono text-muted-foreground mt-1">
            Last {safeLast20.length} resolved trades
          </div>
        )}
      </div>
    </div>
  );
}
