// ============================================
// Express Application Setup
// ============================================
// Security hardened, compression enabled, structured logging

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const { rateLimiter } = require('./middleware/rateLimiter');
const leaderboardRoutes = require('./routes/leaderboard');
const healthRoutes = require('./routes/health');

const app = express();

// ── Security ──────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// ── Performance ───────────────────────────────────────
app.use(compression());

// ── Parsing ───────────────────────────────────────────
app.use(express.json({ limit: '1kb' }));

// ── Logging ───────────────────────────────────────────
app.use(requestLogger);

// ── Rate Limiting ─────────────────────────────────────
app.use('/api/', rateLimiter);

// ── Routes ────────────────────────────────────────────
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/health', healthRoutes);

// ── Error Handler ─────────────────────────────────────
app.use(errorHandler);

module.exports = app;
