// ============================================
// Server Entry Point
// ============================================
// New Relic MUST be required first for instrumentation
if (process.env.NEW_RELIC_ENABLED === 'true') {
  require('newrelic');
}

require('dotenv').config();

const app = require('./app');
const { logger } = require('./utils/logger');
const { connectRedis } = require('./config/redis');
const { startLeaderboardRefreshScheduler } = require('./workers/scheduler');
const leaderboardService = require('./services/leaderboardService');

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    // 1. Connect Redis
    await connectRedis();
    logger.info('Redis connected');

    // 2. Rebuild Redis sorted set from DB (ensures Redis is in sync)
    try {
      await leaderboardService.rebuildSortedSet();
    } catch (err) {
      logger.warn('Sorted set rebuild skipped:', err.message);
    }

    // 3. Start background leaderboard refresh (every 10s)
    startLeaderboardRefreshScheduler();
    logger.info('Leaderboard refresh scheduler started (10s interval)');

    // 3. Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
      logger.info(`API: http://localhost:${PORT}/api/leaderboard`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();
