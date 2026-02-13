-- Quick seed: 100 users, 500 sessions, leaderboard
INSERT INTO users (username, join_date)
SELECT 'player_' || i, NOW() - (random() * interval '365 days')
FROM generate_series(1, 100) AS i;

INSERT INTO game_sessions (user_id, score, game_mode, timestamp)
SELECT
  (random() * 99 + 1)::int,
  (random() * 1000 + 100)::int,
  (ARRAY['ranked','casual','tournament'])[floor(random()*3+1)::int],
  NOW() - (random() * interval '30 days')
FROM generate_series(1, 500);

INSERT INTO leaderboard (user_id, total_score, rank, updated_at)
SELECT user_id, SUM(score), 0, NOW()
FROM game_sessions
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE SET total_score = EXCLUDED.total_score, updated_at = NOW();

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY total_score DESC) AS new_rank
  FROM leaderboard
)
UPDATE leaderboard SET rank = ranked.new_rank FROM ranked WHERE leaderboard.id = ranked.id;
