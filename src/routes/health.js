// ============================================
// Health Check Route
// ============================================

const { Router } = require('express');
const { getPrismaClient } = require('../config/database');
const { getRedis } = require('../config/redis');

const router = Router();

router.get('/', async (req, res) => {
  const checks = { db: false, redis: false };

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (_) {}

  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = true;
  } catch (_) {}

  const healthy = checks.db && checks.redis;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    checks,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
