// ============================================
// Integration Tests - Leaderboard API
// ============================================

const request = require('supertest');
const app = require('../app');
const { getPrismaClient } = require('../config/database');
const { connectRedis, disconnectRedis, getRedis, CACHE_KEYS } = require('../config/redis');

let prisma;

beforeAll(async () => {
  await connectRedis();
  prisma = getPrismaClient();

  // Clean test data
  await prisma.leaderboard.deleteMany({});
  await prisma.gameSession.deleteMany({});
  await prisma.user.deleteMany({});

  // Flush Redis test keys
  const redis = getRedis();
  const keys = await redis.keys('leaderboard:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Seed test users
  await prisma.user.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      username: `testplayer_${i + 1}`,
    })),
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await prisma.leaderboard.deleteMany({});
  await prisma.gameSession.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await disconnectRedis();
});

describe('POST /api/leaderboard/submit', () => {
  test('should submit a score successfully', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 1, score: 100 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBe(1);
    expect(res.body.data.score).toBe(100);
    expect(res.body.data.total_score).toBe(100);
    expect(res.body.data.session_id).toBeDefined();
  });

  test('should accumulate scores for same user', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 1, score: 200 });

    expect(res.status).toBe(201);
    expect(res.body.data.total_score).toBe(300);
  });

  test('should reject negative score', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 1, score: -50 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('should reject missing user_id', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ score: 100 });

    expect(res.status).toBe(400);
  });

  test('should reject missing score', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 1 });

    expect(res.status).toBe(400);
  });

  test('should reject non-numeric user_id', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 'abc', score: 100 });

    expect(res.status).toBe(400);
  });

  test('should accept valid game_mode', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 2, score: 150, game_mode: 'ranked' });

    expect(res.status).toBe(201);
  });

  test('should reject invalid game_mode', async () => {
    const res = await request(app)
      .post('/api/leaderboard/submit')
      .send({ user_id: 2, score: 150, game_mode: 'invalid_mode' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/leaderboard/top', () => {
  beforeAll(async () => {
    const scores = [
      { user_id: 3, score: 5000 },
      { user_id: 4, score: 4500 },
      { user_id: 5, score: 4000 },
      { user_id: 6, score: 3500 },
      { user_id: 7, score: 3000 },
      { user_id: 8, score: 2500 },
      { user_id: 9, score: 2000 },
      { user_id: 10, score: 1500 },
      { user_id: 11, score: 1000 },
      { user_id: 12, score: 500 },
      { user_id: 13, score: 250 },
    ];

    for (const s of scores) {
      await request(app)
        .post('/api/leaderboard/submit')
        .send(s);
    }

    const leaderboardService = require('../services/leaderboardService');
    await leaderboardService.refreshTop10();
  });

  test('should return top 10 players', async () => {
    const res = await request(app).get('/api/leaderboard/top');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(10);
  });

  test('should return players in descending score order', async () => {
    const res = await request(app).get('/api/leaderboard/top');

    const scores = res.body.data.map((p) => p.total_score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  test('should include username and rank', async () => {
    const res = await request(app).get('/api/leaderboard/top');

    const first = res.body.data[0];
    expect(first).toHaveProperty('rank');
    expect(first).toHaveProperty('username');
    expect(first).toHaveProperty('total_score');
    expect(first).toHaveProperty('user_id');
  });

  test('should respond fast (<100ms)', async () => {
    const start = Date.now();
    await request(app).get('/api/leaderboard/top');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

describe('GET /api/leaderboard/rank/:user_id', () => {
  test('should return rank for existing user', async () => {
    const res = await request(app).get('/api/leaderboard/rank/3');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBe(3);
    expect(res.body.data.username).toBe('testplayer_3');
    expect(res.body.data.total_score).toBeGreaterThan(0);
    expect(res.body.data.rank).toBeGreaterThan(0);
  });

  test('should return 404 for non-existent user', async () => {
    const res = await request(app).get('/api/leaderboard/rank/999999');

    expect(res.status).toBe(404);
  });

  test('should return consistent rank', async () => {
    const res1 = await request(app).get('/api/leaderboard/rank/3');
    const res2 = await request(app).get('/api/leaderboard/rank/3');

    expect(res1.body.data.rank).toBe(res2.body.data.rank);
  });
});

describe('Health Check', () => {
  test('should return health status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.checks.db).toBe(true);
    expect(res.body.checks.redis).toBe(true);
  });
});

describe('Concurrency', () => {
  test('should handle concurrent score submissions', async () => {
    const promises = Array.from({ length: 10 }, () =>
      request(app)
        .post('/api/leaderboard/submit')
        .send({ user_id: 15, score: 100 })
    );

    const results = await Promise.all(promises);

    results.forEach((res) => {
      expect(res.status).toBe(201);
    });

    // Final total should be exactly 1000
    const final = await request(app).get('/api/leaderboard/rank/15');
    expect(final.body.data.total_score).toBe(1000);
  });
});
