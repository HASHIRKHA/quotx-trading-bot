import React from 'react';
import { useGetTradeStats, useGetTradeHistory, getGetTradeStatsQueryKey, getGetTradeHistoryQueryKey } from '@workspace/api-client-react';

export function StatsPanel({ symbol }: { symbol: string }) {
  const { data: stats } = useGetTradeStats(
    { symbol },
    { query: { queryKey: getGetTradeStatsQueryKey({ symbol }), refetchInterval: 5000 } }
  );

  const { data: history } = useGetTradeHistory(
    { symbol, limit: 5 },
    { query: { queryKey: getGetTradeHistoryQueryKey({ symbol, limit: 5 }), refetchInterval: 5000 } }
  );

  if (!stats) {
    return (
      <div className="p-4 text-muted-foreground font-mono text-sm animate-pulse">
        Calculating Stats...
      </div>
    );
  }

  const winRate = stats?.winRate ?? 0;

  return (
    <div className="flex h-full p-4 gap-6">
      <div className="w-[300px] flex flex-col justify-center gap-4 border-r border-border/50 pr-6">
        <div className="flex justify-between items-end">
          <div className="text-sm font-mono text-muted-foreground">WIN RATE</div>
          <div className={`text-3xl font-bold font-mono ${winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
            {winRate.toFixed(1)}%
          </div>
        </div>
        <div className="h-2 w-full bg-red-500/20 rounded-full overflow-hidden flex">
          <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${winRate}%` }} />
        </div>
        <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs">
          <div>
            <div className="text-muted-foreground mb-1">TOTAL</div>
            <div>{stats.totalTrades}</div>
          </div>
          <div>
            <div className="text-green-500 mb-1">WINS</div>
            <div className="text-green-500">{stats.wins}</div>
          </div>
          <div>
            <div className="text-red-500 mb-1">LOSS</div>
            <div className="text-red-500">{stats.losses}</div>
          </div>
          <div>
            <div className="text-blue-400 mb-1">STREAK</div>
            <div className="text-blue-400">{stats.currentStreak}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <h3 className="text-xs font-mono text-muted-foreground mb-2">RECENT HISTORY</h3>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs font-mono text-left">
            <thead className="text-muted-foreground sticky top-0 bg-card">
              <tr>
                <th className="pb-2 font-normal">TIME</th>
                <th className="pb-2 font-normal">DIR</th>
                <th className="pb-2 font-normal">ENTRY</th>
                <th className="pb-2 font-normal">EXIT</th>
                <th className="pb-2 font-normal">RESULT</th>
              </tr>
            </thead>
            <tbody>
              {history?.filter(t => t.outcome !== null).map(trade => (
                <tr key={trade.id} className="border-t border-border/20">
                  <td className="py-2 opacity-70">{new Date(trade.createdAt).toLocaleTimeString()}</td>
                  <td className={`py-2 ${trade.direction === 'UP' ? 'text-green-500' : 'text-red-500'}`}>{trade.direction}</td>
                  <td className="py-2">{Number(trade.entryPrice ?? 0).toFixed(5)}</td>
                  <td className="py-2">{trade.exitPrice != null ? Number(trade.exitPrice).toFixed(5) : '---'}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded ${trade.outcome === 'WIN' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                      {trade.outcome}
                    </span>
                  </td>
                </tr>
              ))}
              {history?.filter(t => t.outcome !== null).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground italic">No resolved trades yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}