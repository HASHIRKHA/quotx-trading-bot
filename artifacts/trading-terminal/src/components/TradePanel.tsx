import React, { useState, useEffect } from 'react';
import { useCreateSimulatedTrade, useResolveSimulatedTrade, useGetTradeHistory, getGetTradeHistoryQueryKey, getGetTradeStatsQueryKey, SignalAnalysis } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function TradePanel({ symbol, currentPrice, signal }: { symbol: string, currentPrice?: number, signal?: SignalAnalysis }) {
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [expiry, setExpiry] = useState<number>(60);
  const createTrade = useCreateSimulatedTrade();
  const resolveTrade = useResolveSimulatedTrade();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: activeTrades } = useGetTradeHistory(
    { symbol, limit: 10 },
    { query: { queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }), refetchInterval: 1000 } }
  );

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
        toast({ title: "Trade executed", description: `${direction} on ${symbol} at ${currentPrice}` });
        queryClient.invalidateQueries({ queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }) });
        queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey({ symbol }) });
      }
    });
  };

  // Auto-resolve check
  useEffect(() => {
    if (!activeTrades || !currentPrice) return;
    
    activeTrades.forEach(trade => {
      if (trade.outcome === null) {
        const createdTime = new Date(trade.createdAt).getTime();
        const now = Date.now();
        const elapsed = (now - createdTime) / 1000;
        
        if (elapsed >= trade.expirySeconds) {
          const isWin = trade.direction === 'UP' ? currentPrice > trade.entryPrice : currentPrice < trade.entryPrice;
          resolveTrade.mutate({
            id: trade.id,
            data: {
              exitPrice: currentPrice,
              outcome: isWin ? 'WIN' : 'LOSS'
            }
          }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 10 }) });
              queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey({ symbol }) });
            }
          });
        }
      }
    });
  }, [activeTrades, currentPrice, resolveTrade, queryClient, symbol]);

  return (
    <div className="flex flex-col p-4 gap-4 mt-auto border-t border-border/50 bg-black/20">
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
        {[30, 60, 120, 300].map(time => (
          <Button
            key={time}
            variant={expiry === time ? 'secondary' : 'ghost'}
            size="sm"
            className="flex-1 font-mono text-xs h-8 bg-black/40"
            onClick={() => setExpiry(time)}
          >
            {time}s
          </Button>
        ))}
      </div>

      <div className="flex justify-between items-center font-mono text-sm bg-black/40 p-2 rounded border border-border/50">
        <span className="text-muted-foreground">Entry</span>
        <span className="font-bold">{currentPrice ? currentPrice.toFixed(5) : '---'}</span>
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
        {activeTrades?.filter(t => t.outcome === null).map(trade => {
           const elapsed = (Date.now() - new Date(trade.createdAt).getTime()) / 1000;
           const remaining = Math.max(0, Math.ceil(trade.expirySeconds - elapsed));
           const currentProfit = currentPrice 
             ? (trade.direction === 'UP' ? currentPrice > trade.entryPrice : currentPrice < trade.entryPrice)
             : false;

           return (
             <div key={trade.id} className={`flex items-center justify-between p-2 rounded text-xs font-mono border ${currentProfit ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
               <div className="flex items-center gap-2">
                 {trade.direction === 'UP' ? <ArrowUp size={12} className="text-green-500"/> : <ArrowDown size={12} className="text-red-500"/>}
                 <span>{trade.entryPrice.toFixed(5)}</span>
               </div>
               <div className="font-bold">{remaining}s</div>
             </div>
           );
        })}
        {activeTrades?.filter(t => t.outcome === null).length === 0 && (
          <div className="text-xs font-mono text-muted-foreground text-center py-2 italic">No active trades</div>
        )}
      </div>
    </div>
  );
}