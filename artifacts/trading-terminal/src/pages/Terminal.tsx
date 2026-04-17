import React, { useState, useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TradingChart } from '@/components/TradingChart';
import { IndicatorsPanel } from '@/components/IndicatorsPanel';
import { ReasoningSidebar } from '@/components/ReasoningSidebar';
import { TradePanel } from '@/components/TradePanel';
import { StatsPanel } from '@/components/StatsPanel';
import { useGetMarketSymbols, useGetMarketSignal, getGetMarketSignalQueryKey } from '@workspace/api-client-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Activity, Wifi, WifiOff, AlertTriangle } from 'lucide-react';

export default function Terminal() {
  const [symbol, setSymbol] = useState('EUR/USD');
  const [interval, setInterval] = useState('1m');
  const { prices, isConnected, circuitBreaker, latency } = useWebSocket();

  const { data: symbols } = useGetMarketSymbols();
  const currentPrice = prices[symbol];

  const [prevPrice, setPrevPrice] = useState<number | undefined>(undefined);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (currentPrice !== undefined) {
      if (prevPrice !== undefined) {
        if (currentPrice > prevPrice) setPriceDirection('up');
        else if (currentPrice < prevPrice) setPriceDirection('down');
      }
      setPrevPrice(currentPrice);
    }
  }, [currentPrice]);

  const { data: signal } = useGetMarketSignal(symbol, {
    query: {
      queryKey: getGetMarketSignalQueryKey(symbol),
      refetchInterval: 15000,
    },
  });

  const isDanger = !!(signal?.indicators?.rsi && signal.indicators.rsi > 70);
  const isBull = !!(signal?.indicators?.rsi && signal.indicators.rsi < 30);

  const ghostCandle = signal?.ghostCandle ?? null;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background text-foreground font-sans overflow-hidden">
      {/* HEADER */}
      <header className="h-14 border-b border-border/50 flex items-center justify-between px-4 shrink-0 bg-card">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-primary" style={{ textShadow: '0 0 10px rgba(0,200,255,0.5)' }}>
            QUANTUM TERMINAL
          </h1>

          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="w-[140px] h-8 bg-black/20 border-border font-mono">
              <SelectValue placeholder="Select Symbol" />
            </SelectTrigger>
            <SelectContent>
              {Array.isArray(symbols) && symbols.length > 0
                ? symbols.map((s) => (
                    <SelectItem key={s.symbol} value={s.symbol}>{s.symbol}</SelectItem>
                  ))
                : (
                  <>
                    <SelectItem value="EUR/USD">EUR/USD</SelectItem>
                    <SelectItem value="BTC/USD">BTC/USD</SelectItem>
                  </>
                )
              }
            </SelectContent>
          </Select>

          <div className="flex gap-1">
            {['1m', '5m', '15m'].map((int) => (
              <Button
                key={int}
                variant={interval === int ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 font-mono text-xs"
                onClick={() => setInterval(int)}
              >
                {int}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div
            className={`text-2xl font-mono font-bold flex items-center gap-2 transition-colors duration-300 ${
              priceDirection === 'up' ? 'text-green-500' : priceDirection === 'down' ? 'text-red-500' : ''
            }`}
          >
            {currentPrice
              ? symbol.includes('BTC')
                ? currentPrice.toFixed(2)
                : currentPrice.toFixed(5)
              : '---'}
            {priceDirection === 'up' && <span className="text-sm">▲</span>}
            {priceDirection === 'down' && <span className="text-sm">▼</span>}
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
            {signal?.warming && (
              <div className="flex items-center gap-1 text-blue-400 animate-pulse bg-blue-500/10 px-2 py-1 rounded">
                <Activity size={14} />
                WARMING UP
              </div>
            )}
            {signal?.safeMode && !signal?.warming && (
              <div className="flex items-center gap-1 text-amber-500 animate-pulse bg-amber-500/10 px-2 py-1 rounded">
                <AlertTriangle size={14} />
                SAFE MODE
              </div>
            )}
            <div className="flex items-center gap-1">
              <Activity size={14} />
              {latency}ms
            </div>
            <div className="flex items-center gap-1">
              {circuitBreaker ? (
                <span className="text-yellow-500 flex items-center gap-1"><AlertTriangle size={14} /> CB TRIPPED</span>
              ) : isConnected ? (
                <span className="text-green-500 flex items-center gap-1"><Wifi size={14} /> ONLINE</span>
              ) : (
                <span className="text-red-500 flex items-center gap-1"><WifiOff size={14} /> OFFLINE</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-4 pb-2 relative">
            <TradingChart
              symbol={symbol}
              currentPrice={currentPrice}
              interval={interval}
              isDanger={isDanger}
              isBull={isBull}
              ghostCandle={ghostCandle}
              ghostConfidence={signal?.confidence}
            />
          </div>

          <div className="h-48 shrink-0 p-4 pt-2 flex flex-col gap-2">
            <IndicatorsPanel signal={signal} />
          </div>

          <div className="h-48 shrink-0 border-t border-border/50 bg-card">
            <StatsPanel symbol={symbol} />
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="w-[320px] shrink-0 border-l border-border/50 bg-card flex flex-col overflow-y-auto">
          <ReasoningSidebar signal={signal as any} symbol={symbol} />
          <TradePanel symbol={symbol} currentPrice={currentPrice} signal={signal} />
        </div>
      </div>
    </div>
  );
}
