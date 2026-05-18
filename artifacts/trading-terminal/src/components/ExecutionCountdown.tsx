import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';

interface ExecutionCountdownProps {
  executionTime?: number;
  direction?: string;
  confidence?: number;
  active?: boolean;
  intervalSecs?: number;
}

export function ExecutionCountdown({
  executionTime, direction, confidence, active, intervalSecs = 60,
}: ExecutionCountdownProps) {
  const [remaining, setRemaining] = useState<number>(intervalSecs);
  const [executing, setExecuting] = useState(false);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!executionTime || !active) {
      setRemaining(intervalSecs);
      setExecuting(false);
      return;
    }

    const update = () => {
      const diff = Math.max(0, Math.round((executionTime - Date.now()) / 1000));
      setRemaining(diff);

      if (diff === 0 && !executing) {
        setExecuting(true);
        if (flashTimeout.current) clearTimeout(flashTimeout.current);
        flashTimeout.current = setTimeout(() => setExecuting(false), 4000);
      }
    };

    update();
    const interval = setInterval(update, 250);
    return () => {
      clearInterval(interval);
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
      setExecuting(false);
    };
  }, [executionTime, active, intervalSecs]);

  const progress = Math.max(0, Math.min(1, remaining / intervalSecs));
  const urgentThreshold = Math.max(10, Math.floor(intervalSecs * 0.1));
  const hotThreshold = Math.max(3, Math.floor(intervalSecs * 0.03));
  const isUrgent = remaining <= urgentThreshold;
  const isHot = remaining <= hotThreshold;
  const isUp = direction === 'UP';

  if (!active) return null;

  return (
    <div className="relative flex flex-col gap-2 p-3 bg-black/40 rounded-lg border border-border/50">
      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
        <span className="text-primary tracking-widest">SIGNAL EXECUTION</span>
        <span>{confidence?.toFixed(0)}% CONFIDENCE</span>
      </div>

      {/* Progress arc */}
      <div className="relative flex items-center justify-center py-2">
        <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
          <circle cx="40" cy="40" r="34" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx="40" cy="40" r="34"
            fill="transparent"
            stroke={isHot ? '#ef4444' : isUrgent ? '#f59e0b' : isUp ? '#22c55e' : '#ef4444'}
            strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * progress}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-2xl font-bold font-mono tabular-nums"
            style={{ color: isHot ? '#ef4444' : isUrgent ? '#f59e0b' : '#D9D9D9' }}
          >
            {remaining}s
          </span>
          <span className="text-[9px] text-muted-foreground tracking-wider">COUNTDOWN</span>
        </div>
      </div>

      {/* Direction indicator */}
      <div
        className={`text-center text-xs font-mono font-bold tracking-widest ${
          isUp ? 'text-green-400' : 'text-red-400'
        }`}
      >
        TARGET: {direction}
      </div>

      {/* EXECUTE NOW flash overlay */}
      <AnimatePresence>
        {executing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [1, 0.7, 1, 0.7, 1], scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.4, opacity: { duration: 2, repeat: Infinity } }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 rounded-lg border-2 border-yellow-400 z-10"
            style={{ boxShadow: '0 0 30px rgba(250,204,21,0.6)' }}
          >
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 0.3, repeat: Infinity }}
              className="text-center"
            >
              <div className="text-3xl mb-1">🚨</div>
              <div className="text-yellow-400 font-bold text-sm tracking-widest font-mono">EXECUTE NOW!</div>
              <div className="text-yellow-300 text-xs font-mono mt-0.5">{direction} CANDLE FORMING</div>
              <Zap size={16} className="mx-auto mt-1 text-yellow-400" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
