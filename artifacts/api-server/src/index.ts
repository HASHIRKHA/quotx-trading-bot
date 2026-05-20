import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initTwelveData, subscribeToTicks, getPrice, setPrice, getPriceAge, isCircuitBreakerOpen, getLatency, setCandles, getCandles, setHourlyCandles, getLiveTicks, isPriceFrozen, SYMBOLS } from "./lib/twelvedata.js";
import { initDerivFeed } from "./lib/derivFeed.js";
import { initQuotexFeed } from "./lib/quotexFeed.js";
import { fetchAndCacheCandles } from "./lib/datastore.js";
import { fetchFreePrices, fetchBinanceCandles, fetchYahooCandles } from "./lib/freePriceFeed.js";
import { generateSeedCandles } from "./lib/seedCandles.js";
import { seedAllSymbolsToSupabase, startCandleFlush } from "./lib/candlePersister.js";
import { startAutoResolver } from "./lib/autoResolver.js";
import { startSignalSweeper } from "./lib/signalSweeper.js";
import { startSignalCleanup } from "./lib/signalCleanup.js";

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

// Primary symbols that get real candle history from external APIs on startup.
// OTC / exotic pairs are handled by candlePersister (Supabase seed/load).
const ALL_SYMBOLS = ["BTC/USD", "ETH/USD", "XAU/USD", "SOL/USD"];

