const express = require("express");
const multer = require("multer");
const { getModels } = require("../data/modelRepository");
const { SCORE_CATEGORIES, generateRankingInsights, getRankedModels } = require("../logic/rankingEngine");
const { parseDatasetFile, getDatasetSamples } = require("../logic/datasetParser");
const { analyzeDataset } = require("../logic/datasetAnalyzer");
const { recommendModelsForDataset, toCustomResultsPayload } = require("../logic/datasetRecommendationEngine");
const { runTrials } = require("../logic/datasetEvaluator");

function hasGeminiKey() {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== "your_gemini_api_key_here");
}

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const DEFAULT_WEIGHTS = {
  coding: 25,
  math: 25,
  reasoning: 25,
  chat: 25
};

function buildStats(models) {
  return SCORE_CATEGORIES.reduce((stats, category) => {
    const values = models.map((model) => Number(model[category]));
    const leader = [...models].sort((a, b) => Number(b[category]) - Number(a[category]))[0];

    stats[category] = {
      max: Number(Math.max(...values).toFixed(1)),
      min: Number(Math.min(...values).toFixed(1)),
      avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
      leader: leader?.name || "Unknown"
    };
    return stats;
  }, {});
}

function asLegacyData(models) {
  return models.map((model) => ({
    model: model.name,
    provider: model.provider || "Unknown",
    coding: model.coding,
    math: model.math,
    reasoning: model.reasoning,
    chat: model.chat,
    bestUseCase: model.bestUseCase
  }));
}

function buildRecommendationPayload({ ranked, source, lastUpdated, weights }) {
  const best = ranked[0];
  const runnerUp = ranked[1];
  const gap = runnerUp ? best.finalScore - runnerUp.finalScore : 0;

  return {
    rankings: ranked,
    best_model: best?.model,
    lastUpdated,
    source,
    weights_used: weights,
    explanation: best
      ? `${best.model} is recommended with a computed score of ${best.finalScore.toFixed(1)}${runnerUp ? `, leading ${runnerUp.model} by ${gap.toFixed(1)} points` : ""}.`
      : "No models matched the selected filter.",
    reasoning: best?.analysis,
    insights: generateRankingInsights(ranked)
  };
}

