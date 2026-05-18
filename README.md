<div align="center">

<br/>

```
 ██████╗ ██╗   ██╗ ██████╗ ████████╗██╗  ██╗
██╔═══██╗██║   ██║██╔═══██╗╚══██╔══╝╚██╗██╔╝
██║   ██║██║   ██║██║   ██║   ██║    ╚███╔╝ 
██║▄▄ ██║██║   ██║██║   ██║   ██║    ██╔██╗ 
╚██████╔╝╚██████╔╝╚██████╔╝   ██║   ██╔╝ ██╗
 ╚══▀▀═╝  ╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝
```

### **Institutional Binary Prediction Terminal**
*Quantum Signal Engine · Self-Learning AI · 63 Live Instruments*

<br/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)

[![Deploy Status](https://img.shields.io/badge/Frontend-Vercel-000000?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Railway](https://img.shields.io/badge/Backend-Railway-7B2FBE?style=for-the-badge&logo=railway)](https://railway.app)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.0.0-gold?style=for-the-badge)](CHANGELOG.md)

<br/>

> *"The only terminal that gets smarter every time you trade."*

<br/>

</div>

---

## What is QUOTX?

QUOTX is a high-performance binary prediction terminal engineered for professional traders who demand precision over guesswork. It is not a bot. It is not a simple signal tool. It is a **living, adaptive intelligence platform** that:

- Aggregates live price data from **4 institutional-grade feeds** simultaneously
- Processes every tick through an **8-factor Quantum Signal Engine** inspired by SVM RBF classifiers and LSTM temporal fingerprinting
- Learns from every resolved trade via a **Supabase-driven adaptive weight system** — the longer it runs, the more accurate it becomes
- Renders predictions as a **ghost candle** directly on the TradingView chart, fading by confidence level
- Guards against noise with a **Shannon entropy gate** that silences predictions during high-randomness regimes
- Covers **63 instruments** across Crypto, Forex, Commodities, and OTC markets

---

## System Architecture

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                          QUOTX PLATFORM ARCHITECTURE                           ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                                                                                  ║
║   PRICE FEEDS                 SIGNAL ENGINE               INTELLIGENCE LAYER    ║
║   ─────────────               ─────────────               ─────────────────     ║
║   Deriv WebSocket   ──┐       ┌──────────────────┐        ┌──────────────────┐  ║
║   Binance klines    ──┼──────►│  8-Factor Scorer  │───────►│  Learning Engine │  ║
║   Yahoo Finance     ──┤       │  Entropy Gate     │        │  Weight Cache    │  ║
║   TwelveData WS     ──┘       │  Quotex VETO      │        │  Regime Detect   │  ║
║                               │  Momentum Gate    │        └────────┬─────────┘  ║
║   CANDLE PIPELINE             └────────┬──────────┘                 │            ║
║   ─────────────                        │                            ▼            ║
║   Seed 63 symbols  ──────────────────► │          SUPABASE POSTGRES              ║
║   60s flush loop                       │          ───────────────────            ║
║   ATR-based OHLC                       │          candles           ◄────────┐   ║
║   Supabase persist ◄───────────────────┘          signals           ◄────────┤   ║
║                                                   trades            ◄────────┤   ║
║   TERMINAL UI                                     factor_weights    ◄────────┤   ║
║   ─────────────                                   market_patterns   ◄────────┤   ║
║   TradingView chart ◄──── WebSocket tick          quotex_signals_log◄────────┘   ║
║   Ghost candle                         │                            │            ║
║   Indicators panel                     └────────────────────────────┘            ║
║   Signal reasoning                        DB trigger on trade resolve            ║
║   Trade execution                         auto-updates factor_weights            ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

---

## Quantum Signal Engine — Deep Dive

The signal pipeline is the core of QUOTX. Every 500ms, on every live tick, 8 independent factors are evaluated and combined into a directional prediction with a confidence score.

### The 8 Factors

| # | Factor | Weight | Logic | Fires When |
|---|--------|--------|-------|-----------|
| 1 | **RSI Extreme** | 20 | RSI-14 overbought/oversold | RSI < 30 (UP) or > 70 (DOWN) |
| 2 | **MACD Cross** | 20 | Signal line crossover with histogram | Histogram confirms crossover direction |
| 3 | **Bollinger Breach** | 18 | Price relative to BB bands | Price touches lower (UP) or upper (DOWN) band |
| 4 | **Volume Confirmation** | 12 | Current volume vs 14-bar average | Volume ratio ≥ 1.3× (confirms conviction) |
| 5 | **S/R Bounce** | 15 | Support/Resistance zone detection | Price within 25% of 14-bar high/low pivot |
| 6 | **Momentum** | 20 | Price velocity over 5/10/20 windows | Consistent directional acceleration |
| 7 | **EMA Trend** | 20 | 9 EMA vs 21 EMA alignment | 9 EMA crosses above/below 21 EMA |
| 8 | **Stochastic %K** | 15 | 14-period Stochastic oscillator | %K < 30 (UP) or > 70 (DOWN) |

> **Optional 9th Factor**: When `QUOTEX_EMAIL` is configured, the live Quotex platform call/put signal is injected as a factor with weight 25, providing direct platform-side directional intelligence.

### Signal Rules

A valid signal requires:

1. **Minimum 2 confirmed factors** in the dominant direction
2. **Dominant direction has more confirmed factors** than opposing direction (or greater total weight if tied)
3. **High purity**: dominant factor weight must exceed opposing factor weight
4. **Momentum gate**: for ≤120s intervals, MACD Cross and Momentum cannot both contradict the dominant direction
5. **Quotex VETO**: if Quotex platform signal contradicts technical direction, the signal is rejected
6. **Entropy gate**: passes unless market is in a high-randomness regime (see below)
7. **Confidence ≥ 50%**: weak tie-break signals below neutral baseline are suppressed

### Confidence Scoring

Confidence is computed using an **SVM-inspired RBF kernel** across bull vs bear factor scores:

```
kernelConf = |bullScore - bearScore| / (bullScore + bearScore)
rawConf    = 50 + (kernelConf × 50) × (dominantFactors / totalFactors)
```

After entropy soft-block adjustment, confidence is clamped to `[50, 99]` to prevent false certainty.

---

## Shannon Entropy Gate

Markets are not always tradeable. QUOTX measures the Shannon entropy of recent price changes to detect randomness regimes where predictions are unreliable.

```
H(X) = -Σ p(x) × log₂(p(x))    over normalized 30-candle price changes
```

| Entropy Level | Mode | Effect |
|---------------|------|--------|
| `H ≥ 0.9995` | **HARD BLOCK** | Signal suppressed entirely. Safe Mode active. Ghost candle hidden. |
| `H ∈ [0.985, 0.9995)` | **SOFT BLOCK** | Signal allowed but confidence reduced 30%. Ghost candle dimmed to 40% opacity. |
| `H < 0.985` | **Normal** | Full signal confidence. Ghost candle at full opacity. |

**Why this matters**: 1-minute candles in normal intraday conditions produce entropy of `0.985–0.999`. Setting the hard block at `0.9995` means QUOTX only silences trading during near-perfectly-random markets — genuine noise events — while remaining active during all normal sessions.

An additional **volatility gate** (4% threshold) blocks signals during spike events that exceed historical ATR context.

---

## Self-Learning AI System

This is where QUOTX separates itself from every other terminal. The signal engine does not use static indicator weights. It **learns from every trade outcome** and continuously updates its factor weights in real-time.

### How Learning Works

```
┌─────────────────────────────────────────────────────────────┐
│                    LEARNING FEEDBACK LOOP                   │
│                                                             │
│  1. Signal fires → logged to Supabase `signals` table       │
│     (all 8 factor values, confidence, direction, regime)    │
│                                                             │
│  2. Trade placed → linked to signal via                     │
│     linkLastSignalToTrade() — 1:1 signal↔trade mapping      │
│                                                             │
│  3. Trade resolves (WIN/LOSS) →                             │
│     recordSignalOutcome() called                            │
│     → Supabase trigger `trg_learn_from_trade` fires         │
│     → factor_weights table updated with outcome             │
│     → market_patterns table updated with regime data        │
│     → weight cache invalidated (TTL 10 min)                 │
│                                                             │
│  4. Next signal request →                                   │
│     getFactorWeights() fetches fresh weights                │
│     → analyzeSignal() applies learned multipliers           │
│     → factors that historically WIN get amplified           │
│     → factors that historically LOSE get dampened           │
└─────────────────────────────────────────────────────────────┘
```

### Adaptive Factor Weights

The `factor_weights` table in Supabase stores a **per-factor accuracy multiplier** that is updated after every resolved trade. If RSI Extreme consistently predicts correctly during trending markets, its weight multiplier increases. If Volume Confirmation underperforms during ranging markets, its multiplier decreases.

```sql
-- Supabase trigger fires automatically on every trade resolve
CREATE TRIGGER trg_learn_from_trade
  AFTER UPDATE OF resolved ON trades
  FOR EACH ROW
  WHEN (NEW.resolved = TRUE)
  EXECUTE FUNCTION fn_learn_from_trade();
```

The system also detects **market regime** (volatile / trending / ranging) on every signal and stores performance metrics per regime in `market_patterns`. Over time, QUOTX learns which factors are reliable in each regime type.

### Weight Cache Architecture

Factor weights are cached in memory for **10 minutes** to eliminate per-request database latency while staying fresh enough to reflect recent learning. On cache miss, weights are fetched asynchronously and the previous cache serves the signal — zero blocking.

```
Signal Request
      │
      ▼
weightCache valid? ──YES──► apply cached weights ──► signal
      │
      NO
      │
      ▼
fetch Supabase (async, 8s timeout)
      │
      ▼
update cache + timestamp ──► apply weights ──► signal
```

### Regime Detection

```typescript
detectRegime(candles) → "volatile" | "trending" | "ranging"
```

- **Volatile**: ATR > 1.5× 20-period average ATR → different factor weights apply
- **Trending**: EMA separation > threshold → momentum and trend factors amplified
- **Ranging**: Low ATR, oscillating price → oscillators (RSI, Stochastic) prioritized

---

## Ghost Candle Prediction

The ghost candle is a predicted next candle rendered directly on the TradingView lightweight-charts instance. It updates every **500ms** for fluid, live prediction feedback.

```
Ghost candle rendering:
  Open  = last confirmed close
  Close = open ± (ATR × direction_multiplier × confidence_factor)
  High  = max(open, close) + (ATR × 0.3)
  Low   = min(open, close) − (ATR × 0.3)

  Opacity = max(0.55, confidence) × (dimmed ? 0.4 : 1.0)
           where dimmed = entropy in soft-block zone
```

The ghost candle is colored green (UP prediction) or red (DOWN prediction) and fades in opacity as confidence approaches the minimum threshold, giving an immediate visual read on signal quality.

---

## Supabase Database Schema

All persistence flows through Supabase Postgres via direct REST API calls — no SDK dependency, maximum compatibility.

### Tables

```sql
-- Live and historical OHLC data for all 63 pairs
CREATE TABLE candles (
  id          bigserial PRIMARY KEY,
  symbol      text NOT NULL,
  time        bigint NOT NULL,     -- Unix timestamp (seconds)
  open        float8 NOT NULL,
  high        float8 NOT NULL,
  low         float8 NOT NULL,
  close       float8 NOT NULL,
  volume      float8 NOT NULL DEFAULT 0,
  UNIQUE (symbol, time)
);

-- Every signal the engine fires (linked to trades)
CREATE TABLE signals (
  id            bigserial PRIMARY KEY,
  symbol        text NOT NULL,
  direction     text NOT NULL,     -- UP | DOWN | NEUTRAL
  confidence    float8 NOT NULL,
  factor_values jsonb,             -- snapshot of all 8 factor scores
  regime        text,              -- volatile | trending | ranging
  entropy       float8,
  created_at    timestamptz DEFAULT now()
);

-- Trade history with outcome tracking
CREATE TABLE trades (
  id          bigserial PRIMARY KEY,
  symbol      text NOT NULL,
  direction   text NOT NULL,
  amount      float8,
  entry_price float8,
  outcome     text,               -- WIN | LOSS | null
  resolved    boolean DEFAULT false,
  signal_id   bigint REFERENCES signals(id),
  created_at  timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- Adaptive factor weights (updated by trigger on trade resolve)
CREATE TABLE factor_weights (
  factor_name text PRIMARY KEY,
  weight      float8 NOT NULL DEFAULT 1.0,
  win_count   int DEFAULT 0,
  loss_count  int DEFAULT 0,
  updated_at  timestamptz DEFAULT now()
);

-- Regime-specific performance patterns
CREATE TABLE market_patterns (
  id         bigserial PRIMARY KEY,
  regime     text NOT NULL,
  pattern    jsonb,               -- factor fingerprint of the candle sequence
  outcome    text,                -- WIN | LOSS
  created_at timestamptz DEFAULT now()
);

-- Quotex platform signal snapshots for cross-reference training
CREATE TABLE quotex_signals_log (
  id         bigserial PRIMARY KEY,
  symbol     text NOT NULL,
  direction  text NOT NULL,       -- call | put
  body_size  float8,
  created_at timestamptz DEFAULT now()
);
```

### Candle Persistence Engine

The server seeds all 63 symbols with realistic OHLC history on startup and runs a **60-second flush loop** that upserts in-memory candles to Supabase. The seeder uses ATR-based price simulation to generate coherent OHLC candles with proper wick/body structure, anchored to the last known close price.

**Sanity check**: If internal price drift exceeds 10% of the starting price (internalSwing > 1.10), the buffer is re-seeded with the last confirmed close as anchor — preventing unrealistic price divergence in long-running sessions.

---

## Price Feed Architecture

QUOTX aggregates from 4 live sources with automatic failover:

```
Priority Chain (per symbol):
  1. TwelveData WebSocket (800 free credits/day)  ← preferred
  2. Deriv WebSocket (real-time tick data)
  3. Binance klines API (crypto pairs)
  4. Yahoo Finance REST (forex/commodities)
  5. In-memory synthetic (always available fallback)
```

The **circuit breaker** pattern (`/api/health`) reports feed health per-source. Stale data triggers automatic failover — the frontend shows a staleness badge if prices exceed the `VITE_HEARTBEAT_STALE_MS` threshold (default: 3000ms).

---

## Trading Pairs — 63 Instruments

<table>
<tr><th>Class</th><th>Pairs</th><th>Count</th></tr>
<tr>
<td><b>Crypto</b></td>
<td>BTC/USD · ETH/USD · SOL/USD</td>
<td>3</td>
</tr>
<tr>
<td><b>Commodity</b></td>
<td>XAU/USD (Gold)</td>
<td>1</td>
</tr>
<tr>
<td><b>Forex</b></td>
<td>EUR/USD · GBP/USD · USD/JPY · GBP/JPY · AUD/JPY · EUR/JPY · NZD/JPY · GBP/NZD · CAD/CHF · EUR/GBP · AUD/CAD · EUR/CHF</td>
<td>12</td>
</tr>
<tr>
<td><b>OTC Markets</b></td>
<td>EUR/USD OTC · GBP/USD OTC · USD/JPY OTC · GBP/JPY OTC · AUD/JPY OTC · EUR/JPY OTC · NZD/JPY OTC · GBP/NZD OTC · CAD/CHF OTC · EUR/GBP OTC · AUD/CAD OTC · EUR/CHF OTC · USD/EGP OTC · USD/IDR OTC · USD/DZD OTC · + 32 additional OTC derivatives</td>
<td>47</td>
</tr>
</table>

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Frontend framework** | React | 19.1 | Component UI |
| **Build tool** | Vite | 7.3 | Dev server + production build |
| **Language** | TypeScript | 5.x | Full-stack type safety |
| **Styling** | Tailwind CSS | 4.2 | Utility-first dark theme |
| **Charts** | lightweight-charts | 5.1 | TradingView-grade candlestick rendering |
| **Animation** | Framer Motion | 12.x | Ghost candle transitions, panel reveals |
| **State / data** | TanStack Query | 5.x | Server state, background refetching |
| **Routing** | Wouter | 3.x | Lightweight SPA routing |
| **Backend** | Node.js + Express | 20 + 5.x | REST API + WebSocket server |
| **Logger** | Pino | latest | Structured JSON logging |
| **Bundler** | esbuild | latest | Single-file ESM bundle for Railway |
| **Database** | Supabase (Postgres) | latest | Candles, signals, trades, weights |
| **ORM** | Drizzle ORM | 0.45 | Type-safe schema definition |
| **Validation** | Zod | 3.25 | End-to-end schema validation |
| **Package manager** | pnpm | 9.x | Monorepo workspace |
| **Frontend infra** | Vercel | — | Global CDN, edge network |
| **Backend infra** | Railway | — | Containerized Node.js runtime |

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health + circuit breaker status per feed |
| `GET` | `/api/market/symbols` | All 63 trading pairs with metadata |
| `GET` | `/api/market/quote/:symbol` | Current price snapshot with spread |
| `GET` | `/api/market/historical/:symbol` | Full OHLC candle history (up to 500 candles) |
| `GET` | `/api/market/signal/:symbol` | **AI signal**: direction, confidence, factors, ghost candle, indicators |
| `GET` | `/api/trades` | Trade history (paginated, most recent first) |
| `POST` | `/api/trades` | Record a new trade entry |
| `PUT` | `/api/trades/:id/resolve` | Resolve trade with WIN/LOSS outcome → triggers learning |

### WebSocket Protocol

```
WS /ws

Server → Client messages:
  { type: "tick",   symbol: string, price: number, time: number }
  { type: "candle", symbol: string, ohlc: OHLC }
  { type: "signal", symbol: string, result: SignalResult }

Client → Server messages:
  { type: "subscribe",   symbol: string }
  { type: "unsubscribe", symbol: string }
```

---

## Repository Structure

```
quotx-trading-bot/
│
├── artifacts/
│   ├── api-server/                    # Node.js + Express backend
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── signals.ts         # Quantum Signal Engine v3 (8 factors)
│   │   │   │   ├── learningEngine.ts  # Adaptive weight system + Supabase I/O
│   │   │   │   ├── candlePersister.ts # 60s Supabase flush + sanity gate
│   │   │   │   ├── derivFeed.ts       # Deriv WebSocket feed
│   │   │   │   ├── freePriceFeed.ts   # Binance / Yahoo / fallback feeds
│   │   │   │   ├── seedCandles.ts     # ATR-based realistic OHLC seeder
│   │   │   │   ├── quotexFeed.ts      # Quotex direction signal layer
│   │   │   │   └── logger.ts          # Pino structured logger
│   │   │   ├── routes/
│   │   │   │   ├── market.ts          # /api/market/* endpoints
│   │   │   │   └── trades.ts          # /api/trades/* endpoints
│   │   │   └── index.ts               # Express app + WebSocket server
│   │   ├── build.mjs                  # esbuild single-file bundler
│   │   ├── .env.example               # Environment variable template
│   │   └── package.json
│   │
│   └── trading-terminal/              # React + Vite frontend
│       ├── src/
│       │   ├── components/
│       │   │   ├── TradingChart.tsx   # Candlestick chart + ghost candle + entry line
│       │   │   ├── ReasoningSidebar.tsx # AI signal reasoning + factor breakdown
│       │   │   ├── IndicatorsPanel.tsx  # RSI / MACD / BB / Stochastic display
│       │   │   └── TradePanel.tsx       # Trade entry + history
│       │   ├── hooks/
│       │   │   └── useWebSocket.ts    # Live WebSocket price hook (auto-reconnect)
│       │   ├── pages/
│       │   │   └── Terminal.tsx       # Main trading terminal layout
│       │   └── App.tsx                # Root + API base URL configuration
│       ├── vercel.json                # Vercel deployment config (SPA rewrite + headers)
│       └── package.json
│
├── lib/
│   ├── api-client-react/              # Auto-generated TanStack Query hooks
│   ├── api-spec/                      # OpenAPI 3.0 specification
│   ├── api-zod/                       # Zod request/response schemas
│   └── db/                            # Drizzle ORM schema (trade history)
│
├── Dockerfile                         # Railway production image (multi-stage Alpine)
├── pnpm-workspace.yaml                # Monorepo workspace + version catalog
├── package.json                       # Root package (packageManager: pnpm@9)
└── .gitignore                         # Comprehensive ignore rules
```

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+

```bash
npm install -g pnpm@9
```

### 1 · Clone & install

```bash
git clone https://github.com/HASHIRKHA/quotx-trading-bot.git
cd quotx-trading-bot
pnpm install
```

### 2 · Configure environment

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Open .env and add your API keys
```

### 3 · Start development

```bash
# Terminal 1 — API server (port 3001)
cd artifacts/api-server && pnpm run dev

# Terminal 2 — Frontend (port 5173)
cd artifacts/trading-terminal && pnpm run dev
```

Open **http://localhost:5173** — the terminal connects automatically.

---

## Deployment

### Backend → Railway

Railway auto-detects the `Dockerfile` at the root and builds a containerized Node.js image.

1. **New Project** → Deploy from GitHub → select this repo
2. Railway detects `Dockerfile` automatically
3. Add environment variables in the **Variables** tab:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Set automatically by Railway |
| `SUPABASE_URL` | Yes | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `ALLOWED_ORIGIN` | Yes | Your Vercel frontend URL |
| `TWELVE_DATA_API_KEY` | Recommended | Real-time WebSocket data (800 free credits/day) |
| `ALPHA_VANTAGE_API_KEY` | Optional | News sentiment (25 free calls/day) |
| `QUOTEX_EMAIL` | Optional | Quotex VETO factor (omit for Deriv-only mode) |
| `QUOTEX_PASSWORD` | Optional | Quotex credentials |
| `DATABASE_URL` | Optional | PostgreSQL connection string for trade history |

4. **Deploy** → copy your Railway URL (e.g. `https://quotx.up.railway.app`)

### Frontend → Vercel

The `vercel.json` at `artifacts/trading-terminal/vercel.json` handles all build configuration.

1. **New Project** → Import from GitHub → select this repo
2. Set **Root Directory** to `artifacts/trading-terminal`
3. **Framework**: Other (vercel.json takes over)
4. Add environment variables:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Your Railway backend URL |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_HEARTBEAT_STALE_MS` | Price staleness threshold in ms (default: `3000`) |

5. **Deploy** → copy your Vercel URL

### Post-deployment

Update `ALLOWED_ORIGIN` in Railway to your Vercel URL and redeploy the backend. This enables CORS for the production frontend.

---

## Environment Variables Reference

### `artifacts/api-server/.env.example`

```env
# ── Server ───────────────────────────────────────────────────────────────────
PORT=3001

# ── Supabase ─────────────────────────────────────────────────────────────────
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-supabase-anon-key>

# ── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGIN=http://localhost:5173

# ── Price Feeds (optional — free tiers available) ────────────────────────────
TWELVE_DATA_API_KEY=<twelve-data-key>
ALPHA_VANTAGE_API_KEY=<alpha-vantage-key>

# ── Quotex Integration (optional) ────────────────────────────────────────────
QUOTEX_EMAIL=<your-quotex-email>
QUOTEX_PASSWORD=<your-quotex-password>

# ── Database (optional — for trade history persistence) ──────────────────────
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres
```

---

## Security

QUOTX is built with security-first principles throughout the stack:

| Layer | Measure |
|-------|---------|
| **Transport** | HTTPS enforced on Vercel + Railway. WSS for WebSocket in production. |
| **Headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy: strict-origin-when-cross-origin` |
| **Assets** | Immutable cache headers (`Cache-Control: public, max-age=31536000, immutable`) |
| **CORS** | Restricted to `ALLOWED_ORIGIN` in production |
| **Secrets** | `.env` permanently in `.gitignore`. No secrets committed. All credentials via environment variables. |
| **DB** | Supabase Row Level Security (RLS) enabled. Anon key has read-only access to public tables. |

---

## Signal Engine Performance

The signal engine is designed for **5-minute binary options** as its primary target, with configurable interval support from 60s to 300s+.

| Metric | Value |
|--------|-------|
| Signal latency | < 5ms per tick (in-memory compute) |
| WebSocket tick rate | Real-time (Deriv) / 1-min klines (Binance) |
| Ghost candle refresh | 500ms interval |
| Factor weight refresh | 10-minute cache (Supabase sync) |
| Candle flush interval | 60 seconds to Supabase |
| Entropy hard block | ≥ 0.9995 (near-random market detected) |
| Entropy soft block | ≥ 0.985 (elevated noise — confidence reduced 30%) |
| Minimum factors required | 2 confirmed in dominant direction |
| Minimum confidence to fire | 50% (above neutral baseline) |
| Factor override threshold | 7/8 factors unanimous — bypasses entropy gate |

---

## Development Scripts

```bash
# Root workspace
pnpm run dev:api        # Start API server in dev mode
pnpm run dev:ui         # Start frontend dev server

# API server (artifacts/api-server)
pnpm run dev            # tsx watch mode with hot reload
pnpm run build          # esbuild → dist/index.mjs
pnpm run typecheck      # tsc --noEmit

# Frontend (artifacts/trading-terminal)
pnpm run dev            # Vite dev server (port 5173)
pnpm run build          # Vite production build → dist/public
pnpm run serve          # Preview production build
pnpm run typecheck      # tsc --noEmit
```

---

## Roadmap

- [ ] **Pattern Recognition**: LSTM-style candle sequence fingerprinting stored in `market_patterns`
- [ ] **Multi-timeframe confluence**: 1m + 5m + 15m signal agreement gate
- [ ] **Automated trade execution**: Direct Quotex API integration for hands-free trading
- [ ] **Portfolio mode**: Simultaneous signal tracking across all 63 pairs
- [ ] **Mobile PWA**: Full-featured progressive web app for mobile trading
- [ ] **Alert system**: Push notifications for high-confidence signals (≥ 80%)
- [ ] **Backtesting engine**: Replay historical candle data through the signal engine

---

## License

**Proprietary** — All rights reserved.

Unauthorized copying, distribution, modification, or use of this software, in whole or in part, is strictly prohibited without express written permission.

© 2025 QUOTX. Built for professional trading environments.

---

<div align="center">

*Engineered for precision. Built for professionals. Designed to learn.*

**QUOTX** — *The terminal that gets smarter with every trade.*

</div>