server.listen(port, () => { void (async () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket)");

  // ── Step 1: Fetch real current prices from free public APIs (no key needed)
  // This anchors synthetic candle seeds to actual market levels immediately.
  let freePrices: Record<string, number> = {};
  try {
    freePrices = await fetchFreePrices() as Record<string, number>;
    logger.info({ freePrices }, "Real prices fetched from free public APIs");
  } catch (err) {
    logger.warn({ err }, "Free price feed unavailable — using hardcoded defaults");
  }

  // ── Step 2: Seed candle cache with real-price-anchored synthetic data for ALL symbols
  for (const sym of ALL_SYMBOLS) {
    const realPrice = freePrices[sym];
    if (!getCandles(sym).length) {
      const seed = generateSeedCandles(sym, 200, realPrice);
      setCandles(sym, seed);
      logger.info({ symbol: sym, basePrice: realPrice ?? "default" }, "Candle cache seeded (real-price anchor)");
    }
  }

  // ── Step 2b: Seed ALL symbols (including all 31 OTC/forex pairs) with real-price-anchored
  // synthetic candles so they're ready before the Supabase load overwrites them.
  for (const sym of SYMBOLS) {
    if (ALL_SYMBOLS.includes(sym)) continue; // handled separately above with real prices
    if (!getCandles(sym).length) {
      const seed = generateSeedCandles(sym, 300);
      setCandles(sym, seed);
    }
  }

  // ── Step 3: Connect to Twelve Data live WebSocket (uses API key if set)
  initTwelveData();

  // ── Step 3c: Seed / load Supabase candles for all 63 symbols.
  // Runs in the background — doesn't block the HTTP server or WebSocket feeds.
  // • Pairs with ≥ 100 candles in DB  → loaded into memory (UI shows real DB history)
  // • Pairs with  < 100 candles in DB → 300 synthetic candles pushed to DB + memory
  // After seeding, start the 60-second flush loop that keeps Supabase up-to-date.
  void seedAllSymbolsToSupabase().then(() => {
    startCandleFlush();
  }).catch((err) => {
    logger.warn({ err }, "Candle seeding failed — flush will still start");
    startCandleFlush();
  });

  // ── Signal auto-resolver: autonomous learning loop ────────────────────────
  // Every 60 s, compares outstanding signal predictions to actual price
  // movement and records WIN/LOSS outcomes — no trade required.
  // This feeds the EMA factor-weight updater so accuracy improves over time.
  startAutoResolver();

  // ── Signal sweeper: generates training data for ALL pairs × ALL timeframes ──
  // Every 60 s, runs analyzeSignal() for every symbol × [1m, 5m, 10m] using
  // cached candle data (no external HTTP calls).  Logs directional signals with
  // entry_price so the auto-resolver can verify outcomes and update per-symbol
  // factor weights — even for pairs the user has never opened in the terminal.
  startSignalSweeper();

  // ── DB retention: keeps Supabase within the 500 MB free tier ─────────────
  // Fires 3 min after startup (sweeper warm-up), then every 60 min.
  // Archives resolved signal counts to signal_stats → prunes raw rows > 12h old.
  // Also prunes quotex_signals_log rows > 3 days old.
  // Logs DB % used; WARN at 70%, ERROR at 85%.
  startSignalCleanup();

  // ── Step 3b: Connect to Quotex WebSocket for exact candle matching.
  // If QUOTEX_EMAIL+PASSWORD or QUOTEX_SESSION are set, connect to market-qx.trade
  // directly — candles and prices will match Quotex exactly.
  // Falls back to Deriv feed automatically when no Quotex credentials are present.
  const quotexEmail   = process.env.QUOTEX_EMAIL    ?? "";
  const quotexPass    = process.env.QUOTEX_PASSWORD ?? "";
  const quotexSession = process.env.QUOTEX_SESSION  ?? "";

  // Always start Deriv for live price ticks → candle building.
  // Deriv provides real-time streaming prices for all forex + crypto OTC pairs,
  // giving us continuous candle data without API credits.
  initDerivFeed();

  // Also start Quotex WS if credentials are available — but ONLY for signals
  // (instruments/list binary → call/put direction + body size for VETO gate + AI).
  // Quotex no longer sets prices; Deriv owns the price feed.
  if (quotexEmail || quotexPass || quotexSession) {
    void initQuotexFeed().catch((err) => {
      logger.warn({ err }, "Quotex signal feed failed to start — signals unavailable but Deriv prices still live");
    });
  } else {
    logger.info(
      "No Quotex credentials set — running Deriv-only mode.\n" +
      "  Quotex direction signals unavailable (VETO gate will be skipped).\n" +
      "  Set QUOTEX_EMAIL + QUOTEX_PASSWORD in .env to enable signal layer.",
    );
  }

  // ── API key status — shown at startup so missing keys are immediately visible
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  logger.info(
    {
      twelveData:   !!process.env.TWELVE_DATA_API_KEY,
      alphaVantage: !!avKey,
      supabase:     !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY,
    },
    avKey
      ? "All API integrations active (Twelve Data + Alpha Vantage + Supabase)"
      : "Alpha Vantage key not set — news sentiment disabled. " +
        "Get a free key at https://www.alphavantage.co/support/#api-key " +
        "and add it as ALPHA_VANTAGE_API_KEY in artifacts/api-server/.env",
  );

  // ── Step 4: Fetch 400 fresh 1-min candles on startup.
  // Priority: TwelveData REST (paid, credit-guarded) → Binance klines (free crypto)
  //           → Yahoo Finance klines (free XAU, weekdays only) → DB/AV → synthetic seed.
  //
  // TwelveData guard: once-per-day flag prevents burning all 800 free credits on
  // repeated restarts. Free fallbacks (Binance/Yahoo) always run if TwelveData is
  // unavailable — they have no credit cost.
  const { tmpdir } = await import("os");
  const todayFlag = `${tmpdir()}/td_fetched_${new Date().toISOString().slice(0, 10)}.flag`;
  let twelveDataBlockedToday = false;
  try {
    const { existsSync, writeFileSync } = await import("fs");
    if (existsSync(todayFlag)) {
      twelveDataBlockedToday = true;
      logger.info("TwelveData historical fetch already done today — skipping to save API credits (free fallbacks will run)");
    } else {
      writeFileSync(todayFlag, new Date().toISOString());
    }
  } catch { /* ignore fs errors — fall through to fetch */ }

  for (let i = 0; i < ALL_SYMBOLS.length; i++) {
    const sym = ALL_SYMBOLS[i];
    const delay = i * 8000; // 8 seconds between each request
    setTimeout(async () => {
      // ── TwelveData REST (once-per-day, costs credits)
      if (!twelveDataBlockedToday) {
        try {
          const { fetchTwelveDataHistory } = await import("./lib/twelvedata-rest.js");
          const candles = await fetchTwelveDataHistory(sym, "1min", 400);
          if (candles.length >= 50) {
            setCandles(sym, candles);
            logger.info({ symbol: sym, count: candles.length }, "Cache upgraded: 400 fresh 1-min candles from Twelve Data REST");
            return;
          }
        } catch (err) {
          logger.warn({ err, symbol: sym }, "Twelve Data REST unavailable — trying free fallback");
        }
      }

      // ── Fallback A: Binance klines (free, no key, 400 real 1-min candles for crypto)
      // Runs on every startup — no credit cost. Provides real BTC/ETH/SOL candle history.
      if (sym !== "XAU/USD") {
        try {
          const candles = await fetchBinanceCandles(sym, 400);
          if (candles.length >= 50) {
            setCandles(sym, candles);
            logger.info({ symbol: sym, count: candles.length }, "Cache upgraded: 400 real 1-min candles from Binance (free fallback)");
            return;
          }
        } catch (err) {
          logger.warn({ err, symbol: sym }, "Binance klines fallback failed");
        }
      }

      // ── Fallback B: Yahoo Finance klines for XAU/USD (weekdays only)
      // Runs on every startup — free. Gold markets close weekends so returns [] then.
      if (sym === "XAU/USD") {
        try {
          const candles = await fetchYahooCandles(400);
          if (candles.length >= 50) {
            setCandles(sym, candles);
            logger.info({ symbol: sym, count: candles.length }, "Cache upgraded: Yahoo Finance XAU klines (free fallback)");
            return;
          } else {
            logger.info({ symbol: sym }, "Yahoo XAU klines empty — market likely closed (weekend), keeping synthetic seed");
          }
        } catch (err) {
          logger.warn({ err, symbol: sym }, "Yahoo XAU klines fallback failed");
        }
      }

      // ── Fallback C: Supabase DB or Alpha Vantage
      try {
        const result = await fetchAndCacheCandles(sym, "1min");
        if (result.source !== "synthetic" && result.candles.length >= 20) {
          setCandles(sym, result.candles);
          logger.info({ symbol: sym, source: result.source, count: result.candles.length }, "Cache upgraded to real historical data (DB/AV fallback)");
        }
      } catch (err) {
        logger.error({ err, symbol: sym }, "All historical candle sources failed — keeping synthetic seed");
      }
    }, delay);
  }

  // ── Step 4b: Fetch 200 × 1-hour candles for signal engine analysis.
  // 1-hour candles have much lower entropy (real trend data) than 1-min candles.
  // Staggered 8s after the 1-min fetches (5 symbols × 8s = 40s), so we start at 45s.
  // Skipped if today's candle data was already fetched (shares the same daily flag).
  for (let i = 0; i < ALL_SYMBOLS.length; i++) {
    const sym = ALL_SYMBOLS[i];
    const delay = (ALL_SYMBOLS.length * 8000) + (i * 8000) + 5000; // after 1-min fetches
    setTimeout(async () => {
      if (twelveDataBlockedToday) return;
      try {
        const { fetchTwelveDataHistory } = await import("./lib/twelvedata-rest.js");
        const hourlyCandles = await fetchTwelveDataHistory(sym, "1h", 200);
        if (hourlyCandles.length >= 30) {
          setHourlyCandles(sym, hourlyCandles);
          logger.info({ symbol: sym, count: hourlyCandles.length }, "Hourly signal cache loaded");
        }
      } catch (err) {
        logger.warn({ err, symbol: sym }, "Hourly candle fetch failed — signals will use 5-min aggregation");
      }
    }, delay);
  }

  // ── Step 5: Refresh free prices every 60 s when TwelveData live feed is absent.
  // Injects real prices into the price + candle caches and broadcasts ticks to all
  // connected WebSocket clients so the chart stays live without a TwelveData key.
  // XAU/USD comes from open.er-api.com; SOL/BTC/ETH from CoinGecko.
  setInterval(async () => {
    try {
      const updated = await fetchFreePrices() as Record<string, number>;
      for (const [sym, price] of Object.entries(updated)) {
        if (price <= 0) continue;
        // Skip symbols with genuinely live feeds (price actively changing).
        // Do NOT skip frozen feeds — TwelveData sends heartbeat ticks for XAU at a
        // constant stale price, making getLiveTicks > 5 while the price never moves.
        if (getLiveTicks(sym) > 5 && !isPriceFrozen(sym)) continue;

        // 1. Update price cache
        setPrice(sym, price);

        // 2. Update latest candle close
        const candles = getCandles(sym);
        if (candles.length > 0) {
          const last = candles[candles.length - 1];
          last.close = price;
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
          setCandles(sym, [...candles]);
        }

        // 3. Broadcast as a tick to all connected WebSocket clients
        const tickMsg = JSON.stringify({ type: "tick", symbol: sym, price, timestamp: Date.now(), latency: 0 });
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(tickMsg);
        });

        logger.debug({ symbol: sym, price }, "Free price tick broadcast to WebSocket clients");
      }
    } catch { /* silent — free feed is best-effort */ }
  }, 60_000);

  // ── Step 6: TwelveData REST price refresh for symbols not streamed by WS.
  // XAU/USD and SOL/USD may not stream on the TwelveData free WebSocket tier,
  // so their prices would otherwise freeze at the initial REST history close price.
  // Poll the lightweight /price endpoint every 45 s to get real intraday rates.
  // Cost: ~2 credits per cycle — well within the free tier daily limit.
  // (Each /price call = 1 credit; 45s interval × 2 symbols = fine.)
  setInterval(async () => {
    const { fetchTwelveDataQuote } = await import("./lib/twelvedata-rest.js");
    for (const sym of ALL_SYMBOLS) {
      if (getLiveTicks(sym) > 5) continue; // live WS already handles this symbol
      try {
        const price = await fetchTwelveDataQuote(sym);
        if (price && price > 0) {
          setPrice(sym, price);
          const candles = getCandles(sym);
          if (candles.length > 0) {
            const last = candles[candles.length - 1];
            last.close = price;
            last.high = Math.max(last.high, price);
            last.low = Math.min(last.low, price);
            setCandles(sym, [...candles]);
          }
          const tickMsg = JSON.stringify({ type: "tick", symbol: sym, price, timestamp: Date.now(), latency: 0 });
          wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(tickMsg); });
          logger.info({ symbol: sym, price }, "Forex price refreshed via TwelveData REST");
        }
      } catch (err) {
        logger.warn({ err, symbol: sym }, "Forex TD REST price refresh failed");
      }
      // Stagger requests 3 s apart to respect TwelveData rate limits
      await new Promise<void>((r) => setTimeout(r, 3000));
    }
  }, 45_000);
})(); });
