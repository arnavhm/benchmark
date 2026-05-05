const SCORE_CATEGORIES = ["coding", "math", "reasoning", "chat"];

function normalizeWeights(weights = {}) {
  const normalized = SCORE_CATEGORIES.reduce((acc, category) => {
    const value = Number(weights[category]);
    acc[category] = Number.isFinite(value) && value >= 0 ? value : 0;
    return acc;
  }, {});

  const total = SCORE_CATEGORIES.reduce((sum, category) => sum + normalized[category], 0);
  if (total === 0) {
    return SCORE_CATEGORIES.reduce((acc, category) => {
      acc[category] = 0.25;
      return acc;
    }, {});
  }

  return SCORE_CATEGORIES.reduce((acc, category) => {
    acc[category] = normalized[category] / total;
    return acc;
  }, {});
}

function getBestCategory(model) {
  return SCORE_CATEGORIES.reduce((best, category) => {
    return Number(model[category]) > Number(model[best]) ? category : best;
  }, SCORE_CATEGORIES[0]);
}

function getWeakestCategory(model) {
  return SCORE_CATEGORIES.reduce((weakest, category) => {
    return Number(model[category]) < Number(model[weakest]) ? category : weakest;
  }, SCORE_CATEGORIES[0]);
}

function scoreModel(model, normalizedWeights) {
  return SCORE_CATEGORIES.reduce((total, category) => {
    return total + Number(model[category]) * normalizedWeights[category];
  }, 0);
}

function buildModelReasoning(model, rank, rankedModels, normalizedWeights) {
  const bestCategory = getBestCategory(model);
  const weakestCategory = getWeakestCategory(model);
  const weightedFocus = SCORE_CATEGORIES.reduce((best, category) => {
    return normalizedWeights[category] > normalizedWeights[best] ? category : best;
  }, SCORE_CATEGORIES[0]);
  const runnerUp = rank === 1 ? rankedModels[1] : rankedModels[0];

  const comparison = runnerUp
    ? `It is ${Math.abs(model.finalScore - runnerUp.finalScore).toFixed(1)} points ${model.finalScore >= runnerUp.finalScore ? "ahead of" : "behind"} ${runnerUp.model} under the current weights.`
    : "No comparison model is available.";

  return {
    rank,
    model: model.model,
    reasoning: `${model.model} ranks #${rank} because it combines strong ${bestCategory} performance with a weighted score of ${model.finalScore.toFixed(1)}. ${comparison}`,
    strengths: [
      `${bestCategory} is its strongest category at ${model[bestCategory].toFixed(1)}.`,
      `It aligns well with the current ${weightedFocus} weighting.`
    ],
    weaknesses: [
      `${weakestCategory} is its lowest category at ${model[weakestCategory].toFixed(1)}.`
    ],
    bestUseCase: model.bestUseCase || `Best suited for ${bestCategory}-heavy workloads.`,
    tradeOff: `Choose carefully for ${weakestCategory}-first workflows where another model may be more specialized.`
  };
}

function getRankedModels(models, weights = {}, options = {}) {
  const normalizedWeights = normalizeWeights(weights);
  const sortBy = options.sortBy || "score";
  const filterCategory = options.filterCategory || "all";

  let ranked = models.map((model) => {
    const finalScore = scoreModel(model, normalizedWeights);
    const bestCategory = getBestCategory(model);

    return {
      model: model.name,
      name: model.name,
      provider: model.provider || "Unknown",
      coding: Number(model.coding),
      math: Number(model.math),
      reasoning: Number(model.reasoning),
      chat: Number(model.chat),
      finalScore: Number(finalScore.toFixed(2)),
      weighted_score: Number(finalScore.toFixed(2)),
      bestCategory,
      bestUseCase: model.bestUseCase || "",
      strengths: [bestCategory, "balanced ranking fit"]
    };
  });

  if (filterCategory !== "all") {
    ranked = ranked.filter((model) => model.bestCategory === filterCategory);
  }

  ranked.sort((a, b) => {
    if (sortBy === "name") return a.model.localeCompare(b.model);
    if (SCORE_CATEGORIES.includes(sortBy)) return b[sortBy] - a[sortBy];
    return b.finalScore - a.finalScore;
  });

  return ranked.map((model, index, arr) => ({
    ...model,
    rank: index + 1,
    analysis: buildModelReasoning(model, index + 1, arr, normalizedWeights)
  }));
}

function generateRankingInsights(rankedModels) {
  if (!rankedModels.length) return [];

  const top = rankedModels[0];
  const weakest = [...rankedModels].sort((a, b) => a.finalScore - b.finalScore)[0];
  const categories = SCORE_CATEGORIES.map((category) => {
    const leader = [...rankedModels].sort((a, b) => b[category] - a[category])[0];
    return {
      icon: "🏅",
      title: `${leader.model} leads ${category}`,
      body: `${leader.model} posts the strongest ${category} score at ${leader[category].toFixed(1)}.`,
      accent: category
    };
  });

  return [
    {
      icon: "🧠",
      title: `Why ${top.model} ranks #1`,
      body: top.analysis.reasoning,
      accent: "reasoning"
    },
    ...categories.slice(0, 2),
    {
      icon: "⚠️",
      title: `${weakest.model} is weakest in this view`,
      body: `${weakest.model} has the lowest computed score at ${weakest.finalScore.toFixed(1)} with the current weights and filters.`,
      accent: "chat"
    }
  ];
}

module.exports = {
  SCORE_CATEGORIES,
  getRankedModels,
  generateRankingInsights,
  normalizeWeights
};
