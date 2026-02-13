-- ============================================
-- Seed 5M Game Sessions
-- ============================================

SET session_replication_role = replica;
DROP INDEX IF EXISTS idx_gs_user_score;
DROP INDEX IF EXISTS idx_gs_timestamp;
DROP INDEX IF EXISTS idx_gs_game_mode;

INSERT INTO game_sessions (user_id, score, game_mode, timestamp)
SELECT
    (floor(random() * 1000000) + 1)::int,
    CASE
        WHEN random() < 0.60 THEN (floor(random() * 500) + 10)::int
        WHEN random() < 0.85 THEN (floor(random() * 1500) + 500)::int
        WHEN random() < 0.95 THEN (floor(random() * 3000) + 2000)::int
        ELSE (floor(random() * 5000) + 5000)::int
    END,
    (ARRAY['classic', 'ranked', 'casual', 'tournament'])[floor(random() * 4 + 1)::int],
    TIMESTAMP '2024-01-01' + (random() * (NOW() - TIMESTAMP '2024-01-01'))
FROM generate_series(1, 5000000) AS g;

SET session_replication_role = DEFAULT;

CREATE INDEX IF NOT EXISTS idx_gs_user_score ON game_sessions (user_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_gs_timestamp ON game_sessions (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gs_game_mode ON game_sessions (game_mode);

ANALYZE game_sessions;
SELECT COUNT(*) AS total_sessions FROM game_sessions;
