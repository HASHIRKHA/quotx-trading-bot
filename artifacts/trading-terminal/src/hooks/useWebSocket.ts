import { useState, useEffect, useRef, useCallback } from 'react';

interface WebSocketState {
  prices: Record<string, number>;
  isConnected: boolean;
  circuitBreaker: boolean;
  latency: number;
  liveTickCounts: Record<string, number>;
}

const SYMBOLS = [
  // Crypto
  'BTC/USD', 'ETH/USD', 'SOL/USD',
  // Commodity
  'XAU/USD',
  // Forex — real
  'EUR/USD', 'GBP/USD', 'USD/JPY',
  'GBP/JPY', 'AUD/JPY', 'EUR/JPY', 'NZD/JPY',
  'GBP/NZD', 'CAD/CHF', 'EUR/GBP', 'AUD/CAD', 'EUR/CHF',
  // Forex — OTC
  'EUR/USD OTC', 'GBP/USD OTC', 'USD/JPY OTC',
  'GBP/JPY OTC', 'AUD/JPY OTC', 'EUR/JPY OTC', 'NZD/JPY OTC',
  'GBP/NZD OTC', 'CAD/CHF OTC', 'EUR/GBP OTC', 'AUD/CAD OTC', 'EUR/CHF OTC',
  'USD/EGP OTC', 'USD/IDR OTC', 'USD/DZD OTC',
];

function getApiBase(): string {
  // In production (Vercel), VITE_API_URL points to the Railway backend.
  // In development, an empty string makes all fetches relative — Vite proxy handles them.
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  return apiUrl.replace(/\/+$/, '');
}

function getWsUrl(): string {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  if (apiUrl) {
    // Convert https:// → wss://, http:// → ws://
    const wsBase = apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/+$/, '');
    return `${wsBase}/ws`;
  }
  // Dev fallback: same host, Vite proxy forwards to localhost:3001
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

async function fetchInitialQuote(symbol: string, maxRetries = 3): Promise<number | null> {
  const encoded = encodeURIComponent(symbol);
  const url = `${getApiBase()}/api/market/quote/${encoded}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data = (await resp.json()) as { price?: number | null };
        if (typeof data.price === 'number' && data.price > 0) return data.price;
      }
    } catch {
      // network error — retry
    }
    // Wait 1 s before next attempt (skip wait after last attempt)
    if (attempt < maxRetries - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

export function useWebSocket(): WebSocketState {
  const [state, setState] = useState<WebSocketState>({
    prices: {},
    isConnected: false,
    circuitBreaker: false,
    latency: 0,
    liveTickCounts: {},
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  const performHandshake = useCallback(async () => {
    const results = await Promise.allSettled(
      SYMBOLS.map((sym) => fetchInitialQuote(sym).then((price) => ({ sym, price })))
    );
    const updates: Record<string, number> = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.price !== null) {
        updates[r.value.sym] = r.value.price;
      }
    }
    if (Object.keys(updates).length > 0) {
      setState((s) => ({
        ...s,
        prices: { ...s.prices, ...updates },
      }));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = getWsUrl();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, isConnected: true }));
      backoffRef.current = 1000;
      // REST price handshake — populate price immediately without waiting for first tick
      void performHandshake();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          symbol?: string;
          price?: number;
          latency?: number;
          circuitBreaker?: boolean;
        };

        if (data.type === 'tick' && data.symbol && typeof data.price === 'number') {
          setState((s) => ({
            ...s,
            prices: { ...s.prices, [data.symbol!]: data.price! },
            liveTickCounts: {
              ...s.liveTickCounts,
              [data.symbol!]: (s.liveTickCounts[data.symbol!] ?? 0) + 1,
            },
          }));
        } else if (data.type === 'status') {
          setState((s) => ({
            ...s,
            latency: data.latency ?? 0,
            circuitBreaker: !!data.circuitBreaker,
          }));
        } else if (data.type === 'circuit_breaker') {
          setState((s) => ({ ...s, circuitBreaker: true }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, isConnected: false }));
      const timeout = Math.min(backoffRef.current * 1.5, 30000);
      backoffRef.current = timeout;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, timeout);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [performHandshake]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return state;
}
