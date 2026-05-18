import express, { type Express } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the first proxy (Cloudflare tunnel / Nginx) so rate-limiter reads
// the real client IP from X-Forwarded-For instead of throwing a config error.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── CORS — only allow the configured frontend origin ──────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin: allowedOrigin, credentials: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Signal endpoint: 20 req/min per IP — allows 4-pair batch test rounds plus UI.
// Sentiment + factor-weight calls inside the signal handler are cached (5 min / 10 min),
// so AV free-tier exhaustion is not a concern at this rate.
// Signal endpoint: 500 req/min per IP.
// The UI polls signals for all 63 pairs across 1m/5m/10m tabs — needs high burst headroom.
const signalLimiter = rateLimit({
  windowMs: 60_000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signal requests — please wait a moment." },
});

// General API: 1000 req/min per IP.
// Covers historical candles (63 pairs × 3 intervals), quotes, trades, symbols — all in one page load.
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded." },
});

app.use("/api/market/signal", signalLimiter);
app.use("/api", generalLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
