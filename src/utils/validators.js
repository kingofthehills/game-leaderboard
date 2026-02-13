// ============================================
// Request Validation Schemas (Joi)
// ============================================

const Joi = require('joi');

const submitScoreSchema = Joi.object({
  user_id: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'user_id must be a number',
      'number.positive': 'user_id must be positive',
      'any.required': 'user_id is required',
    }),
  score: Joi.number().integer().min(0).max(1000000).required()
    .messages({
      'number.base': 'score must be a number',
      'number.min': 'score must be >= 0',
      'number.max': 'score must be <= 1,000,000',
      'any.required': 'score is required',
    }),
  game_mode: Joi.string().valid('classic', 'ranked', 'casual', 'tournament')
    .default('classic')
    .messages({
      'any.only': 'game_mode must be one of: classic, ranked, casual, tournament',
    }),
});

const userIdParamSchema = Joi.object({
  user_id: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'user_id must be a number',
      'number.positive': 'user_id must be positive',
    }),
});

module.exports = {
  submitScoreSchema,
  userIdParamSchema,
};
