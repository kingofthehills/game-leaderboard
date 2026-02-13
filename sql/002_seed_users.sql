-- ============================================
-- Seed 1M Users (PostgreSQL generate_series)
-- ============================================

INSERT INTO users (username, join_date)
SELECT
    'player_' || LPAD(g::text, 7, '0'),
    TIMESTAMP '2023-01-01' + (random() * (NOW() - TIMESTAMP '2023-01-01'))
FROM generate_series(1, 1000000) AS g
ON CONFLICT (username) DO NOTHING;

ANALYZE users;
SELECT COUNT(*) AS total_users FROM users;
