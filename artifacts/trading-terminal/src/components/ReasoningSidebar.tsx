import React from 'react';
import { SignalAnalysis, useGetMarketSignal, getGetMarketSignalQueryKey } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';

export function ReasoningSidebar({ signal, symbol }: { signal?: SignalAnalysis, symbol: string }) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMarketSignalQueryKey(symbol) });
  };

  if (!signal) {
    return <div className="p-4 text-muted-foreground font-mono text-sm">Loading reasoning...</div>;
  }

  const isUp = signal.direction === 'UP';
  const color = signal.confidence > 70 ? '#22c55e' : signal.confidence > 50 ? '#f59e0b' : '#6b7280';
  const colorClass = signal.confidence > 70 ? 'text-green-500' : signal.confidence > 50 ? 'text-amber-500' : 'text-gray-500';

  return (
    <div className="flex flex-col p-4 gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-primary tracking-wider" style={{ textShadow: '0 0 8px rgba(0, 200, 255, 0.4)' }}>
          QUANTUM AI REASONER
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={handleRefresh}>
          <RefreshCw size={14} />
        </Button>
      </div>

      <div className="flex flex-col items-center relative">
        <svg viewBox="0 0 100 100" className="w-32 h-32 transform -rotate-90">
          <circle cx="50" cy="50" r="45" fill="transparent" stroke="rgba(255,255,255,0.1)" strokeWidth="10" />
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="transparent"
            stroke={color}
            strokeWidth="10"
            strokeDasharray="283"
            initial={{ strokeDashoffset: 283 }}
            animate={{ strokeDashoffset: 283 - (283 * signal.confidence) / 100 }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold font-mono ${colorClass}`}>{signal.confidence}%</span>
          <span className="text-[10px] text-muted-foreground">CONFIDENCE</span>
        </div>
      </div>

      <motion.div
        key={signal.direction}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`flex items-center justify-center gap-2 py-3 rounded-lg border ${isUp ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}
        style={{ boxShadow: isUp ? '0 0 20px rgba(34, 197, 94, 0.2)' : '0 0 20px rgba(239, 68, 68, 0.2)' }}
      >
        {isUp ? <ArrowUp size={24} /> : <ArrowDown size={24} />}
        <span className="text-xl font-bold tracking-widest">{signal.direction}</span>
      </motion.div>

      <AnimatePresence>
        {signal.safeMode && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/10 border border-amber-500/50 rounded-md p-3 flex items-start gap-2 text-amber-500 animate-[safeModePulse_2s_infinite]"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="text-xs font-mono">
              <strong>SAFE MODE ACTIVE</strong><br/>
              Signal paused due to high market volatility or conflicting indicators.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-mono text-muted-foreground border-b border-border/50 pb-1 mb-1">ANALYSIS FACTORS</h3>
        <div className="flex flex-col gap-2">
          {signal.reasons.map((reason, idx) => (
            <motion.div
              key={`${signal.timestamp}-${idx}`}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: idx * 0.05 }}
              className="text-xs font-mono flex items-start gap-2 text-gray-300"
            >
              <span className="text-primary mt-0.5">▸</span>
              <span>{reason}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}