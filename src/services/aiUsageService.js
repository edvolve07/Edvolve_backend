import { collections } from "../db.js";

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
    const { aiUsage } = collections();
    await aiUsage.insertOne({
      provider,
      model,
      feature,
      status,
      prompt_tokens: safeNumber(usage.prompt_tokens ?? usage.promptTokens),
      completion_tokens: safeNumber(usage.completion_tokens ?? usage.completionTokens),
      total_tokens: safeNumber(usage.total_tokens ?? usage.totalTokens),
      metadata,
      created_at: new Date()
    });
  } catch {
    // Usage tracking must never break the user-facing AI workflow.
  }
}

export async function summarizeAiUsage({ days = 30, limit = 12 } = {}) {
  const { aiUsage } = collections();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match = { created_at: { $gte: since } };

  const [totals, byFeature, byProvider, recent] = await Promise.all([
    aiUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          successful_requests: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
          failed_requests: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
          prompt_tokens: { $sum: "$prompt_tokens" },
          completion_tokens: { $sum: "$completion_tokens" },
          total_tokens: { $sum: "$total_tokens" }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray(),
    aiUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$feature",
          requests: { $sum: 1 },
          total_tokens: { $sum: "$total_tokens" }
        }
      },
      { $sort: { requests: -1 } },
      { $limit: limit },
      { $project: { _id: 0, feature: "$_id", requests: 1, total_tokens: 1 } }
    ]).toArray(),
    aiUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: { provider: "$provider", model: "$model" },
          requests: { $sum: 1 },
          total_tokens: { $sum: "$total_tokens" }
        }
      },
      { $sort: { requests: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          provider: "$_id.provider",
          model: "$_id.model",
          requests: 1,
          total_tokens: 1
        }
      }
    ]).toArray(),
    aiUsage.find(match, {
      projection: {
        _id: 0,
        provider: 1,
        model: 1,
        feature: 1,
        status: 1,
        total_tokens: 1,
        created_at: 1
      }
    }).sort({ created_at: -1 }).limit(limit).toArray()
  ]);

  return {
    window_days: days,
    totals: totals[0] || {
      requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    by_feature: byFeature,
    by_provider: byProvider,
    recent
  };
}
