import React from 'react';
import { SignalAnalysis } from '@workspace/api-client-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';

export function IndicatorsPanel({ signal }: { signal?: SignalAnalysis }) {
  if (!signal || !signal.indicators) {
    return <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">Waiting for signal data...</div>;
  }

  const { rsi, macd, macdSignal, macdHistogram, bbUpper, bbMiddle, bbLower } = signal.indicators;

  return (
    <Tabs defaultValue="rsi" className="w-full h-full flex flex-col">
      <TabsList className="bg-black/20 w-fit">
        <TabsTrigger value="rsi" className="font-mono text-xs">RSI (14)</TabsTrigger>
        <TabsTrigger value="macd" className="font-mono text-xs">MACD</TabsTrigger>
        <TabsTrigger value="bb" className="font-mono text-xs">Bollinger</TabsTrigger>
      </TabsList>
      
      <div className="flex-1 mt-2 bg-black/10 rounded-md border border-border/50 p-4">
        <TabsContent value="rsi" className="m-0 h-full flex flex-col justify-center">
          <div className="flex justify-between items-end mb-2 font-mono">
            <div className="text-3xl font-bold" style={{ color: rsi > 70 ? '#ef4444' : rsi < 30 ? '#22c55e' : '#D9D9D9' }}>
              {rsi.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              {rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'}
            </div>
          </div>
          <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full transition-all duration-500" 
              style={{ 
                width: `${Math.min(Math.max(rsi, 0), 100)}%`,
                backgroundColor: rsi > 70 ? '#ef4444' : rsi < 30 ? '#22c55e' : '#3b82f6'
              }} 
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
            <span>0</span>
            <span>30</span>
            <span>70</span>
            <span>100</span>
          </div>
        </TabsContent>

        <TabsContent value="macd" className="m-0 h-full flex flex-col justify-center gap-4">
          <div className="grid grid-cols-3 gap-4 font-mono text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-1">MACD</div>
              <div className="text-blue-400">{macd.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Signal</div>
              <div className="text-orange-400">{macdSignal.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Histogram</div>
              <div className={macdHistogram >= 0 ? 'text-green-500' : 'text-red-500'}>
                {macdHistogram > 0 ? '+' : ''}{macdHistogram.toFixed(4)}
              </div>
            </div>
          </div>
          <div className="h-10 w-full flex items-end gap-1">
             {/* Simulated histogram bars based on current value for visual effect */}
             {[...Array(20)].map((_, i) => {
               const val = macdHistogram * (1 - Math.abs(10 - i)/10);
               const height = Math.min(Math.abs(val) * 1000, 100);
               return (
                 <div 
                   key={i} 
                   className="flex-1 rounded-sm opacity-50"
                   style={{ 
                     height: `${height}%`, 
                     backgroundColor: val >= 0 ? '#22c55e' : '#ef4444',
                     opacity: i === 19 ? 1 : 0.3
                   }}
                 />
               );
             })}
          </div>
        </TabsContent>

        <TabsContent value="bb" className="m-0 h-full flex flex-col justify-center">
          <div className="grid grid-cols-3 gap-4 font-mono text-sm mb-4">
            <div>
              <div className="text-muted-foreground text-xs mb-1">Upper</div>
              <div className="text-red-400">{bbUpper.toFixed(5)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Middle (SMA)</div>
              <div className="text-blue-400">{bbMiddle.toFixed(5)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Lower</div>
              <div className="text-green-400">{bbLower.toFixed(5)}</div>
            </div>
          </div>
          <div className="relative h-2 bg-secondary rounded-full mt-2">
            <div className="absolute top-1/2 left-1/2 w-full h-full -translate-x-1/2 -translate-y-1/2 flex justify-between px-1">
               <div className="w-[1px] h-4 bg-red-500/50" />
               <div className="w-[1px] h-4 bg-blue-500/50" />
               <div className="w-[1px] h-4 bg-green-500/50" />
            </div>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}