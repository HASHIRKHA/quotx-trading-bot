import React, { useEffect, useRef } from 'react';
import {
  createChart, ColorType, ISeriesApi, CandlestickData, Time,
  CandlestickSeries, HistogramSeries, LineStyle,
} from 'lightweight-charts';
import { useGetHistoricalData, getGetHistoricalDataQueryKey } from '@workspace/api-client-react';

interface GhostCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface GhostParams {
  direction: 'UP' | 'DOWN';
  scale: number;
  time: number;
}

interface TradingChartProps {
  symbol: string;
  currentPrice?: number;
  interval: string;
  isDanger?: boolean;
  isBull?: boolean;
  ghostCandle?: GhostCandle | null;
  ghostConfidence?: number;
  ghostDimmed?: boolean;   // true when entropy is in soft-block zone (0.97–0.99)
}

export function TradingChart({
  symbol, currentPrice, interval, isDanger, isBull, ghostCandle, ghostConfidence, ghostDimmed,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ghostSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);

  // Ghost candle fluid update state — stored in refs so the 500ms interval always reads fresh values
  const ghostParamsRef = useRef<GhostParams | null>(null);
  const ghostDimmedRef = useRef<boolean>(false);
  const ghostConfRef = useRef<number>(0.5);
  const entryPriceLineRef = useRef<any>(null);
  const entryLineDirectionRef = useRef<string | null>(null);

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
        background: { type: ColorType.Solid, color: '#050d07' },
        textColor: 'rgba(160,220,175,0.7)',
        fontFamily: 'JetBrains Mono',
      },
      grid: {
        vertLines: { color: 'rgba(0,255,100,0.04)' },
        horzLines: { color: 'rgba(0,255,100,0.04)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: 'rgba(0,255,100,0.1)',
        scaleMargins: { top: 0.08, bottom: 0.18 },
      },
      timeScale: {
        borderColor: 'rgba(0,255,100,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00e676',
      downColor: '#ff5252',
      borderVisible: false,
      wickUpColor: '#00e676',
      wickDownColor: '#ff5252',
    });

    // Volume histogram — pinned to bottom 15% of pane
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(0,230,118,0.2)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      visible: false,
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
    volumeSeriesRef.current = volumeSeries as unknown as ISeriesApi<'Histogram'>;
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

  // Load historical data + volume
  useEffect(() => {
    if (!historicalData || !seriesRef.current) return;
    if (!Array.isArray(historicalData) || historicalData.length === 0) return;

    const sorted = [...historicalData].sort((a, b) => a.time - b.time);

    const formatted: CandlestickData<Time>[] = sorted.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = sorted.map((c) => ({
      time: c.time as Time,
      value: c.volume ?? 0,
      color: c.close >= c.open ? 'rgba(0,230,118,0.25)' : 'rgba(255,82,82,0.25)',
    }));

    try {
      seriesRef.current.setData(formatted);
      if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volumeData as any);
      if (formatted.length > 0) lastCandleRef.current = formatted[formatted.length - 1];
      // Reset Y-axis scale and scroll to latest data whenever we load a new symbol.
      // Without this the chart keeps the previous pair's price range and all candles
      // appear off-screen (the "empty chart / wrong Y-axis" bug when switching pairs).
      if (chartRef.current) {
        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        chartRef.current.timeScale().fitContent();
      }
    } catch {}
  }, [historicalData]);

  // Live price update — extend current candle
  useEffect(() => {
    if (!currentPrice || !seriesRef.current || !lastCandleRef.current) return;
    const now = Math.floor(Date.now() / 1000);
    const intervalSecs = interval === '5m' ? 300 : interval === '10m' ? 600 : 60;
    const currentCandle = lastCandleRef.current;
    let newCandle: CandlestickData<Time>;

    if (now - (currentCandle.time as number) >= intervalSecs) {
      // Round new candle timestamp to interval boundary so the time axis stays
      // consistent with historical candles (no second-precision labels).
      const alignedTime = Math.floor(now / intervalSecs) * intervalSecs;
      newCandle = { time: alignedTime as Time, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice };
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

  // When the signal ghost candle changes: extract direction & scale into the ref
  // No direct chart update here — the 500ms interval handles all chart writes
  useEffect(() => {
    if (!ghostCandle) {
      ghostParamsRef.current = null;
      return;
    }
    const isUp = ghostCandle.close >= ghostCandle.open;
    // scale = range / 0.5 (since close = open ± scale*0.5 from predictGhostCandle)
    const scale = Math.abs(ghostCandle.close - ghostCandle.open) / 0.5 || Math.abs(ghostCandle.high - ghostCandle.low) / 0.9;
    ghostParamsRef.current = {
      direction: isUp ? 'UP' : 'DOWN',
      scale,
      time: ghostCandle.time,
    };
  }, [ghostCandle]);

  // Keep dimmed and confidence refs in sync with props
  useEffect(() => {
    ghostDimmedRef.current = !!ghostDimmed;
  }, [ghostDimmed]);

  useEffect(() => {
    ghostConfRef.current = ghostConfidence ? ghostConfidence / 100 : 0.5;
  }, [ghostConfidence]);

  // 500ms fluid ghost candle loop — anchors ghost open to latest live price
  useEffect(() => {
    const tick = () => {
      if (!ghostSeriesRef.current) return;

      const params = ghostParamsRef.current;
      if (!params || !lastCandleRef.current) {
        try { ghostSeriesRef.current.setData([]); } catch {}
        // Remove entry price line when no signal
        if (entryPriceLineRef.current && seriesRef.current) {
          try { seriesRef.current.removePriceLine(entryPriceLineRef.current); } catch {}
          entryPriceLineRef.current = null;
        }
        return;
      }

      const livePrice = lastCandleRef.current.close;
      const conf = ghostConfRef.current;
      const dimmed = ghostDimmedRef.current;
      // Minimum 0.55 alpha so ghost is always clearly visible even at 55% confidence
      const alpha = Math.max(0.55, conf) * (dimmed ? 0.4 : 1.0);

      let gc: CandlestickData<Time>;
      if (params.direction === 'UP') {
        gc = {
          time: params.time as Time,
          open: livePrice,
          high: livePrice + params.scale * 0.75,
          low: livePrice - params.scale * 0.15,
          close: livePrice + params.scale * 0.5,
        };
      } else {
        gc = {
          time: params.time as Time,
          open: livePrice,
          high: livePrice + params.scale * 0.15,
          low: livePrice - params.scale * 0.75,
          close: livePrice - params.scale * 0.5,
        };
      }

      try {
        ghostSeriesRef.current.applyOptions({
          // Body: 0.82 → very solid, clearly visible candle body
          upColor:         `rgba(168,85,247,${(alpha * 0.82).toFixed(2)})`,
          downColor:       `rgba(168,85,247,${(alpha * 0.82).toFixed(2)})`,
          // Border: full alpha — crisp outline
          borderUpColor:   `rgba(168,85,247,${Math.min(1, alpha * 1.1).toFixed(2)})`,
          borderDownColor: `rgba(168,85,247,${Math.min(1, alpha * 1.1).toFixed(2)})`,
          // Wick: full alpha so it's clearly readable
          wickUpColor:     `rgba(168,85,247,${alpha.toFixed(2)})`,
          wickDownColor:   `rgba(168,85,247,${alpha.toFixed(2)})`,
        });
        ghostSeriesRef.current.setData([gc]);
      } catch {}

      // Entry price line — remove and recreate when direction flips so the
      // correct colour and label are always shown for the current signal.
      const directionChanged = entryLineDirectionRef.current !== params.direction;
      if (seriesRef.current && (directionChanged || !entryPriceLineRef.current)) {
        if (entryPriceLineRef.current) {
          try { seriesRef.current.removePriceLine(entryPriceLineRef.current); } catch {}
          entryPriceLineRef.current = null;
        }
        entryLineDirectionRef.current = params.direction;
        try {
          entryPriceLineRef.current = seriesRef.current.createPriceLine({
            price: livePrice,
            color: params.direction === 'UP' ? 'rgba(38,166,154,0.8)' : 'rgba(239,83,80,0.8)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: params.direction === 'UP' ? '▲ ENTRY' : '▼ ENTRY',
          });
        } catch {}
      }
    };

    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []); // intentionally empty — reads everything from refs

  const hasData = Array.isArray(historicalData) && historicalData.length > 0;

  return (
    <div
      className={`w-full h-full relative rounded-lg overflow-hidden border border-border/50 transition-shadow duration-300 ${
        isDanger ? 'chart-bearish-glow' : isBull ? 'chart-bullish-glow' : ''
      }`}
    >
      <div ref={chartContainerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {!hasData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/80 z-10">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Loading Market Data</p>
        </div>
      )}

      {/* Ghost candle legend */}
      {ghostCandle && (
        <div className={`absolute bottom-8 left-3 flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 rounded-md border ${
          ghostDimmed
            ? 'text-purple-400/60 bg-purple-900/20 border-purple-500/20'
            : 'text-purple-300 bg-purple-900/40 border-purple-400/50 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
        }`} style={ghostDimmed ? {} : { backdropFilter: 'blur(4px)' }}>
          <div className={`w-2.5 h-2.5 rounded-sm ${ghostDimmed ? 'bg-purple-500/40' : 'bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)]'}`} />
          <span className="font-bold tracking-wide">PREDICTED {interval === '5m' ? '+5min' : interval === '10m' ? '+10min' : '+1min'}</span>
          {ghostConfidence && <span className="text-purple-200 font-bold">({ghostConfidence.toFixed(0)}%)</span>}
          {ghostDimmed && <span className="text-amber-400/70 text-[9px] font-normal">REDUCED</span>}
        </div>
      )}
    </div>
  );
}
