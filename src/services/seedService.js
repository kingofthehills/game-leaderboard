// ============================================
// Seed Service
// ============================================
// Seeds the database with users, game sessions,
// and leaderboard entries. Uses Prisma for simplicity
// with batched createMany for decent performance.
//
// Default: 100 users, 500 sessions (~2 seconds)
// Can be called via POST /api/leaderboard/seed

const { getPrismaClient } = require('../config/database');
const { getRedis, CACHE_KEYS } = require('../config/redis');
const { logger } = require('../utils/logger');

const GAME_MODES = ['classic', 'ranked', 'casual', 'tournament'];

function weightedRandomScore() {
  const r = Math.random();
  if (r < 0.6) return Math.floor(Math.random() * 500) + 10;
  if (r < 0.85) return Math.floor(Math.random() * 1500) + 500;
  if (r < 0.95) return Math.floor(Math.random() * 3000) + 2000;
  return Math.floor(Math.random() * 5000) + 5000;
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function seedDatabase({ userCount = 100, sessionsPerUser = 5, clearExisting = false } = {}) {
  const prisma = getPrismaClient();
  const redis = getRedis();
  const startTime = Date.now();

  logger.info(`Seeding: ${userCount} users, ~${userCount * sessionsPerUser} sessions, clearExisting=${clearExisting}`);

  try {
    // Optionally clear existing data
    if (clearExisting) {
      logger.info('Clearing existing data...');
      await prisma.leaderboard.deleteMany();
      await prisma.gameSession.deleteMany();
      await prisma.user.deleteMany();
      await redis.del(CACHE_KEYS.SORTED_SET);
      await redis.del(CACHE_KEYS.TOP_LEADERBOARD);
      logger.info('Existing data cleared');
    }

    // ── Step 1: Create users ──────────────────────────
    logger.info(`Creating ${userCount} users...`);
    const existingCount = await prisma.user.count();
    const startIdx = existingCount + 1;

    const userBatchSize = 500;
    for (let i = 0; i < userCount; i += userBatchSize) {
      const batch = [];
      const end = Math.min(i + userBatchSize, userCount);
      for (let j = i; j < end; j++) {
        batch.push({
          username: `player_${String(startIdx + j).padStart(7, '0')}`,
          joinDate: randomDate(new Date(2023, 0, 1), new Date(2025, 11, 31)),
        });
      }
      await prisma.user.createMany({ data: batch, skipDuplicates: true });
    }
    logger.info(`✓ Users created`);

    // Get all user IDs
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'desc' },
      take: userCount,
    });
    const userIds = users.map((u) => u.id);

    // ── Step 2: Create game sessions ──────────────────
    const totalSessions = userCount * sessionsPerUser;
    logger.info(`Creating ${totalSessions} game sessions...`);

    const sessionBatchSize = 1000;
    for (let i = 0; i < totalSessions; i += sessionBatchSize) {
      const batch = [];
      const end = Math.min(i + sessionBatchSize, totalSessions);
      for (let j = i; j < end; j++) {
        const userId = userIds[Math.floor(Math.random() * userIds.length)];
        batch.push({
          userId,
          score: weightedRandomScore(),
          gameMode: GAME_MODES[Math.floor(Math.random() * GAME_MODES.length)],
          timestamp: randomDate(new Date(2024, 0, 1), new Date()),
        });
      }
      await prisma.gameSession.createMany({ data: batch });
    }
    logger.info(`✓ Game sessions created`);

    // ── Step 3: Generate leaderboard entries ──────────
    logger.info('Generating leaderboard from game sessions...');

    // Aggregate scores per user using raw SQL for efficiency
    await prisma.$executeRawUnsafe(`
      INSERT INTO leaderboard (user_id, total_score, rank, updated_at)
      SELECT
        user_id,
        SUM(score) as total_score,
        ROW_NUMBER() OVER (ORDER BY SUM(score) DESC) as rank,
        NOW()
      FROM game_sessions
      GROUP BY user_id
      ON CONFLICT (user_id) DO UPDATE SET
        total_score = EXCLUDED.total_score,
        rank = EXCLUDED.rank,
        updated_at = NOW()
    `);
    logger.info('✓ Leaderboard generated');

    // ── Step 4: Sync Redis sorted set ─────────────────
    logger.info('Syncing Redis sorted set...');
    const leaderboardEntries = await prisma.leaderboard.findMany({
      select: { userId: true, totalScore: true },
    });

    if (leaderboardEntries.length > 0) {
      const pipeline = redis.pipeline();
      for (const entry of leaderboardEntries) {
        pipeline.zadd(CACHE_KEYS.SORTED_SET, Number(entry.totalScore), String(entry.userId));
      }
      await pipeline.exec();
    }
    logger.info('✓ Redis sorted set synced');

    // ── Step 5: Refresh the top-10 cache ──────────────
    const leaderboardService = require('./leaderboardService');
    await leaderboardService.refreshTop10();
    logger.info('✓ Top-10 cache refreshed');

    // Summary
    const finalUsers = await prisma.user.count();
    const finalSessions = await prisma.gameSession.count();
    const finalLb = await prisma.leaderboard.count();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const top3 = await prisma.leaderboard.findMany({
      take: 3,
      orderBy: { totalScore: 'desc' },
      include: { user: { select: { username: true } } },
    });

    const summary = {
      elapsed_seconds: parseFloat(elapsed),
      users: finalUsers,
      game_sessions: finalSessions,
      leaderboard_entries: finalLb,
      top_3: top3.map((e, i) => ({
        rank: i + 1,
        username: e.user.username,
        total_score: Number(e.totalScore),
      })),
    };

    logger.info('═══ SEED COMPLETE ═══');
    logger.info(`Time: ${elapsed}s | Users: ${finalUsers} | Sessions: ${finalSessions} | Leaderboard: ${finalLb}`);

    return summary;
  } catch (err) {
    logger.error('Seed failed:', err);
    throw err;
  }
}

module.exports = { seedDatabase };