router.get("/api/models", async (req, res, next) => {
  try {
    const payload = await getModels(req.query.source);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/api/models/rankings", async (req, res, next) => {
  try {
    const { weights = DEFAULT_WEIGHTS, sortBy = "score", filterCategory = "all", source = "local" } = req.body || {};
    const payload = await getModels(source);
    const ranked = getRankedModels(payload.models, weights, { sortBy, filterCategory });

    res.json(buildRecommendationPayload({
      ranked,
      source: payload.source,
      lastUpdated: payload.lastUpdated,
      weights
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/get-data", async (req, res, next) => {
  try {
    const payload = await getModels(req.query.source);
    const ranked = getRankedModels(payload.models, DEFAULT_WEIGHTS);

    res.json({
      models: payload.models.map((model) => model.name),
      data: asLegacyData(payload.models),
      benchmarks: SCORE_CATEGORIES,
      stats: buildStats(payload.models),
      insights: generateRankingInsights(ranked),
      lastUpdated: payload.lastUpdated,
      source: payload.source
    });
  } catch (error) {
    next(error);
  }
});

router.post("/recommend", async (req, res, next) => {
  try {
    const { weights = DEFAULT_WEIGHTS, sortBy = "score", filterCategory = "all", source = "local" } = req.body || {};
    const payload = await getModels(source);
    const ranked = getRankedModels(payload.models, weights, { sortBy, filterCategory });

    res.json(buildRecommendationPayload({
      ranked,
      source: payload.source,
      lastUpdated: payload.lastUpdated,
      weights
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/api/datasets/analyze", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No dataset file uploaded." });
    }

    const records = parseDatasetFile(req.file);
    if (!records.length) {
      return res.status(400).json({ error: "Dataset is empty or could not be parsed." });
    }

    const analysis = await analyzeDataset(records, {
      manualTaskType: req.body?.taskType,
      useLLM: req.body?.useLLM !== "false"
    });
    const modelPayload = await getModels(req.body?.source || "local");
    const recommendation = recommendModelsForDataset(modelPayload.models, analysis);
    const evaluation_metrics = await runTrials(recommendation.allRankings, records, analysis.type);

    res.json({
      ...toCustomResultsPayload(recommendation, analysis, {
        source: modelPayload.source,
        lastUpdated: modelPayload.lastUpdated
      }),
      samples: getDatasetSamples(records, 10),
      evaluation_metrics
    });
  } catch (error) {
    next(error);
  }
});

router.post("/upload-custom-dataset", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No dataset file uploaded." });
    }

    const records = parseDatasetFile(req.file);
    if (!records.length) {
      return res.status(400).json({ error: "Dataset is empty or could not be parsed." });
    }

    const analysis = await analyzeDataset(records, {
      manualTaskType: req.body?.taskType,
      useLLM: req.body?.useLLM !== "false"
    });
    const modelPayload = await getModels("local");
    const recommendation = recommendModelsForDataset(modelPayload.models, analysis);
    const evaluation_metrics = await runTrials(recommendation.allRankings, records, analysis.type);

    res.json({
      message: `Analyzed ${records.length} samples successfully.`,
      warnings: recommendation.needsManualSelection
        ? ["Dataset type is unclear. Select a task type manually for a more targeted ranking."]
        : [],
      ...toCustomResultsPayload(recommendation, analysis, {
        source: modelPayload.source,
        lastUpdated: modelPayload.lastUpdated
      }),
      samples: getDatasetSamples(records, 10),
      evaluation_metrics
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api-status", async (req, res) => {
  const keySet = hasGeminiKey();
  let geminiReady = false;

  if (keySet) {
    try {
      const model = process.env.DATASET_ANALYZER_MODEL || "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      const probe = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      });
      geminiReady = probe.ok;
    } catch {
      geminiReady = false;
    }
  }

  res.json({
    gemini_sdk_installed: keySet,
    gemini_api_key_set: keySet,
    gemini_ready: geminiReady,
    llm_dataset_analyzer: geminiReady,
    dataset_analyzer_model: process.env.DATASET_ANALYZER_MODEL || "gemini-2.5-flash"
  });
});

// =============================================================
// Run Custom Benchmark (used by frontend Run Custom Benchmark)
// Accepts JSON body: { mode, difficulty, categories }
// Returns a recommendation payload (same shape used by the UI)
// =============================================================
router.post('/run-custom-benchmark', async (req, res, next) => {
  try {
    const { mode = 'simulated', difficulty = 'all', categories = null } = req.body || {};

    // Use local models and generate a ranked list with default weights
    const payload = await getModels('local');

    // Heuristic: if categories provided, bias weights toward selected categories
    const baseWeights = { coding: 25, math: 25, reasoning: 25, chat: 25 };
    if (Array.isArray(categories) && categories.length > 0) {
      // boost selected categories
      const boost = Math.floor(100 / categories.length / 2);
      categories.forEach(cat => {
        if (baseWeights[cat] !== undefined) baseWeights[cat] = Math.min(80, baseWeights[cat] + boost);
      });
    }

    const ranked = getRankedModels(payload.models, baseWeights, { sortBy: 'score', filterCategory: 'all' });

    const recommendationPayload = buildRecommendationPayload({
      ranked,
      source: payload.source,
      lastUpdated: payload.lastUpdated,
      weights: baseWeights,
    });

    // Build UI-friendly aggregates the frontend expects
    const models = ranked.map(r => r.model);
    const overall_scores = ranked.reduce((acc, r) => { acc[r.model] = r.weighted_score || r.finalScore || r.score || 0; return acc; }, {});
    const category_scores = {
      coding: {}, math: {}, reasoning: {}, chat: {}
    };
    ranked.forEach(r => {
      category_scores.coding[r.model] = Number(r.coding || 0);
      category_scores.math[r.model] = Number(r.math || 0);
      category_scores.reasoning[r.model] = Number(r.reasoning || 0);
      category_scores.chat[r.model] = Number(r.chat || 0);
    });

    const recommendation = {
      recommended_model: recommendationPayload.best_model,
      score: overall_scores[recommendationPayload.best_model] || 0,
      explanation: recommendationPayload.explanation,
      rankings: ranked.map((r, i) => ({ model: r.model, overall: overall_scores[r.model], color: '#6c5ce7' }))
    };

    // model_colors: minimal fallback mapping
    const model_colors = models.reduce((m, name, i) => { m[name] = ['#00cec9','#d4a574','#4285f4','#6c5ce7'][i % 4]; return m; }, {});

    const resp = Object.assign({}, recommendationPayload, {
      mode: mode === 'real_api' ? 'real_api' : (mode === 'llm' ? 'llm' : 'simulated'),
      difficulty_filter: difficulty,
      categories: categories || ['coding','math','reasoning','chat'],
      gemini_api_used: false,
      models,
      overall_scores,
      category_scores,
      recommendation,
      model_colors,
      weights: baseWeights,
    });

    res.json(resp);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
