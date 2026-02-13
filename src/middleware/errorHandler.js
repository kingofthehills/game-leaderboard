// ============================================
// Global Error Handler Middleware
// ============================================

const { logger } = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  if (statusCode >= 500) {
    logger.error(`[${req.method}] ${req.originalUrl} - ${err.message}`, {
      stack: err.stack,
      statusCode,
    });
  } else {
    logger.warn(`[${req.method}] ${req.originalUrl} - ${err.message}`, {
      statusCode,
    });
  }

  if (process.env.NEW_RELIC_ENABLED === 'true') {
    try {
      const newrelic = require('newrelic');
      newrelic.noticeError(err, { path: req.originalUrl, method: req.method });
    } catch (_) {}
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message: isOperational ? err.message : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = { errorHandler };
