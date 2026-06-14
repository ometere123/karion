import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { csrfProtection } from "./middleware/csrf.js";
import authRouter from "./routes/auth.js";
import walletRouter from "./routes/wallet.js";
import suggestionsRouter from "./routes/suggestions.js";
import marketsRouter from "./routes/markets.js";
import portfolioRouter from "./routes/portfolio.js";
import transactionsRouter from "./routes/transactions.js";
import adminSuggestionsRouter from "./routes/admin/suggestions.js";
import adminMarketsRouter from "./routes/admin/markets.js";
import activityRouter from "./routes/activity.js";
import adminActivityRouter from "./routes/admin/activity.js";
import resolutionCentreRouter from "./routes/resolution-centre.js";
import { startMarketSyncWorker } from "./workers/market-sync.js";

// ── Startup environment validation ────────────────────────────────────────────
// Fail fast before accepting any traffic if required env vars are absent.
// SECURITY: secrets are validated here but never logged.
const REQUIRED_ENV = [
  "DATABASE_URL",
  "SESSION_SIGNING_SECRET",
  "SYSTEM_RECOVERY_SECRET",
  "GENLAYER_CONTRACT_ADDRESS",
  "GENLAYER_DEPLOYER_PRIVATE_KEY",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const GENERATE_HINT = 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

if (!HEX_64.test(process.env.SESSION_SIGNING_SECRET!)) {
  console.error(
    "FATAL: SESSION_SIGNING_SECRET must be exactly 64 hex characters (32 bytes).\n" + GENERATE_HINT,
  );
  process.exit(1);
}

if (!HEX_64.test(process.env.SYSTEM_RECOVERY_SECRET!)) {
  console.error(
    "FATAL: SYSTEM_RECOVERY_SECRET must be exactly 64 hex characters (32 bytes).\n" + GENERATE_HINT,
  );
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.API_PORT || "4000", 10);

app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "karion-api",
    timestamp: new Date().toISOString(),
    network: "StudioNet",
    chainId: process.env.GENLAYER_CHAIN_ID || "61999",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS,
    syncWorker: process.env.ENABLE_MARKET_SYNC === "true" ? "enabled" : "disabled",
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/api/wallet", walletRouter);

// User routes
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/markets", marketsRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/transactions", transactionsRouter);

// Admin routes
app.use("/api/admin/suggestions", adminSuggestionsRouter);
app.use("/api/admin/markets", adminMarketsRouter);
app.use("/api/admin/activity", adminActivityRouter);

// Activity feed (history only — contract reads remain authoritative)
app.use("/api/activity", activityRouter);

// Resolution centre — markets grouped by resolution state (auth required in v1)
app.use("/api/resolution-centre", resolutionCentreRouter);

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Karion API running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Contract: ${process.env.GENLAYER_CONTRACT_ADDRESS}`);
  // Start sync worker only when explicitly enabled
  startMarketSyncWorker();
});

export default app;
