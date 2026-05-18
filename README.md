<div align="center">

# QUOTX · Binary Prediction Terminal

**Institutional-grade binary options intelligence platform**  
Real-time multi-feed price engine · AI signal generation · 63 trading pairs

[![Deploy Status](https://img.shields.io/badge/frontend-vercel-black?logo=vercel)](https://vercel.com)
[![Railway](https://img.shields.io/badge/backend-railway-purple?logo=railway)](https://railway.app)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-proprietary-red)](LICENSE)

</div>

---

## Overview

QUOTX is a high-performance binary prediction terminal built for professional traders. It aggregates live price feeds from multiple institutional sources, applies a multi-layer signal engine, and presents actionable UP/DOWN/NEUTRAL predictions with confidence scoring — all in a sub-second reactive UI.

```
┌─────────────────────────────────────────────────────────┐
│  PRICE FEEDS          SIGNAL ENGINE        TERMINAL UI  │
│                                                         │
│  Deriv WebSocket  ──► RSI + MACD       ──► TradingView │
│  Binance klines   ──► Entropy gating   ──► Ghost candle │
│  Yahoo Finance    ──► Momentum scoring ──► Live chart   │
│  Free public APIs ──► VETO layer       ──► 63 pairs    │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture

```
quotx-trading-bot/
├── artifacts/
│   ├── api-server/          # Node.js + Express + WebSocket backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── signals.ts          # Multi-indicator signal engine
│   │       │   ├── candlePersister.ts  # Supabase candle persistence
│   │       │   ├── derivFeed.ts        # Deriv WebSocket price feed
│   │       │   ├── freePriceFeed.ts    # Binance / Yahoo fallbacks
│   │       │   ├── seedCandles.ts      # Realistic OHLC seed generator
│   │       │   ├── learningEngine.ts   # Win-rate adaptive scoring
│   │       │   └── quotexFeed.ts       # Quotex direction signal layer
│   │       └── routes/
│   │           ├── market.ts           # /api/market/* endpoints
│   │           └── trades.ts           # /api/trades/* endpoints
│   └── trading-terminal/    # React + Vite + lightweight-charts frontend
│       └── src/
│           ├── components/
│           │   ├── TradingChart.tsx    # Candlestick chart + ghost candle
│           │   ├── ReasoningSidebar.tsx# AI signal reasoning panel
│           │   ├── IndicatorsPanel.tsx # RSI / MACD / momentum display
│           │   └── TradePanel.tsx      # Trade execution interface
│           ├── hooks/
│           │   └── useWebSocket.ts     # Live price WebSocket hook
│           └── pages/
│               └── Terminal.tsx        # Main trading terminal page
├── lib/
│   ├── api-client-react/    # Auto-generated React Query client
│   ├── api-spec/            # OpenAPI 3.0 specification
│   ├── api-zod/             # Zod validation schemas
│   └── db/                  # Drizzle ORM schema (trade history)
├── Dockerfile               # Railway production image
└── pnpm-workspace.yaml      # Monorepo workspace + catalog
```

---

## Signal Engine

The signal pipeline runs on every price tick:

| Stage | Logic |
|-------|-------|
| **RSI (14)** | Overbought > 70 bearish, oversold < 30 bullish |
| **MACD** | Signal line crossover with histogram confirmation |
| **Momentum** | Price velocity over 5 / 10 / 20 candle windows |
| **Entropy gate** | Shannon entropy on last 30 candles — blocks signals during high-noise regimes |
| **VETO layer** | Quotex market direction cross-check (when credentials set) |
| **Confidence** | Weighted composite of all indicator strengths (0–100%) |
| **Ghost candle** | Predicted next candle rendered on chart, fades by confidence |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 7, TypeScript, Tailwind CSS v4 |
| **Charts** | TradingView lightweight-charts v5 |
| **Animation** | Framer Motion |
| **State** | TanStack Query v5 |
| **Backend** | Node.js 20, Express 5, WebSocket (ws) |
| **Logger** | Pino (structured JSON) |
| **Bundler** | esbuild (single-file ESM output) |
| **Database** | Supabase (Postgres) via REST + Drizzle ORM |
| **Price feeds** | Deriv WS · Binance klines · Yahoo Finance · CoinGecko |
| **Infra** | Vercel (frontend) + Railway (backend) |

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

```bash
npm install -g pnpm@9
```

### 1. Clone & install

```bash
git clone https://github.com/HASHIRKHA/quotx-trading-bot.git
cd quotx-trading-bot
pnpm install
```

### 2. Configure environment

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit .env — add your API keys (see table below)
```

### 3. Start development

```bash
# Terminal 1 — API server (port 3001)
cd artifacts/api-server && pnpm run dev

# Terminal 2 — Frontend (port 5173)
cd artifacts/trading-terminal && pnpm run dev
```

Open `http://localhost:5173`

---

## Environment Variables

### API Server (`artifacts/api-server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Server port (Railway sets automatically) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `ALLOWED_ORIGIN` | Yes | Frontend URL for CORS (your Vercel URL) |
| `TWELVE_DATA_API_KEY` | Recommended | Real-time WebSocket data (800 free credits/day) |
| `ALPHA_VANTAGE_API_KEY` | Optional | News sentiment analysis (25 free calls/day) |
| `QUOTEX_EMAIL` | Optional | Quotex direction signals (omit for Deriv-only mode) |
| `QUOTEX_PASSWORD` | Optional | Quotex credentials |
| `DATABASE_URL` | Optional | PostgreSQL connection string for trade history |

### Frontend (Vercel environment variables)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Railway backend URL (e.g. `https://quotx.railway.app`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_HEARTBEAT_STALE_MS` | Price staleness threshold in ms (default: `3000`) |

---

## Deployment

### Backend → Railway

1. New Project → **Deploy from GitHub** → select this repo
2. Railway auto-detects the `Dockerfile` at the root
3. Add all env vars from the table above in the **Variables** tab
4. Deploy — copy your Railway URL

### Frontend → Vercel

1. New Project → Import from GitHub → select this repo
2. **Root Directory**: `artifacts/trading-terminal`
3. Framework: **Other** (vercel.json handles everything)
4. Add `VITE_API_URL` pointing to your Railway URL
5. Deploy

### After both are live

Update `ALLOWED_ORIGIN` in Railway to your Vercel URL and redeploy the backend.

---

## Trading Pairs

63 instruments across 4 asset classes:

| Class | Pairs |
|-------|-------|
| Crypto | BTC/USD · ETH/USD · SOL/USD |
| Commodity | XAU/USD (Gold) |
| Forex | EUR/USD · GBP/USD · USD/JPY · GBP/JPY · AUD/JPY · EUR/JPY · NZD/JPY · GBP/NZD · CAD/CHF · EUR/GBP · AUD/CAD · EUR/CHF |
| OTC | All 12 forex pairs + EUR/USD · GBP/USD · USD/JPY · GBP/JPY OTC + USD/EGP · USD/IDR · USD/DZD |

---

## API Reference

```
GET  /api/health                    Server health + circuit breaker status
GET  /api/market/symbols            List all 63 trading pairs
GET  /api/market/quote/:symbol      Current price snapshot
GET  /api/market/historical/:symbol OHLC candle history
GET  /api/market/signal/:symbol     AI signal + confidence + indicators
GET  /api/trades                    Trade history (paginated)
POST /api/trades                    Record a trade
PUT  /api/trades/:id/resolve        Resolve trade outcome

WS   /ws                            Live price tick stream
```

---

## License

Proprietary — All rights reserved. Unauthorized copying, distribution, or modification is prohibited.

© 2025 QUOTX. Built for professional trading environments.
