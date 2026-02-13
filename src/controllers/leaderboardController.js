// ============================================
// Leaderboard Controller
// ============================================
// Thin controller: validate → service → respond

const leaderboardService = require('../services/leaderboardService');
const { submitScoreSchema, userIdParamSchema } = require('../utils/validators');
const { ValidationError } = require('../utils/errors');

async function submitScore(req, res, next) {
  try {
    const { error, value } = submitScoreSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { user_id, score, game_mode } = value;
    const result = await leaderboardService.submitScore(user_id, score, game_mode);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function getTop10(req, res, next) {
  try {
    const result = await leaderboardService.getTop10();

    res.status(200).json({
      success: true,
      data: result,
      cached: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

async function getPlayerRank(req, res, next) {
  try {
    const { error, value } = userIdParamSchema.validate({
      user_id: parseInt(req.params.user_id, 10),
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const result = await leaderboardService.getPlayerRank(value.user_id);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function seedData(req, res, next) {
  try {
    const { seedDatabase } = require('../services/seedService');
    const { user_count = 100, sessions_per_user = 5, clear_existing = false } = req.body || {};

    const result = await seedDatabase({
      userCount: Math.min(parseInt(user_count) || 100, 10000),
      sessionsPerUser: Math.min(parseInt(sessions_per_user) || 5, 50),
      clearExisting: Boolean(clear_existing),
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitScore, getTop10, getPlayerRank, seedData };
