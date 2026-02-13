// ============================================
// Winston Logger
// ============================================

const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? format.json()
      : format.combine(format.colorize(), format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${timestamp} [${level}]: ${message}${extra}`;
        }))
  ),
  defaultMeta: { service: 'gaming-leaderboard' },
  transports: [
    new transports.Console(),
  ],
  exitOnError: false,
});

module.exports = { logger };
