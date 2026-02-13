// ============================================
// Leaderboard Refresh Scheduler
// ============================================
// Runs every 10 seconds to refresh the top-10 cache.
//
// WHY setInterval over node-cron: For sub-minute intervals,
// setInterval is simpler with less overhead.
//
// WHY distributed lock: In multi-instance deployment,
// Redis SETNX lock ensures only ONE instance refreshes,
// preventing redundant DB queries.
//
// EFFICIENCY: The refresh query uses total_score DESC index,
// reading only 10 rows. ~2-5ms even with 1M entries.

const { getRedis, CACHE_KEYS, CACHE_TTL } = require('../config/redis');
const leaderboardService = require('../services/leaderboardService');
const { logger } = require('../utils/logger');

let intervalHandle = null;

async function refreshLeaderboard() {
  const redis = getRedis();

  // Distributed lock: prevents multiple instances from refreshing
  const lockAcquired = await redis.set(
    CACHE_KEYS.LOCK_REFRESH,
    process.pid.toString(),
    'EX',
    CACHE_TTL.LOCK_REFRESH,
    'NX'
  );

  if (!lockAcquired) {
    return; // Another instance is refreshing
  }

  const startTime = Date.now();

  try {
    await leaderboardService.refreshTop10();
    const elapsed = Date.now() - startTime;
    logger.debug(`Leaderboard refreshed in ${elapsed}ms`);

    if (process.env.NEW_RELIC_ENABLED === 'true') {
      try {
        const newrelic = require('newrelic');
        newrelic.recordMetric('Custom/LeaderboardRefreshTime', elapsed);
      } catch (_) {}
    }
  } catch (err) {
    logger.error('Leaderboard refresh failed:', err.message);
  } finally {
    try {
      await redis.del(CACHE_KEYS.LOCK_REFRESH);
    } catch (_) {}
  }
}

function startLeaderboardRefreshScheduler() {
  const interval = parseInt(process.env.LEADERBOARD_REFRESH_INTERVAL_MS) || 10000;

  // Initial refresh on startup
  refreshLeaderboard().catch((err) => {
    logger.error('Initial leaderboard refresh failed:', err.message);
  });

  // Schedule periodic refresh
  intervalHandle = setInterval(async () => {
    try {
      await refreshLeaderboard();
    } catch (err) {
      logger.error('Scheduled leaderboard refresh error:', err.message);
    }
  }, interval);

  logger.info(`Leaderboard refresh scheduled every ${interval}ms`);
}

function stopLeaderboardRefreshScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Leaderboard refresh scheduler stopped');
  }
}

module.exports = {
  startLeaderboardRefreshScheduler,
  stopLeaderboardRefreshScheduler,
  refreshLeaderboard,
};
