const { getRankedModels, normalizeWeights } = require("./rankingEngine");
const { mapToBenchmarks } = require("./benchmarkMapper");

const TYPE_WEIGHTS = {
  coding: { coding: 55, math: 15, reasoning: 25, chat: 5 },
  math: { coding: 10, math: 55, reasoning: 30, chat: 5 },
  reasoning: { coding: 10, math: 20, reasoning: 55, chat: 15 },
  chat: { coding: 5, math: 10, reasoning: 25, chat: 60 },
  unclear: { coding: 25, math: 25, reasoning: 25, chat: 25 }
};

function weightsForDataset(analysis) {
  const base = { ...(TYPE_WEIGHTS[analysis.type] || TYPE_WEIGHTS.unclear) };

  if (analysis.difficulty === "hard") {
    base.reasoning += 10;
    base.chat = Math.max(0, base.chat - 5);
    base.coding = analysis.type === "coding" ? base.coding : Math.max(0, base.coding - 5);
  }

  if (analysis.format === "conversational") {
    base.chat += 10;
    base.math = Math.max(0, base.math - 5);
  }

  if (analysis.format === "code") {
    base.coding += 10;
    base.chat = Math.max(0, base.chat - 5);
  }

  return base;
}

function confidenceFromRanking(analysis, ranking) {
  if (!ranking.length) return 0;
  const gap = ranking[1] ? ranking[0].finalScore - ranking[1].finalScore : 5;
  const clarity = analysis.type === "unclear" ? 0.45 : analysis.confidence || 0.65;
  const gapConfidence = Math.min(1, 0.55 + gap / 10);
  return Math.round(Math.max(0.25, Math.min(0.98, clarity * 0.65 + gapConfidence * 0.35)) * 100);
}

function explainRecommendation(analysis, top, benchmarks) {
  if (!top) return "No model recommendation could be generated for this dataset.";

  if (analysis.type === "unclear") {
    return "The uploaded dataset is ambiguous, so the system used a balanced benchmark mix. Select a task type manually to produce a more targeted recommendation.";
  }

  const benchmarkText = benchmarks.join(" and ");
  return `This dataset focuses on ${analysis.type} tasks with ${analysis.difficulty} difficulty and a ${analysis.format} format. ${top.model} is recommended because it scores strongly on the mapped ${benchmarkText} signal, with ${top[analysis.type].toFixed(1)} in ${analysis.type} and a final weighted score of ${top.finalScore.toFixed(1)}.`;
}

function buildCategoryScores(ranking) {
  return ["coding", "math", "reasoning", "chat"].reduce((acc, category) => {
    acc[category] = ranking.reduce((scores, model) => {
      scores[model.model] = model[category];
      return scores;
    }, {});
    return acc;
  }, {});
}

function recommendModelsForDataset(models, analysis) {
  const weights = weightsForDataset(analysis);
  const ranking = getRankedModels(models, weights, { sortBy: "score", filterCategory: "all" });
  const topThree = ranking.slice(0, 3);
  const benchmarks = mapToBenchmarks(analysis);
  const confidence = confidenceFromRanking(analysis, ranking);
  const top = ranking[0];
  const explanation = explainRecommendation(analysis, top, benchmarks);

  return {
    datasetType: analysis.type,
    difficulty: analysis.difficulty,
    format: analysis.format,
    size: analysis.size,
    reasoning_required: analysis.reasoning_required,
    benchmarks,
    weights,
    normalizedWeights: normalizeWeights(weights),
    recommendedModel: top?.model || "",
    ranking: topThree.map((model) => ({
      rank: model.rank,
      model: model.model,
      provider: model.provider,
      score: model.finalScore,
      coding: model.coding,
      math: model.math,
      reasoning: model.reasoning,
      chat: model.chat,
      reasoningText: model.analysis.reasoning,
      strengths: model.analysis.strengths,
      weaknesses: model.analysis.weaknesses,
      bestUseCase: model.analysis.bestUseCase
    })),
    allRankings: ranking,
    confidence,
    explanation,
    needsManualSelection: analysis.type === "unclear" || analysis.confidence < 0.5
  };
}

function toCustomResultsPayload(recommendation, analysis, sourceMeta) {
  const models = recommendation.ranking.map((item) => item.model);
  const overallScores = recommendation.ranking.reduce((acc, item) => {
    acc[item.model] = item.score;
    return acc;
  }, {});
  const categoryScores = buildCategoryScores(recommendation.ranking.map((item) => ({
    model: item.model,
    coding: item.coding,
    math: item.math,
    reasoning: item.reasoning,
    chat: item.chat
  })));

  return {
    datasetType: recommendation.datasetType,
    difficulty: recommendation.difficulty,
    recommendedModel: recommendation.recommendedModel,
    ranking: recommendation.ranking,
    confidence: recommendation.confidence,
    explanation: recommendation.explanation,
    analysis,
    benchmarks: recommendation.benchmarks,
    weights: recommendation.weights,
    needsManualSelection: recommendation.needsManualSelection,
    source: sourceMeta.source,
    lastUpdated: sourceMeta.lastUpdated,
    recommendation: {
      recommended_model: recommendation.recommendedModel,
      score: recommendation.ranking[0]?.score || 0,
      confidence: recommendation.confidence,
      explanation: recommendation.explanation,
      rankings: recommendation.ranking.map((item) => ({
        model: item.model,
        overall: item.score,
        color: "#6c5ce7",
        reasoning: item.reasoningText,
        bestUseCase: item.bestUseCase
      }))
    },
    models,
    categories: ["coding", "math", "reasoning", "chat"],
    overall_scores: overallScores,
    category_scores: categoryScores,
    difficulty_scores: models.reduce((acc, model) => {
      acc[model] = {
        easy: overallScores[model] - (analysis.difficulty === "easy" ? 0 : 2),
        medium: overallScores[model],
        hard: overallScores[model] - (analysis.difficulty === "hard" ? 0 : 4)
      };
      return acc;
    }, {}),
    avg_response_times: models.reduce((acc, model, index) => {
      acc[model] = Number((0.7 + index * 0.12).toFixed(3));
      return acc;
    }, {}),
    model_colors: models.reduce((acc, model, index) => {
      const colors = ["#00cec9", "#d4a574", "#4285f4", "#fd79a8", "#fdcb6e"];
      acc[model] = colors[index % colors.length];
      return acc;
    }, {}),
    mode: analysis.analyzer,
    total_questions: analysis.size,
    difficulty_filter: analysis.difficulty,
    gemini_api_used: false,
    fallback_count: analysis.analyzer === "llm" ? 0 : 1
  };
}

module.exports = {
  weightsForDataset,
  recommendModelsForDataset,
  toCustomResultsPayload
};
