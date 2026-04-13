import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useGetHistoricalData, getGetHistoricalDataQueryKey } from '@workspace/api-client-react';

interface TradingChartProps {
  symbol: string;
  currentPrice?: number;
  interval: string;
  isDanger?: boolean;
  isBull?: boolean;
}

export function TradingChart({ symbol, currentPrice, interval, isDanger, isBull }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const { data: historicalData } = useGetHistoricalData(symbol, { interval }, {
    query: {
      queryKey: getGetHistoricalDataQueryKey(symbol, { interval }),
      staleTime: 60000,
    }
  });

  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#D9D9D9',
        fontFamily: 'JetBrains Mono',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 1, // Magnet
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
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

    chartRef.current = chart;
    seriesRef.current = series as any;

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

  useEffect(() => {
    if (historicalData && seriesRef.current) {
      const formattedData: CandlestickData<Time>[] = historicalData.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      
      // Sort by time to satisfy lightweight-charts
      formattedData.sort((a, b) => (a.time as number) - (b.time as number));
      
      try {
        seriesRef.current.setData(formattedData);
        if (formattedData.length > 0) {
           lastCandleRef.current = formattedData[formattedData.length - 1];
        }
      } catch (e) {}
    }
  }, [historicalData]);

  useEffect(() => {
    if (currentPrice && seriesRef.current && lastCandleRef.current) {
      const now = Math.floor(Date.now() / 1000);
      const currentCandle = lastCandleRef.current;
      
      // For simplicity, we either update the current candle or create a new one every 60s
      // A more robust implementation would respect the actual interval.
      const intervalSecs = interval === '1m' ? 60 : interval === '5m' ? 300 : 900;
      
      let newCandle: CandlestickData<Time>;
      
      if (now - (currentCandle.time as number) >= intervalSecs) {
        newCandle = {
          time: now as Time,
          open: currentPrice,
          high: currentPrice,
          low: currentPrice,
          close: currentPrice,
        };
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
      } catch (e) {}
    }
  }, [currentPrice, interval]);

  return (
    <div className={`w-full h-full relative rounded-lg overflow-hidden border border-border/50 transition-shadow duration-300 ${isDanger ? 'chart-bearish-glow' : isBull ? 'chart-bullish-glow' : ''}`}>
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}

// Ensure CandlestickSeries is correctly imported for the addSeries function
import { CandlestickSeries } from 'lightweight-charts';