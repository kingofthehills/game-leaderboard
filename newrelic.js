// ============================================
// New Relic Configuration
// ============================================
// Must be required FIRST before any other module
// Tracks: API latency, DB slow queries, throughput, errors

'use strict';

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'gaming-leaderboard'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || 'YOUR_KEY',
  agent_enabled: process.env.NEW_RELIC_ENABLED === 'true',
  logging: {
    level: 'info',
    filepath: 'stdout',
  },
  distributed_tracing: {
    enabled: true,
  },
  transaction_tracer: {
    enabled: true,
    transaction_threshold: 'apdex_f',
    explain_threshold: 200,
    record_sql: 'obfuscated',
    slow_sql: {
      enabled: true,
      max_samples: 20,
    },
  },
  error_collector: {
    enabled: true,
    ignore_status_codes: [404],
  },
  custom_insights_events: {
    enabled: true,
    max_samples_stored: 10000,
  },
  application_logging: {
    forwarding: {
      enabled: true,
      max_samples_stored: 10000,
    },
    metrics: {
      enabled: true,
    },
    local_decorating: {
      enabled: false,
    },
  },
  rules: {
    name: [
      { pattern: '/api/leaderboard/top', name: '/api/leaderboard/top' },
      { pattern: '/api/leaderboard/submit', name: '/api/leaderboard/submit' },
      { pattern: '/api/leaderboard/rank/*', name: '/api/leaderboard/rank/:user_id' },
    ],
  },
};
