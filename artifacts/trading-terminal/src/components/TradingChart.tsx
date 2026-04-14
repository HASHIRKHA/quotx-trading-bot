import React, { useEffect, useRef } from 'react';
import {
  createChart, ColorType, ISeriesApi, CandlestickData, Time,
  CandlestickSeries, LineSeries, LineStyle,
} from 'lightweight-charts';
import { useGetHistoricalData, getGetHistoricalDataQueryKey } from '@workspace/api-client-react';

interface GhostCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradingChartProps {
  symbol: string;
  currentPrice?: number;
  interval: string;
  isDanger?: boolean;
  isBull?: boolean;
  ghostCandle?: GhostCandle | null;
  ghostConfidence?: number;
}

export function TradingChart({
  symbol, currentPrice, interval, isDanger, isBull, ghostCandle, ghostConfidence,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ghostSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);

  const { data: historicalData } = useGetHistoricalData(symbol, { interval }, {
    query: {
      queryKey: getGetHistoricalDataQueryKey(symbol, { interval }),
      staleTime: 60000,
    },
  });

  // Create chart once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#D9D9D9',
        fontFamily: 'JetBrains Mono',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Ghost candle series — purple, semi-transparent
    const ghostSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(168,85,247,0.45)',
      downColor: 'rgba(168,85,247,0.45)',
      borderUpColor: 'rgba(168,85,247,0.9)',
      borderDownColor: 'rgba(168,85,247,0.9)',
      wickUpColor: 'rgba(168,85,247,0.7)',
      wickDownColor: 'rgba(168,85,247,0.7)',
      borderVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series as unknown as ISeriesApi<'Candlestick'>;
    ghostSeriesRef.current = ghostSeries as unknown as ISeriesApi<'Candlestick'>;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Load historical data
  useEffect(() => {
    if (!historicalData || !seriesRef.current) return;
    // Defensive guard — API may return an error object or null during loading
    if (!Array.isArray(historicalData) || historicalData.length === 0) return;

    const formatted: CandlestickData<Time>[] = historicalData
      .map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    try {
      seriesRef.current.setData(formatted);
      if (formatted.length > 0) lastCandleRef.current = formatted[formatted.length - 1];
    } catch {}
  }, [historicalData]);

  // Live price update — extend current candle
  useEffect(() => {
    if (!currentPrice || !seriesRef.current || !lastCandleRef.current) return;
    const now = Math.floor(Date.now() / 1000);
    const intervalSecs = interval === '1m' ? 60 : interval === '5m' ? 300 : 900;
    const currentCandle = lastCandleRef.current;
    let newCandle: CandlestickData<Time>;

    if (now - (currentCandle.time as number) >= intervalSecs) {
      newCandle = { time: now as Time, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice };
    } else {
      newCandle = {
        ...currentCandle,
        high: Math.max(currentCandle.high, currentPrice),
        low: Math.min(currentCandle.low, currentPrice),
        close: currentPrice,
      };
    }
    try {
      seriesRef.current.update(newCandle);
      lastCandleRef.current = newCandle;
    } catch {}
  }, [currentPrice, interval]);

  // Ghost candle — update whenever signal changes
  useEffect(() => {
    if (!ghostSeriesRef.current) return;

    if (!ghostCandle) {
      try { ghostSeriesRef.current.setData([]); } catch {}
      return;
    }

    // Scale ghost opacity via confidence
    const alpha = ghostConfidence ? Math.max(0.25, ghostConfidence / 100) : 0.4;
    try {
      ghostSeriesRef.current.applyOptions({
        upColor: `rgba(168,85,247,${alpha * 0.5})`,
        downColor: `rgba(168,85,247,${alpha * 0.5})`,
        borderUpColor: `rgba(168,85,247,${alpha})`,
        borderDownColor: `rgba(168,85,247,${alpha})`,
        wickUpColor: `rgba(168,85,247,${alpha * 0.8})`,
        wickDownColor: `rgba(168,85,247,${alpha * 0.8})`,
      });
      ghostSeriesRef.current.setData([{
        time: ghostCandle.time as Time,
        open: ghostCandle.open,
        high: ghostCandle.high,
        low: ghostCandle.low,
        close: ghostCandle.close,
      }]);
    } catch {}
  }, [ghostCandle, ghostConfidence]);

  // Determine whether we have valid chart data yet
  const hasData = Array.isArray(historicalData) && historicalData.length > 0;

  return (
    <div
      className={`w-full h-full relative rounded-lg overflow-hidden border border-border/50 transition-shadow duration-300 ${
        isDanger ? 'chart-bearish-glow' : isBull ? 'chart-bullish-glow' : ''
      }`}
    >
      <div ref={chartContainerRef} className="w-full h-full" />

      {/* Loading overlay — shown until first valid candle array arrives */}
      {!hasData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/80 z-10">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Loading Market Data</p>
        </div>
      )}

      {/* Ghost candle legend */}
      {ghostCandle && (
        <div className="absolute bottom-8 left-3 flex items-center gap-1.5 text-[10px] font-mono text-purple-400 bg-black/60 px-2 py-1 rounded border border-purple-500/30">
          <div className="w-2 h-2 rounded-sm bg-purple-500 opacity-70" />
          PREDICTED +60s
          {ghostConfidence && <span className="ml-1 text-purple-300">({ghostConfidence.toFixed(0)}%)</span>}
        </div>
      )}
    </div>
  );
}
