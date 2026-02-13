// ============================================
// Seed Script - Fast Mode (dev/testing)
// ============================================
// 10K users, 50K sessions (~10 seconds)

require('dotenv').config();

process.env.SEED_USERS_COUNT = '10000';
process.env.SEED_SESSIONS_COUNT = '50000';
process.env.SEED_BATCH_SIZE = '5000';

require('./seed');
