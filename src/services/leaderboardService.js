// ============================================
// Leaderboard Service
// ============================================
// Core business logic for the leaderboard system.
//
// ARCHITECTURE DECISIONS:
//
// 1. ATOMIC SCORE SUBMISSION (submitScore):
//    Uses Prisma interactive transaction to atomically:
//    a) Insert game_session row
//    b) Upsert leaderboard total_score
//    Prevents partial updates if either step fails.
//    Uses atomic INCREMENT (not read-then-write) to prevent race conditions.
//
// 2. REDIS SORTED SET FOR RANKING:
//    Redis ZADD/ZREVRANK provide O(log N) ranking.
//    After each score submission, we ZINCRBY the user's
//    score. This avoids querying PostgreSQL for ranks.
//
// 3. TWO-TIER CACHING:
//    - Redis sorted set: real-time ranking backbone
//    - Cached JSON (top10 key): serialized response for
//      GET /top endpoint, refreshed every 10s by worker
//
// 4. CACHE INVALIDATION:
//    On score submit: sorted set updated via ZINCRBY (no invalidation needed).
//    Top-10 JSON refreshed by background worker every 10 seconds.
//    Individual rank lookups cached with 30s TTL and invalidated on submit.
//
// 5. NO FULL TABLE SCAN:
//    With 1M users, ORDER BY total_score DESC is O(N log N).
//    Redis ZREVRANK is O(log N). 1000x faster.

const { getPrismaClient } = require('../config/database');
const { getRedis, CACHE_KEYS, CACHE_TTL } = require('../config/redis');
const { NotFoundError } = require('../utils/errors');
const { logger } = require('../utils/logger');

class LeaderboardService {
  // ──────────────────────────────────────────────
  // SUBMIT SCORE — Target: <150ms
  // ──────────────────────────────────────────────
  async submitScore(userId, score, gameMode = 'classic') {
    const prisma = getPrismaClient();
    const redis = getRedis();

    // Step 1: Atomic DB transaction
    const result = await prisma.$transaction(async (tx) => {
      // Insert game session
      const session = await tx.gameSession.create({
        data: {
          userId,
          score,
          gameMode,
        },
      });

      // Upsert leaderboard: atomic increment
      // PostgreSQL ON CONFLICT DO UPDATE with increment expression
      // is lock-free and handles concurrent writes correctly.
      const leaderboardEntry = await tx.leaderboard.upsert({
        where: { userId },
        create: {
          userId,
          totalScore: score,
          rank: 0,
        },
        update: {
          totalScore: { increment: score },
        },
      });

      return { session, leaderboardEntry };
    }, {
      timeout: 5000,
    });

    // Step 2: Update Redis sorted set
    try {
      await redis.zincrby(CACHE_KEYS.SORTED_SET, score, String(userId));
      // Invalidate this user's cached rank
      await redis.del(`${CACHE_KEYS.PLAYER_RANK_PREFIX}${userId}`);
    } catch (redisErr) {
      // Redis failure is non-fatal: background worker will reconcile
      logger.error('Redis update failed after score submit:', redisErr.message);
    }

    return {
      session_id: result.session.id,
      user_id: userId,
      score,
      total_score: Number(result.leaderboardEntry.totalScore),
    };
  }

