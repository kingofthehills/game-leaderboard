-- ============================================
-- Generate Leaderboard from Game Sessions
-- ============================================

TRUNCATE leaderboard;

INSERT INTO leaderboard (user_id, total_score, rank, updated_at)
SELECT
    user_id,
    SUM(score) AS total_score,
    ROW_NUMBER() OVER (ORDER BY SUM(score) DESC) AS rank,
    NOW()
FROM game_sessions
GROUP BY user_id;

ANALYZE leaderboard;

SELECT COUNT(*) AS leaderboard_entries FROM leaderboard;

SELECT
    l.rank,
    u.username,
    l.total_score
FROM leaderboard l
JOIN users u ON u.id = l.user_id
ORDER BY l.rank ASC
LIMIT 20;
