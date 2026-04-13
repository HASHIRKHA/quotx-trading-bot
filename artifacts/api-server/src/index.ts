import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initTwelveData, subscribeToTicks, getPrice, isCircuitBreakerOpen, getLatency } from "./lib/twelvedata.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (client, req) => {
  logger.info({ ip: req.socket.remoteAddress }, "WebSocket client connected");

  const sendToClient = (data: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  };

  sendToClient({
    type: "connected",
    message: "Connected to Binary Prediction Terminal feed",
    circuitBreaker: isCircuitBreakerOpen(),
    latency: getLatency(),
  });

  const unsub = subscribeToTicks((tick) => {
    if (isCircuitBreakerOpen()) {
      sendToClient({
        type: "circuit_breaker",
        message: "Feed paused — latency exceeded 500ms",
        latency: getLatency(),
      });
      return;
    }

    sendToClient({
      type: "tick",
      symbol: tick.symbol,
      price: tick.price,
      timestamp: tick.timestamp,
      latency: getLatency(),
    });
  });

  const statusInterval = setInterval(() => {
    sendToClient({
      type: "status",
      circuitBreaker: isCircuitBreakerOpen(),
      latency: getLatency(),
    });
  }, 5000);

  client.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { action?: string; symbol?: string };
      if (msg.action === "ping") {
        sendToClient({ type: "pong", timestamp: Date.now() });
      } else if (msg.action === "price" && msg.symbol) {
        sendToClient({
          type: "price_snapshot",
          symbol: msg.symbol,
          price: getPrice(msg.symbol),
          timestamp: Date.now(),
        });
      }
    } catch {
    }
  });

  client.on("close", () => {
    unsub();
    clearInterval(statusInterval);
    logger.info("WebSocket client disconnected");
  });

  client.on("error", (err) => {
    logger.error({ err }, "WebSocket client error");
  });
});

server.listen(port, () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
  initTwelveData();
});
