// ============================================
// Prisma Client Singleton
// ============================================
// WHY singleton: Prevents connection pool exhaustion
// under high concurrency. Each Prisma instance holds
// a connection pool; multiple instances waste connections.

const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

let prisma;

function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
        ...(process.env.NODE_ENV === 'development'
          ? [{ level: 'query', emit: 'event' }]
          : []),
      ],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    prisma.$on('warn', (e) => {
      logger.warn('Prisma warning:', e.message);
    });

    prisma.$on('error', (e) => {
      logger.error('Prisma error:', e.message);
    });

    if (process.env.NODE_ENV === 'development') {
      prisma.$on('query', (e) => {
        if (e.duration > 100) {
          logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
  }
  return prisma;
}

module.exports = { getPrismaClient };
