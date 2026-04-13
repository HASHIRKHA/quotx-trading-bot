import { useState, useEffect, useRef, useCallback } from 'react';

interface WebSocketState {
  prices: Record<string, number>;
  isConnected: boolean;
  circuitBreaker: boolean;
  latency: number;
}

export function useWebSocket(): WebSocketState {
  const [state, setState] = useState<WebSocketState>({
    prices: {},
    isConnected: false,
    circuitBreaker: false,
    latency: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws';
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, isConnected: true }));
      backoffRef.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'tick') {
          setState(s => ({
            ...s,
            prices: { ...s.prices, [data.symbol]: data.price }
          }));
        } else if (data.type === 'status') {
          setState(s => ({
            ...s,
            latency: data.latency || 0,
            circuitBreaker: !!data.circuitBreaker
          }));
        } else if (data.type === 'circuit_breaker') {
          setState(s => ({ ...s, circuitBreaker: true }));
        }
      } catch (err) {
        // ignore
      }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, isConnected: false }));
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
      // close will be called which handles reconnect
      ws.close();
    };
  }, []);

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
