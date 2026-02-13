// ============================================
// BullMQ Leaderboard Worker
// ============================================
// Handles heavy background tasks:
// 1. Full rank recalculation for all 1M users
// 2. Redis sorted set rebuild
//
// Runs as a SEPARATE PROCESS for isolation.

require('dotenv').config();

const { Worker, Queue } = require('bullmq');
const { logger } = require('../utils/logger');
const { getPrismaClient } = require('../config/database');
const { connectRedis, getRedis, CACHE_KEYS } = require('../config/redis');

const QUEUE_NAME = 'leaderboard-jobs';

const bullConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

const leaderboardQueue = new Queue(QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

async function startWorker() {
  await connectRedis();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const startTime = Date.now();
      logger.info(`Processing job: ${job.name} (${job.id})`);

      switch (job.name) {
        case 'recalculate-ranks':
          await recalculateAllRanks(job);
          break;
        case 'rebuild-sorted-set':
          await rebuildSortedSet(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }

      const elapsed = Date.now() - startTime;
      logger.info(`Job ${job.name} completed in ${elapsed}ms`);
    },
    {
      connection: bullConnection,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 30000,
      },
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.name} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    logger.info(`Job ${job.name} completed successfully`);
  });

  logger.info('BullMQ worker started');
  return worker;
}

// Uses window function ROW_NUMBER() for efficient ranking.
// Single UPDATE...FROM subquery, much faster than N individual updates.
async function recalculateAllRanks(job) {
  const prisma = getPrismaClient();

  logger.info('Starting full rank recalculation...');

  await prisma.$executeRaw`
    UPDATE leaderboard l
    SET rank = ranked.new_rank,
        updated_at = NOW()
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY total_score DESC) as new_rank
      FROM leaderboard
    ) ranked
    WHERE l.id = ranked.id
      AND l.rank != ranked.new_rank
  `;

  await job.updateProgress(100);
  logger.info('Full rank recalculation complete');
}

async function rebuildSortedSet(job) {
  const leaderboardService = require('../services/leaderboardService');
  await leaderboardService.rebuildSortedSet();
  await job.updateProgress(100);
}

async function scheduleRecurringJobs() {
  await leaderboardQueue.add(
    'recalculate-ranks',
    {},
    {
      repeat: {
        every: 300000, // 5 minutes
      },
      jobId: 'recurring-rank-recalc',
    }
  );

  logger.info('Recurring jobs scheduled');
}

module.exports = {
  leaderboardQueue,
  startWorker,
  scheduleRecurringJobs,
};

// Run as standalone process
if (require.main === module) {
  startWorker()
    .then(() => scheduleRecurringJobs())
    .catch((err) => {
      logger.error('Worker failed to start:', err);
      process.exit(1);
    });
}
