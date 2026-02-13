// ============================================
// Redis Client Configuration
// ============================================
// WHY Redis: In-memory store with O(1) GET/SET and
// O(log N) sorted set operations. Critical for:
// 1. Caching top-10 leaderboard (avoid DB hits)
// 2. Sorted sets for real-time ranking
// 3. Cache invalidation on score submit

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redis = null;

const CACHE_KEYS = {
  TOP_LEADERBOARD: 'leaderboard:top10',
  SORTED_SET: 'leaderboard:scores',
  PLAYER_RANK_PREFIX: 'leaderboard:rank:',
  LAST_REFRESH: 'leaderboard:last_refresh',
  LOCK_REFRESH: 'leaderboard:lock:refresh',
};

const CACHE_TTL = {
  TOP_LEADERBOARD: parseInt(process.env.LEADERBOARD_CACHE_TTL_SECONDS) || 15,
  PLAYER_RANK: 30,
  LOCK_REFRESH: 12,
};

function createRedisClient() {
  const client = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.warn(`Redis retry attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    enableOfflineQueue: true,
    connectTimeout: 10000,
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('Redis: connected'));
  client.on('error', (err) => logger.error('Redis error:', err.message));
  client.on('close', () => logger.warn('Redis: connection closed'));

  return client;
}

async function connectRedis() {
  redis = createRedisClient();
  await redis.connect();
  return redis;
}

function getRedis() {
  if (!redis) {
    throw new Error('Redis not initialized. Call connectRedis() first.');
  }
  return redis;
}

async function disconnectRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

module.exports = {
  connectRedis,
  getRedis,
  disconnectRedis,
  CACHE_KEYS,
  CACHE_TTL,
};
