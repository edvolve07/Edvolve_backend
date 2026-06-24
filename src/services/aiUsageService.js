import { AiUsage, Op, getSequelize } from "../database/index.js";

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function recordAiUsage({
  provider,
  model,
  feature,
  status = "success",
  usage = {},
  metadata = {}
}) {
  try {
    await AiUsage.create({
      provider,
      model,
      feature,
      status,
      prompt_tokens: safeNumber(usage.prompt_tokens ?? usage.promptTokens),
      completion_tokens: safeNumber(usage.completion_tokens ?? usage.completionTokens),
      total_tokens: safeNumber(usage.total_tokens ?? usage.totalTokens),
      metadata,
    });
  } catch {
    // Usage tracking must never break the user-facing AI workflow.
  }
}

export async function summarizeAiUsage({ days = 30, limit = 12 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sequelize = getSequelize();

  const [totalsResult, byFeature, byProvider, recent] = await Promise.all([
    AiUsage.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('_id')), 'requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'success' THEN 1 ELSE 0 END")), 'successful_requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'error' THEN 1 ELSE 0 END")), 'failed_requests'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('prompt_tokens')), 0), 'prompt_tokens'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('completion_tokens')), 0), 'completion_tokens'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('total_tokens')), 0), 'total_tokens'],
      ],
      raw: true,
    }),
    AiUsage.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: [
        'feature',
        [sequelize.fn('COUNT', sequelize.col('_id')), 'requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'success' THEN 1 ELSE 0 END")), 'successful_requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'error' THEN 1 ELSE 0 END")), 'failed_requests'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('total_tokens')), 0), 'total_tokens'],
      ],
      group: ['feature'],
      order: [[sequelize.literal('requests'), 'DESC']],
      limit,
      raw: true,
    }),
    AiUsage.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: [
        'provider',
        'model',
        [sequelize.fn('COUNT', sequelize.col('_id')), 'requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'success' THEN 1 ELSE 0 END")), 'successful_requests'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'error' THEN 1 ELSE 0 END")), 'failed_requests'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('total_tokens')), 0), 'total_tokens'],
      ],
      group: ['provider', 'model'],
      order: [[sequelize.literal('requests'), 'DESC']],
      limit,
      raw: true,
    }),
    AiUsage.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: ['provider', 'model', 'feature', 'status', 'total_tokens', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    }),
  ]);

  return {
    window_days: days,
    totals: totalsResult[0] || {
      requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    by_feature: byFeature,
    by_provider: byProvider,
    recent,
  };
}
