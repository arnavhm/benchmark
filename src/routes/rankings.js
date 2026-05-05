const express = require("express");
const multer = require("multer");
const { getModels } = require("../data/modelRepository");
const { SCORE_CATEGORIES, generateRankingInsights, getRankedModels } = require("../logic/rankingEngine");
const { parseDatasetFile, getDatasetSamples } = require("../logic/datasetParser");
const { analyzeDataset } = require("../logic/datasetAnalyzer");
const { recommendModelsForDataset, toCustomResultsPayload } = require("../logic/datasetRecommendationEngine");

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

    res.json({
      ...toCustomResultsPayload(recommendation, analysis, {
        source: modelPayload.source,
        lastUpdated: modelPayload.lastUpdated
      }),
      samples: getDatasetSamples(records, 10)
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

    res.json({
      message: `Analyzed ${records.length} samples successfully.`,
      warnings: recommendation.needsManualSelection
        ? ["Dataset type is unclear. Select a task type manually for a more targeted ranking."]
        : [],
      ...toCustomResultsPayload(recommendation, analysis, {
        source: modelPayload.source,
        lastUpdated: modelPayload.lastUpdated
      }),
      samples: getDatasetSamples(records, 10)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api-status", (req, res) => {
  res.json({
    gemini_sdk_installed: false,
    gemini_api_key_set: false,
    gemini_ready: false,
    llm_dataset_analyzer: Boolean(process.env.OPENAI_API_KEY),
    dataset_analyzer_model: process.env.DATASET_ANALYZER_MODEL || "gpt-5.4-mini"
  });
});

module.exports = router;
