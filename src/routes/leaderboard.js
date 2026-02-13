// ============================================
// Leaderboard Routes
// ============================================

const { Router } = require('express');
const { submitScore, getTop10, getPlayerRank, seedData } = require('../controllers/leaderboardController');

const router = Router();

router.post('/submit', submitScore);
router.get('/top', getTop10);
router.get('/rank/:user_id', getPlayerRank);
router.post('/seed', seedData);

module.exports = router;
