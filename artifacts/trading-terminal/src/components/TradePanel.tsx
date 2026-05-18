import React, { useState, useEffect, useRef } from 'react';
import { useCreateSimulatedTrade, useResolveSimulatedTrade, useGetTradeHistory, getGetTradeHistoryQueryKey, getGetTradeStatsQueryKey, SignalAnalysis } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

/** Symbol-aware price formatter — BTC/ETH/XAU/SOL at 2 dp, everything else at 5. */
function formatPrice(symbol: string, price: number): string {
  if (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('SOL'))
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(5);
}

/** Expiry options — value in seconds, label shown to user. */
const EXPIRY_OPTIONS: { value: number; label: string }[] = [
  { value: 30,  label: '30s' },
  { value: 60,  label: '1m'  },
  { value: 120, label: '2m'  },
  { value: 300, label: '5m'  },
];

export function TradePanel({ symbol, currentPrice: wsPrice, signal }: { symbol: string, currentPrice?: number, signal?: SignalAnalysis }) {
  // OTC pairs may not have a WebSocket price — fall back to the last price from
  // the signal API response (included as `currentPrice` in every signal response).
  const currentPrice = wsPrice ?? (signal as any)?.currentPrice ?? undefined;
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [expiry, setExpiry] = useState<number>(60);
  const createTrade = useCreateSimulatedTrade();
  const resolveTrade = useResolveSimulatedTrade();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Track trades currently being resolved to prevent duplicate mutation calls
  // when the price ticks again before the network response comes back.
  const resolvingIds = useRef<Set<number>>(new Set());

  const { data: activeTrades } = useGetTradeHistory(
    { symbol, limit: 10 },
    { query: { queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }), refetchInterval: 1000 } }
  );

  const trades = Array.isArray(activeTrades) ? activeTrades : [];
  const pendingTrades = trades.filter(t => t.outcome === null);

  const handleExecute = () => {
    if (!currentPrice) {
      toast({ title: "Price unavailable", variant: "destructive" });
      return;
    }

    createTrade.mutate({
      data: {
        symbol,
        direction,
        entryPrice: currentPrice,
        confidence: signal?.confidence || 50,
        expirySeconds: expiry,
        reasons: signal?.reasons || []
      }
    }, {
      onSuccess: () => {
        toast({ title: "Trade executed", description: `${direction} on ${symbol} at ${formatPrice(symbol, currentPrice)}` });
        queryClient.invalidateQueries({ queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }) });
        queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey({ symbol }) });
      }
    });
  };

  // Auto-resolve expired trades — guards against duplicate calls with resolvingIds ref.
  useEffect(() => {
    if (!currentPrice || trades.length === 0) return;

    trades.forEach(trade => {
      if (trade.outcome !== null) return;
      if (resolvingIds.current.has(trade.id)) return;

      const elapsed = (Date.now() - new Date(trade.createdAt).getTime()) / 1000;
      if (elapsed >= trade.expirySeconds) {
        const entryNum = Number(trade.entryPrice ?? 0);
        const isWin = trade.direction === 'UP' ? currentPrice > entryNum : currentPrice < entryNum;

        resolvingIds.current.add(trade.id);
        resolveTrade.mutate(
          { id: trade.id, data: { exitPrice: currentPrice, outcome: isWin ? 'WIN' : 'LOSS' } },
          {
            onSuccess: () => {
              resolvingIds.current.delete(trade.id);
              queryClient.invalidateQueries({ queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }) });
              queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey({ symbol }) });
            },
            onError: () => {
              resolvingIds.current.delete(trade.id);
            },
          }
        );
      }
    });
  }, [trades, currentPrice, resolveTrade, queryClient, symbol]);

  if (activeTrades === undefined) {
    return (
      <div className="p-4 text-center animate-pulse text-xs text-muted-foreground">
        Syncing active trades...
      </div>
    );
  }

  return (
    <div className="flex flex-col p-4 gap-4 border-t border-border/50 bg-black/20">
      <div className="flex gap-2">
        <Button
          variant={direction === 'UP' ? 'default' : 'outline'}
          className={`flex-1 ${direction === 'UP' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
          onClick={() => setDirection('UP')}
        >
          <ArrowUp size={16} className="mr-1" /> UP
        </Button>
        <Button
          variant={direction === 'DOWN' ? 'default' : 'outline'}
          className={`flex-1 ${direction === 'DOWN' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
          onClick={() => setDirection('DOWN')}
        >
          <ArrowDown size={16} className="mr-1" /> DOWN
        </Button>
      </div>

      <div className="flex gap-2">
        {EXPIRY_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            variant={expiry === value ? 'secondary' : 'ghost'}
            size="sm"
            className="flex-1 font-mono text-xs h-8 bg-black/40"
            onClick={() => setExpiry(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex justify-between items-center font-mono text-sm bg-black/40 p-2 rounded border border-border/50">
        <span className="text-muted-foreground">Entry</span>
        <span className="font-bold">{currentPrice ? formatPrice(symbol, currentPrice) : '---'}</span>
      </div>

      <Button
        className="w-full font-bold tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
        size="lg"
        onClick={handleExecute}
        disabled={!currentPrice || createTrade.isPending || signal?.safeMode}
      >
        EXECUTE TRADE
      </Button>

      {/* ACTIVE TRADES LIST */}
      <div className="flex flex-col gap-2 mt-2">
        <h3 className="text-xs font-mono text-muted-foreground">ACTIVE TRADES</h3>
        {pendingTrades.map(trade => {
          const elapsed = (Date.now() - new Date(trade.createdAt).getTime()) / 1000;
          const remaining = Math.max(0, Math.ceil((trade.expirySeconds ?? 60) - elapsed));
          const entryNum = Number(trade.entryPrice ?? 0);
          const currentProfit = currentPrice
            ? (trade.direction === 'UP' ? currentPrice > entryNum : currentPrice < entryNum)
            : false;

          return (
            <div key={trade.id} className={`flex items-center justify-between p-2 rounded text-xs font-mono border ${currentProfit ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
              <div className="flex items-center gap-2">
                {trade.direction === 'UP' ? <ArrowUp size={12} className="text-green-500"/> : <ArrowDown size={12} className="text-red-500"/>}
                <span>{formatPrice(symbol, entryNum)}</span>
              </div>
              <div className="font-bold">{remaining}s</div>
            </div>
          );
        })}
        {pendingTrades.length === 0 && (
          <div className="text-xs font-mono text-muted-foreground text-center py-2 italic">No active trades</div>
        )}
      </div>
    </div>
  );
}