  // ──────────────────────────────────────────────
  // GET TOP 10 — Target: <50ms (cache hit ~1-5ms)
  // ──────────────────────────────────────────────
  async getTop10() {
    const redis = getRedis();

    // Try cached JSON first
    try {
      const cached = await redis.get(CACHE_KEYS.TOP_LEADERBOARD);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (redisErr) {
      logger.error('Redis GET failed for top10:', redisErr.message);
    }

    // Cache miss: compute from DB
    return this.refreshTop10();
  }

  // ──────────────────────────────────────────────
  // REFRESH TOP 10 (called by background worker)
  // ──────────────────────────────────────────────
  // Uses LIMIT 10 with index on total_score DESC
  // → PostgreSQL does index-only scan, not full table scan.
  async refreshTop10() {
    const prisma = getPrismaClient();
    const redis = getRedis();

    const top10 = await prisma.leaderboard.findMany({
      take: 10,
      orderBy: { totalScore: 'desc' },
      include: {
        user: {
          select: { username: true },
        },
      },
    });

    const result = top10.map((entry, index) => ({
      rank: index + 1,
      user_id: entry.userId,
      username: entry.user.username,
      total_score: Number(entry.totalScore),
    }));

    try {
      await redis.set(
        CACHE_KEYS.TOP_LEADERBOARD,
        JSON.stringify(result),
        'EX',
        CACHE_TTL.TOP_LEADERBOARD
      );
      await redis.set(CACHE_KEYS.LAST_REFRESH, Date.now().toString());
    } catch (redisErr) {
      logger.error('Redis SET failed for top10 cache:', redisErr.message);
    }

    return result;
  }

  // ──────────────────────────────────────────────
  // GET PLAYER RANK — Uses Redis sorted set O(log N)
  // ──────────────────────────────────────────────
  async getPlayerRank(userId) {
    const prisma = getPrismaClient();
    const redis = getRedis();

    // Try per-player cache
    try {
      const cached = await redis.get(`${CACHE_KEYS.PLAYER_RANK_PREFIX}${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (redisErr) {
      logger.error('Redis GET failed for player rank:', redisErr.message);
    }

    // Get rank from Redis sorted set (ZREVRANK = O(log N))
    let rank = null;
    let totalScore = null;
    try {
      const [zrank, zscore] = await Promise.all([
        redis.zrevrank(CACHE_KEYS.SORTED_SET, String(userId)),
        redis.zscore(CACHE_KEYS.SORTED_SET, String(userId)),
      ]);
      if (zrank !== null) {
        rank = zrank + 1;
        totalScore = parseInt(zscore, 10);
      }
    } catch (redisErr) {
      logger.error('Redis ZREVRANK failed:', redisErr.message);
    }

    // Get username from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!user) {
      throw new NotFoundError(`User ${userId} not found`);
    }

    // Fallback: compute rank from DB if Redis miss
    if (rank === null) {
      const entry = await prisma.leaderboard.findUnique({
        where: { userId },
      });

      if (!entry) {
        return {
          user_id: userId,
          username: user.username,
          total_score: 0,
          rank: null,
          message: 'No scores submitted yet',
        };
      }

      totalScore = Number(entry.totalScore);
      const higherCount = await prisma.leaderboard.count({
        where: { totalScore: { gt: entry.totalScore } },
      });
      rank = higherCount + 1;
    }

    const result = {
      user_id: userId,
      username: user.username,
      total_score: totalScore,
      rank,
    };

    // Cache per-player rank
    try {
      await redis.set(
        `${CACHE_KEYS.PLAYER_RANK_PREFIX}${userId}`,
        JSON.stringify(result),
        'EX',
        CACHE_TTL.PLAYER_RANK
      );
    } catch (redisErr) {
      logger.error('Redis SET failed for player rank cache:', redisErr.message);
    }

    return result;
  }

  // ──────────────────────────────────────────────
  // REBUILD SORTED SET FROM DB
  // ──────────────────────────────────────────────
  // Called on startup or when Redis is flushed.
  // Loads all leaderboard scores into Redis sorted set
  // using batching + pipelining.
  async rebuildSortedSet() {
    const prisma = getPrismaClient();
    const redis = getRedis();

    logger.info('Rebuilding Redis sorted set from database...');
    const startTime = Date.now();

    const BATCH_SIZE = 10000;
    let cursor = 0;
    let totalLoaded = 0;

    while (true) {
      const batch = await prisma.leaderboard.findMany({
        skip: cursor,
        take: BATCH_SIZE,
        select: { userId: true, totalScore: true },
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) break;

      // Pipeline ZADD commands for efficiency (1 round trip per batch)
      const pipeline = redis.pipeline();
      for (const entry of batch) {
        pipeline.zadd(
          CACHE_KEYS.SORTED_SET,
          Number(entry.totalScore),
          String(entry.userId)
        );
      }
      await pipeline.exec();

      totalLoaded += batch.length;
      cursor += BATCH_SIZE;

      if (totalLoaded % 100000 === 0) {
        logger.info(`Loaded ${totalLoaded} entries into sorted set...`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`Sorted set rebuilt: ${totalLoaded} entries in ${elapsed}s`);
  }
}

module.exports = new LeaderboardService();
