// ============================================
// Request Logger Middleware
// ============================================

const { logger } = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    const logData = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      responseTime: `${elapsed.toFixed(2)}ms`,
    };

    if (res.statusCode >= 400) {
      logger.warn('Request completed', logData);
    } else {
      logger.info('Request completed', logData);
    }

    if (process.env.NEW_RELIC_ENABLED === 'true') {
      try {
        const newrelic = require('newrelic');
        newrelic.recordMetric(`Custom/ResponseTime${req.originalUrl}`, elapsed);
      } catch (_) {}
    }
  });

  next();
}

module.exports = { requestLogger };
