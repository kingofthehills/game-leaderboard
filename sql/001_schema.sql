-- ============================================
-- Gaming Leaderboard - Raw SQL Schema
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50) NOT NULL UNIQUE,
    join_date   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score       INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    game_mode   VARCHAR(30) NOT NULL DEFAULT 'classic',
    timestamp   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaderboard (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    total_score BIGINT NOT NULL DEFAULT 0 CHECK (total_score >= 0),
    rank        INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_gs_user_score ON game_sessions (user_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_gs_timestamp ON game_sessions (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gs_game_mode ON game_sessions (game_mode);
CREATE INDEX IF NOT EXISTS idx_lb_total_score ON leaderboard (total_score DESC);
CREATE INDEX IF NOT EXISTS idx_lb_rank ON leaderboard (rank);
