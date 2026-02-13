// ============================================
// High-Performance Database Seed Script
// ============================================
// Populates:
//   - 1,000,000 users
//   - 5,000,000 game sessions
//   - Leaderboard entries (aggregated from sessions)
//
// Uses raw SQL with multi-value INSERT for maximum throughput.
// Prisma's createMany is too slow for 1M+ rows.
// Expected time: ~5-10 minutes depending on hardware.

require('dotenv').config();

const { Client } = require('pg');
const { logger } = require('../utils/logger');

const TOTAL_USERS = parseInt(process.env.SEED_USERS_COUNT) || 1000000;
const TOTAL_SESSIONS = parseInt(process.env.SEED_SESSIONS_COUNT) || 5000000;
const BATCH_SIZE = parseInt(process.env.SEED_BATCH_SIZE) || 10000;

const GAME_MODES = ['classic', 'ranked', 'casual', 'tournament'];

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  logger.info('Connected to PostgreSQL');

  const totalStart = Date.now();

  try {
    // Disable constraints temporarily for faster bulk insert
    logger.info('Preparing database...');
    await client.query('SET session_replication_role = replica;');

    // Drop indexes temporarily
    await client.query(`
      DROP INDEX IF EXISTS game_sessions_user_id_score_idx;
      DROP INDEX IF EXISTS game_sessions_timestamp_idx;
      DROP INDEX IF EXISTS game_sessions_game_mode_idx;
      DROP INDEX IF EXISTS leaderboard_total_score_idx;
      DROP INDEX IF EXISTS leaderboard_rank_idx;
    `);

    // ── Step 1: Insert users ────────────────────────
    logger.info(`Inserting ${TOTAL_USERS.toLocaleString()} users...`);
    let usersInserted = 0;
    const userStart = Date.now();

    for (let batch = 0; batch < TOTAL_USERS; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, TOTAL_USERS);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (let i = batch; i < batchEnd; i++) {
        values.push(`($${paramIdx++}, $${paramIdx++})`);
        params.push(
          `player_${String(i + 1).padStart(7, '0')}`,
          randomDate(new Date(2023, 0, 1), new Date(2025, 11, 31))
        );
      }

      await client.query(
        `INSERT INTO users (username, join_date) VALUES ${values.join(',')} ON CONFLICT (username) DO NOTHING`,
        params
      );

      usersInserted += (batchEnd - batch);
      if (usersInserted % 100000 === 0) {
        const elapsed = ((Date.now() - userStart) / 1000).toFixed(1);
        logger.info(`  Users: ${usersInserted.toLocaleString()} / ${TOTAL_USERS.toLocaleString()} (${elapsed}s)`);
      }
    }

    const userElapsed = ((Date.now() - userStart) / 1000).toFixed(1);
    logger.info(`✓ ${usersInserted.toLocaleString()} users inserted in ${userElapsed}s`);

    // ── Step 2: Insert game sessions ────────────────
    logger.info(`Inserting ${TOTAL_SESSIONS.toLocaleString()} game sessions...`);
    let sessionsInserted = 0;
    const sessionStart = Date.now();

    for (let batch = 0; batch < TOTAL_SESSIONS; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, TOTAL_SESSIONS);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (let i = batch; i < batchEnd; i++) {
        const userId = Math.floor(Math.random() * TOTAL_USERS) + 1;
        const score = weightedRandomScore();
        const gameMode = GAME_MODES[Math.floor(Math.random() * GAME_MODES.length)];
        const timestamp = randomDate(new Date(2024, 0, 1), new Date());

        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(userId, score, gameMode, timestamp);
      }

      await client.query(
        `INSERT INTO game_sessions (user_id, score, game_mode, timestamp) VALUES ${values.join(',')}`,
        params
      );

      sessionsInserted += (batchEnd - batch);
      if (sessionsInserted % 500000 === 0) {
        const elapsed = ((Date.now() - sessionStart) / 1000).toFixed(1);
        const rate = Math.round(sessionsInserted / (elapsed || 1));
        logger.info(`  Sessions: ${sessionsInserted.toLocaleString()} / ${TOTAL_SESSIONS.toLocaleString()} (${elapsed}s, ${rate.toLocaleString()}/s)`);
      }
    }

    const sessionElapsed = ((Date.now() - sessionStart) / 1000).toFixed(1);
    logger.info(`✓ ${sessionsInserted.toLocaleString()} game sessions inserted in ${sessionElapsed}s`);

    // ── Step 3: Generate leaderboard ────────────────
    logger.info('Generating leaderboard from game sessions...');
    const lbStart = Date.now();

    await client.query(`
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

    const lbElapsed = ((Date.now() - lbStart) / 1000).toFixed(1);
    logger.info(`✓ Leaderboard generated in ${lbElapsed}s`);

    // ── Step 4: Rebuild indexes ─────────────────────
    logger.info('Rebuilding indexes...');
    const idxStart = Date.now();

    await client.query(`
      CREATE INDEX IF NOT EXISTS game_sessions_user_id_score_idx
        ON game_sessions (user_id, score DESC);
      CREATE INDEX IF NOT EXISTS game_sessions_timestamp_idx
        ON game_sessions (timestamp DESC);
      CREATE INDEX IF NOT EXISTS game_sessions_game_mode_idx
        ON game_sessions (game_mode);
      CREATE INDEX IF NOT EXISTS leaderboard_total_score_idx
        ON leaderboard (total_score DESC);
      CREATE INDEX IF NOT EXISTS leaderboard_rank_idx
        ON leaderboard (rank);
    `);

    const idxElapsed = ((Date.now() - idxStart) / 1000).toFixed(1);
    logger.info(`✓ Indexes rebuilt in ${idxElapsed}s`);

    // Re-enable constraints
    await client.query('SET session_replication_role = DEFAULT;');

    // ANALYZE for query planner
    logger.info('Running ANALYZE on tables...');
    await client.query('ANALYZE users;');
    await client.query('ANALYZE game_sessions;');
    await client.query('ANALYZE leaderboard;');
    logger.info('✓ ANALYZE complete');

    // Print summary
    const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
    const [userCount] = (await client.query('SELECT COUNT(*) FROM users')).rows;
    const [sessionCount] = (await client.query('SELECT COUNT(*) FROM game_sessions')).rows;
    const [lbCount] = (await client.query('SELECT COUNT(*) FROM leaderboard')).rows;
    const [top1] = (await client.query('SELECT u.username, l.total_score, l.rank FROM leaderboard l JOIN users u ON u.id = l.user_id ORDER BY l.total_score DESC LIMIT 1')).rows;

    logger.info('═══════════════════════════════════════');
    logger.info('SEED COMPLETE');
    logger.info('═══════════════════════════════════════');
    logger.info(`Total time:      ${totalElapsed}s`);
    logger.info(`Users:           ${parseInt(userCount.count).toLocaleString()}`);
    logger.info(`Game sessions:   ${parseInt(sessionCount.count).toLocaleString()}`);
    logger.info(`Leaderboard:     ${parseInt(lbCount.count).toLocaleString()}`);
    if (top1) {
      logger.info(`Top player:      ${top1.username} (score: ${parseInt(top1.total_score).toLocaleString()}, rank: ${top1.rank})`);
    }
    logger.info('═══════════════════════════════════════');

  } catch (err) {
    logger.error('Seed failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function weightedRandomScore() {
  const r = Math.random();
  if (r < 0.6) return Math.floor(Math.random() * 500) + 10;
  if (r < 0.85) return Math.floor(Math.random() * 1500) + 500;
  if (r < 0.95) return Math.floor(Math.random() * 3000) + 2000;
  return Math.floor(Math.random() * 5000) + 5000;
}

seed()
  .then(() => {
    logger.info('Seed script finished successfully');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Seed script failed:', err);
    process.exit(1);
  });
