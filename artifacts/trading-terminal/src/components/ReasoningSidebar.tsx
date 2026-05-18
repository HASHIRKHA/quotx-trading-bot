import React from 'react';
import { SignalAnalysis, getGetMarketSignalQueryKey } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, AlertTriangle, Loader2, Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { ExecutionCountdown } from './ExecutionCountdown';

type ExtendedSignal = SignalAnalysis & {
  factors?: any[];
  factorCount?: number;
  ghostCandle?: unknown;
  executionTime?: number;
  warming?: boolean;
  entropyReduced?: boolean;
  sentimentBias?: string;
  sentimentSuppressed?: boolean;
};

function SentimentBadge({ label }: { label: string }) {
  const config: Record<string, { cls: string; dot: string }> = {
    'Bullish':           { cls: 'border-green-500/40 bg-green-500/10 text-green-400',      dot: 'bg-green-500' },
    'Somewhat-Bullish':  { cls: 'border-green-400/30 bg-green-400/5 text-green-400/70',    dot: 'bg-green-400' },
    'Neutral':           { cls: 'border-gray-500/30 bg-gray-500/5 text-gray-400',           dot: 'bg-gray-500' },
    'Somewhat-Bearish':  { cls: 'border-orange-400/30 bg-orange-400/5 text-orange-400/70', dot: 'bg-orange-400' },
    'Bearish':           { cls: 'border-red-500/40 bg-red-500/10 text-red-400',             dot: 'bg-red-500' },
  };
  const cfg = config[label] ?? config['Neutral'];
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] font-mono font-bold tracking-wider ${cfg.cls}`}>
      <Newspaper size={10} />
      <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      NEWS: {label.toUpperCase()}
    </div>
  );
}

/**
 * ReasoningSidebar — shows countdown, status alerts and analysis reasons.
 * Signal factor scorecard is rendered inline in Terminal.tsx (always visible).
 */
export function ReasoningSidebar({
  signal, symbol, intervalSecs = 60,
}: {
  signal?: ExtendedSignal;
  symbol: string;
  intervalSecs?: number;
}) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMarketSignalQueryKey(symbol) });
  };

  if (!signal) {
    return (
      <div className="p-4 text-center text-muted-foreground font-mono text-sm flex flex-col items-center gap-2">
        <Loader2 size={18} className="animate-spin text-primary" />
        <span className="text-[10px] tracking-widest">INITIALIZING AI…</span>
      </div>
    );
  }

  const isUp      = signal.direction === 'UP';
  const isDown    = signal.direction === 'DOWN';
  const isWarming = signal.warming === true;
  const isSafe    = signal.safeMode;
  const hasSignal = isUp || isDown;
  const entropyReduced   = signal.entropyReduced === true;
  const sentimentSuppressed = signal.sentimentSuppressed === true;
  const sentimentBias    = signal.sentimentBias;
  const confidence       = signal?.confidence ?? 0;

  return (
    <div className="flex flex-col p-3 gap-2.5">
      {/* Refresh */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-widest text-muted-foreground/50 uppercase">AI Analysis</span>
        <Button
          variant="ghost" size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-primary"
          onClick={handleRefresh}
        >
          <RefreshCw size={11} />
        </Button>
      </div>

      {/* News sentiment badge */}
      {sentimentBias && sentimentBias !== 'Neutral' && (
        <SentimentBadge label={sentimentBias} />
      )}

      {/* Status alerts */}
      <AnimatePresence>
        {isSafe && !isWarming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/10 border border-amber-500/50 rounded-md p-2 flex items-start gap-2 text-amber-500"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <div className="text-[10px] font-mono">
              <strong>SAFE MODE ACTIVE</strong><br/>High entropy — signals suppressed.
            </div>
          </motion.div>
        )}
        {entropyReduced && !isSafe && !isWarming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/5 border border-amber-500/25 rounded-md p-2 flex items-start gap-2 text-amber-400/80"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <div className="text-[10px] font-mono">
              <strong>REDUCED STRENGTH</strong><br/>Entropy soft-block — 70% power.
            </div>
          </motion.div>
        )}
        {sentimentSuppressed && !isWarming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-purple-500/10 border border-purple-500/40 rounded-md p-2 flex items-start gap-2 text-purple-400"
          >
            <Newspaper size={13} className="mt-0.5 shrink-0" />
            <div className="text-[10px] font-mono">
              <strong>NEWS OVERRIDE</strong><br/>Sentiment contradicts technicals.
            </div>
          </motion.div>
        )}
        {isWarming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-blue-500/10 border border-blue-500/30 rounded-md p-2 flex items-start gap-2 text-blue-400"
          >
            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
            <div className="text-[10px] font-mono">
              <strong>WARM-UP</strong><br/>Collecting live ticks…
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execution Countdown */}
      {hasSignal && !isWarming && !isSafe && !sentimentSuppressed && (signal as any).executionTime && (
        <ExecutionCountdown
          executionTime={(signal as any).executionTime}
          direction={signal.direction}
          confidence={confidence}
          active={hasSignal}
          intervalSecs={intervalSecs}
        />
      )}

      {/* Analysis reasons */}
      {signal.reasons?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[9px] font-mono text-muted-foreground/60 tracking-widest uppercase border-b border-border/40 pb-1">
            Reasons
          </h3>
          {(signal.reasons as string[]).map((reason, idx) => (
            <motion.div
              key={`${(signal as any).timestamp}-${idx}`}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[10px] font-mono flex items-start gap-1.5 text-[rgba(180,230,190,0.65)]"
            >
              <span className="text-primary/70 mt-0.5 shrink-0">▸</span>
              <span>{reason}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
