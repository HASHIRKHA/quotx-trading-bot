import React from 'react';
import { SignalAnalysis, useGetMarketSignal, getGetMarketSignalQueryKey } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, RefreshCw, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { ExecutionCountdown } from './ExecutionCountdown';

interface FactorResult {
  name: string;
  value: number;
  confirmed: boolean;
  direction: string;
  weight: number;
  detail: string;
}

export function ReasoningSidebar({ signal, symbol }: { signal?: SignalAnalysis & { factors?: FactorResult[]; factorCount?: number; ghostCandle?: unknown; executionTime?: number }; symbol: string }) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMarketSignalQueryKey(symbol) });
  };

  if (!signal) {
    return <div className="p-4 text-muted-foreground font-mono text-sm">Loading reasoning...</div>;
  }

  const isUp = signal.direction === 'UP';
  const isDown = signal.direction === 'DOWN';
  const isNeutral = signal.direction === 'NEUTRAL';
  const isWarming = signal.warming === true;
  const isSafe = signal.safeMode;
  const hasSignal = isUp || isDown;

  const color = signal.confidence > 70 ? '#22c55e' : signal.confidence > 50 ? '#f59e0b' : '#6b7280';
  const colorClass = signal.confidence > 70 ? 'text-green-500' : signal.confidence > 50 ? 'text-amber-500' : 'text-gray-500';

  const factors: FactorResult[] = (signal as any).factors ?? [];
  const factorCount: number = (signal as any).factorCount ?? 0;

  return (
    <div className="flex flex-col p-4 gap-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-primary tracking-wider" style={{ textShadow: '0 0 8px rgba(0,200,255,0.4)' }}>
          QUANTUM AI REASONER
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={handleRefresh}>
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* Confidence ring */}
      <div className="flex flex-col items-center relative">
        <svg viewBox="0 0 100 100" className="w-28 h-28 transform -rotate-90">
          <circle cx="50" cy="50" r="45" fill="transparent" stroke="rgba(255,255,255,0.1)" strokeWidth="10" />
          <motion.circle
            cx="50" cy="50" r="45" fill="transparent"
            stroke={isWarming ? '#6b7280' : color}
            strokeWidth="10" strokeDasharray="283"
            initial={{ strokeDashoffset: 283 }}
            animate={{ strokeDashoffset: isWarming ? 283 : 283 - (283 * signal.confidence) / 100 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isWarming ? (
            <Loader2 size={22} className="text-muted-foreground animate-spin" />
          ) : (
            <>
              <span className={`text-2xl font-bold font-mono ${colorClass}`}>{signal.confidence.toFixed(0)}%</span>
              <span className="text-[10px] text-muted-foreground">CONFIDENCE</span>
            </>
          )}
        </div>
      </div>

      {/* Direction badge */}
      {isWarming ? (
        <div className="flex items-center justify-center gap-2 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm font-bold tracking-widest">WARMING UP</span>
        </div>
      ) : (
        <motion.div
          key={signal.direction}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg border ${
            isNeutral ? 'border-gray-500/30 bg-gray-500/10 text-gray-400'
            : isUp ? 'border-green-500/30 bg-green-500/10 text-green-500'
            : 'border-red-500/30 bg-red-500/10 text-red-500'
          }`}
          style={{ boxShadow: isNeutral ? 'none' : isUp ? '0 0 16px rgba(34,197,94,0.2)' : '0 0 16px rgba(239,68,68,0.2)' }}
        >
          {isUp && <ArrowUp size={20} />}
          {isDown && <ArrowDown size={20} />}
          <span className="text-lg font-bold tracking-widest">{signal.direction}</span>
        </motion.div>
      )}

      {/* Status alerts */}
      <AnimatePresence>
        {isSafe && !isWarming && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/10 border border-amber-500/50 rounded-md p-2 flex items-start gap-2 text-amber-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div className="text-xs font-mono"><strong>SAFE MODE ACTIVE</strong><br/>High entropy — signals suppressed.</div>
          </motion.div>
        )}
        {isWarming && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-blue-500/10 border border-blue-500/30 rounded-md p-2 flex items-start gap-2 text-blue-400">
            <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
            <div className="text-xs font-mono"><strong>WARM-UP</strong><br/>Awaiting 5 live ticks for real-time pressure analysis.</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execution Countdown */}
      {hasSignal && !isWarming && !isSafe && (signal as any).executionTime && (
        <ExecutionCountdown
          executionTime={(signal as any).executionTime}
          direction={signal.direction}
          confidence={signal.confidence}
          active={hasSignal}
        />
      )}

      {/* 6-Factor Scorecard */}
      {factors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-mono text-muted-foreground border-b border-border/50 pb-1 flex items-center justify-between">
            <span>SIGNAL FACTORS</span>
            <span className={`font-bold ${factorCount >= 4 ? 'text-green-400' : 'text-amber-400'}`}>
              {factorCount}/6 confirmed
            </span>
          </h3>
          {factors.map((factor, idx) => (
            <motion.div
              key={factor.name}
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className={`flex items-start gap-2 p-1.5 rounded text-xs font-mono ${
                factor.confirmed
                  ? factor.direction === 'UP' ? 'bg-green-500/5 border border-green-500/15' : 'bg-red-500/5 border border-red-500/15'
                  : 'bg-black/20 border border-border/30'
              }`}
            >
              {factor.confirmed ? (
                <CheckCircle2 size={12} className={`mt-0.5 shrink-0 ${factor.direction === 'UP' ? 'text-green-400' : 'text-red-400'}`} />
              ) : (
                <XCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground/50" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`font-bold text-[10px] ${factor.confirmed ? (factor.direction === 'UP' ? 'text-green-400' : 'text-red-400') : 'text-muted-foreground'}`}>
                  {factor.name}
                </div>
                <div className="text-muted-foreground/70 text-[10px] truncate">{factor.detail}</div>
              </div>
              <div className="text-[9px] text-muted-foreground/50 shrink-0">{factor.weight}pt</div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Analysis reasons (when no factors breakdown) */}
      {factors.length === 0 && signal.reasons?.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-mono text-muted-foreground border-b border-border/50 pb-1">ANALYSIS</h3>
          {signal.reasons.map((reason, idx) => (
            <motion.div
              key={`${signal.timestamp}-${idx}`}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: idx * 0.05 }}
              className="text-xs font-mono flex items-start gap-2 text-gray-300"
            >
              <span className="text-primary mt-0.5">▸</span>
              <span>{reason}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
