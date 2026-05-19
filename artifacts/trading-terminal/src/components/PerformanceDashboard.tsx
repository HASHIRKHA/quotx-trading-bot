import React from 'react';
import { useQuery } from '@tanstack/react-query';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FactorStat {
  name: string;
  weight: number;
  winRate: number;
  sampleCount: number;
  strength: string;
}

interface BySymbol {
  symbol: string;
  wins: number;
  total: number;
  winRate: number;
}

interface RegimeStat {
  wins: number;
  total: number;
  winRate: number;
}

interface LearningData {
  totalSignals: number;
  totalResolved: number;
  totalWins: number;
  overallWinRate: number;
  autoResolved: number;
  recentAccuracy: { last10: number; last50: number; last100: number };
  factors: FactorStat[];
  bySymbol: BySymbol[];
  byRegime: { volatile?: RegimeStat; ranging?: RegimeStat; trending?: RegimeStat };
  learningActive: boolean;
  resolverInterval: string;
}

// ── API fetch ─────────────────────────────────────────────────────────────────

function useLearningData() {
  return useQuery<LearningData>({
    queryKey: ['neural', 'learning'],
    queryFn: async () => {
      const base = (window as any).__QUOTX_API_BASE__ ?? '';
      const res = await fetch(`${base}/api/market/learning`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    refetchInterval: 15_000,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AccuracyRing({
  value,
  label,
  size = 76,
  hasData,
}: {
  value: number;
  label: string;
  size?: number;
  hasData: boolean;
}) {
  const r = size * 0.41;
  const circ = 2 * Math.PI * r;
  const pct = hasData ? Math.min(value, 100) : 0;
  const dash = circ - (circ * pct) / 100;
  const color = !hasData ? 'rgba(180,230,190,0.15)' : value >= 60 ? '#00ff85' : value >= 45 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={size * 0.085}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={size * 0.085}
            strokeDasharray={circ} strokeDashoffset={dash}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono font-bold leading-none" style={{ fontSize: size * 0.185, color }}>
            {hasData ? `${value.toFixed(0)}%` : '—'}
          </span>
        </div>
      </div>
      <span className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.4)' }}>
        {label}
      </span>
    </div>
  );
}

function FactorBar({ factor }: { factor: FactorStat }) {
  const WEIGHT_MIN = 0.30;
  const WEIGHT_MAX = 2.50;
  const NEUTRAL = 1.0;
  const range = WEIGHT_MAX - WEIGHT_MIN;

  // Position of neutral (1.0) as a percentage of the bar
  const neutralPct = ((NEUTRAL - WEIGHT_MIN) / range) * 100; // ~28.2%
  // Position of current weight
  const weightPct = ((Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, factor.weight)) - WEIGHT_MIN) / range) * 100;

  const isAbove = factor.weight >= NEUTRAL;
  const barLeft = isAbove ? neutralPct : weightPct;
  const barWidth = Math.abs(weightPct - neutralPct);

  const barColor = factor.sampleCount === 0
    ? 'rgba(180,230,190,0.2)'
    : isAbove ? '#00ff85' : '#ef4444';

  const weightDelta = factor.weight - NEUTRAL;
  const deltaStr = weightDelta >= 0 ? `+${weightDelta.toFixed(3)}` : weightDelta.toFixed(3);

  return (
    <div className="flex items-center gap-2 group">
      {/* Factor name */}
      <span
        className="text-[9px] font-mono shrink-0 w-[110px] truncate"
        style={{ color: 'rgba(180,230,190,0.55)' }}
        title={factor.name}
      >
        {factor.name}
      </span>

      {/* Weight bar */}
      <div className="relative flex-1 h-[5px] rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {/* Neutral tick */}
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{ left: `${neutralPct}%`, background: 'rgba(255,255,255,0.15)' }}
        />
        {/* Delta bar */}
        {factor.sampleCount > 0 && (
          <div
            className="absolute top-0 bottom-0 rounded-full transition-all duration-700"
            style={{ left: `${barLeft}%`, width: `${Math.max(barWidth, 1)}%`, background: barColor, opacity: 0.85 }}
          />
        )}
      </div>

      {/* Weight delta */}
      <span
        className="text-[9px] font-mono w-[46px] text-right shrink-0"
        style={{
          color: factor.sampleCount === 0
            ? 'rgba(180,230,190,0.2)'
            : isAbove ? '#00ff85' : '#ef4444',
        }}
      >
        {factor.sampleCount === 0 ? '1.000' : factor.weight.toFixed(3)}
      </span>

      {/* Win rate */}
      <span
        className="text-[9px] font-mono w-[28px] text-right shrink-0"
        style={{ color: 'rgba(180,230,190,0.3)' }}
      >
        {factor.sampleCount === 0 ? '—' : `${factor.winRate.toFixed(0)}%`}
      </span>
    </div>
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ background: '#00ff85' }}
        />
      )}
      <span
        className="relative inline-flex rounded-full h-2 w-2"
        style={{ background: active ? '#00ff85' : '#ef4444' }}
      />
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PerformanceDashboard() {
  const { data, isLoading, isError } = useLearningData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2">
        <PulseDot active />
        <span className="text-[10px] font-mono tracking-widest animate-pulse" style={{ color: 'rgba(180,230,190,0.4)' }}>
          LOADING NEURAL DATA...
        </span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-full gap-2">
        <PulseDot active={false} />
        <span className="text-[10px] font-mono tracking-widest" style={{ color: '#ef4444' }}>
          NEURAL FEED DISCONNECTED
        </span>
      </div>
    );
  }

  const hasData = data.totalResolved > 0;
  const losses = data.totalResolved - data.totalWins;
  const factors = Array.isArray(data.factors) ? data.factors : [];
  const bySymbol = Array.isArray(data.bySymbol) ? data.bySymbol.slice(0, 8) : [];
  const regime = data.byRegime ?? {};

  return (
    <div className="flex h-full overflow-hidden" style={{ fontFamily: 'monospace' }}>

      {/* ── COL 1: Accuracy rings + counts ─────────────────────────────────── */}
      <div
        className="flex flex-col gap-3 px-4 py-3 shrink-0 w-[160px]"
        style={{ borderRight: '1px solid rgba(0,255,100,0.07)' }}
      >
        <div className="flex items-center gap-1.5">
          <PulseDot active={data.learningActive} />
          <span className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.4)' }}>
            NEURAL ACCURACY
          </span>
        </div>

        <div className="flex gap-4 items-end">
          <AccuracyRing value={data.overallWinRate} label="ALL TIME" size={76} hasData={hasData} />
          <AccuracyRing value={data.recentAccuracy?.last10 ?? 0} label="LAST 10" size={56} hasData={hasData} />
        </div>

        {/* Counts */}
        <div className="grid grid-cols-3 gap-1 mt-1">
          {[
            { label: 'TOTAL', value: data.totalResolved, color: 'rgba(180,230,190,0.6)' },
            { label: 'WIN',   value: data.totalWins,     color: '#00ff85' },
            { label: 'LOSS',  value: losses,             color: '#ef4444' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col items-center">
              <span className="text-[8px] font-mono tracking-widest" style={{ color }}>{label}</span>
              <span className="text-xs font-mono font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(0,255,100,0.06)' }} />

        {/* Auto-resolved badge */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.3)' }}>
            AUTO-RESOLVED
          </span>
          <span className="text-[13px] font-mono font-bold" style={{ color: 'rgba(180,230,190,0.7)' }}>
            {data.autoResolved}
          </span>
          <span className="text-[8px] font-mono" style={{ color: 'rgba(180,230,190,0.25)' }}>
            ↻ {data.resolverInterval} tick
          </span>
        </div>

        {/* Regime breakdown */}
        {Object.keys(regime).length > 0 && (
          <>
            <div style={{ borderTop: '1px solid rgba(0,255,100,0.06)' }} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[8px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.3)' }}>
                BY REGIME
              </span>
              {(['trending', 'ranging', 'volatile'] as const).map((r) => {
                const stat = regime[r];
                if (!stat || stat.total === 0) return null;
                return (
                  <div key={r} className="flex items-center justify-between">
                    <span className="text-[8px] font-mono capitalize" style={{ color: 'rgba(180,230,190,0.35)' }}>{r}</span>
                    <span
                      className="text-[9px] font-mono font-bold"
                      style={{ color: stat.winRate >= 60 ? '#00ff85' : stat.winRate >= 45 ? '#f59e0b' : '#ef4444' }}
                    >
                      {stat.winRate.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── COL 2: Factor Intelligence ─────────────────────────────────────── */}
      <div
        className="flex flex-col gap-2.5 px-4 py-3 flex-1 min-w-0"
        style={{ borderRight: '1px solid rgba(0,255,100,0.07)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.4)' }}>
            FACTOR INTELLIGENCE
          </span>
          <div className="flex items-center gap-3 text-[8px] font-mono" style={{ color: 'rgba(180,230,190,0.25)' }}>
            <span>← WEAK · NEUTRAL · STRONG →</span>
            <span>WEIGHT</span>
            <span>WIN%</span>
          </div>
        </div>

        {/* Legend: min / neutral / max markers */}
        <div className="relative ml-[114px] mr-[78px] h-[1px]" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <span className="absolute left-0 -top-3 text-[7px] font-mono" style={{ color: 'rgba(255,255,255,0.15)' }}>0.30</span>
          <span className="absolute -top-3 text-[7px] font-mono" style={{ left: '28%', color: 'rgba(255,255,255,0.25)' }}>1.0</span>
          <span className="absolute right-0 -top-3 text-[7px] font-mono" style={{ color: 'rgba(255,255,255,0.15)' }}>2.50</span>
        </div>

        <div className="flex flex-col gap-2 mt-1">
          {factors.map((f) => (
            <FactorBar key={f.name} factor={f} />
          ))}
        </div>

        {!hasData && (
          <div
            className="mt-2 text-[9px] font-mono tracking-wider animate-pulse"
            style={{ color: 'rgba(180,230,190,0.25)' }}
          >
            ↻ Weights update after each auto-resolved signal
          </div>
        )}
      </div>

      {/* ── COL 3: By Asset ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 px-4 py-3 w-[200px] shrink-0">
        <span className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.4)' }}>
          BY ASSET
        </span>

        {bySymbol.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center flex-1 gap-2"
            style={{ color: 'rgba(180,230,190,0.2)' }}
          >
            <span className="text-2xl">◌</span>
            <span className="text-[9px] font-mono tracking-widest animate-pulse">AWAITING SIGNALS...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bySymbol.map((s) => (
              <div key={s.symbol} className="flex items-center gap-2">
                <span
                  className="text-[9px] font-mono shrink-0 w-[72px] truncate"
                  style={{ color: 'rgba(180,230,190,0.5)' }}
                  title={s.symbol}
                >
                  {s.symbol}
                </span>
                <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${s.winRate}%`,
                      background: s.winRate >= 60 ? '#00ff85' : s.winRate >= 45 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
                <span
                  className="text-[9px] font-mono w-7 text-right shrink-0 font-bold"
                  style={{ color: s.winRate >= 60 ? '#00ff85' : s.winRate >= 45 ? '#f59e0b' : '#ef4444' }}
                >
                  {s.winRate.toFixed(0)}%
                </span>
                <span className="text-[8px] font-mono shrink-0" style={{ color: 'rgba(180,230,190,0.25)' }}>
                  {s.total}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Total signals at bottom */}
        <div style={{ borderTop: '1px solid rgba(0,255,100,0.06)', marginTop: 'auto', paddingTop: '8px' }}>
          <div className="flex justify-between items-center">
            <span className="text-[8px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.25)' }}>
              SIGNALS LOGGED
            </span>
            <span className="text-[11px] font-mono font-bold" style={{ color: 'rgba(180,230,190,0.5)' }}>
              {data.totalSignals}
            </span>
          </div>
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-[8px] font-mono tracking-widest" style={{ color: 'rgba(180,230,190,0.25)' }}>
              PENDING
            </span>
            <span className="text-[11px] font-mono font-bold" style={{ color: 'rgba(180,230,190,0.35)' }}>
              {data.totalSignals - data.totalResolved}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
