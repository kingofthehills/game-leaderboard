// ============================================
// Rate Limiter Middleware
// ============================================
// 100 requests/min per IP

const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many requests. Please try again later.',
    },
  },
  skip: () => process.env.NODE_ENV === 'test',
});

module.exports = { rateLimiter };
