/**
 * Objective evaluation of models against a dataset.
 *
 * Scoring is simulated deterministically using each model's known benchmark
 * scores as the baseline probability of answering correctly, adjusted for
 * question difficulty. Multiple trials with fixed seeds give mean ± std.
 *
 * Why simulated? The system doesn't make live LLM API calls; benchmark scores
 * in models.json represent published evaluation results. This module translates
 * those scores into per-question correctness, keyword recall, and F1 so the UI
 * can show objective metrics rather than only weighted composite scores.
 */

// Mulberry32 seeded RNG — no external dependency, reproducible across runs.
function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFFICULTY_FACTOR = { easy: 1.08, medium: 1.0, hard: 0.88, unknown: 1.0 };

function categoryScore(model, taskType) {
  const score = Number(model[taskType]);
  if (Number.isFinite(score) && score > 0) return score;
  return (Number(model.coding) + Number(model.math) + Number(model.reasoning) + Number(model.chat)) / 4;
}

/**
 * Score a single model against the full dataset in one trial.
 * Returns per-question results plus aggregate accuracy / F1 / error rate.
 */
async function scoreModelOnDataset(model, dataset, taskType, rng) {
  let tp = 0, fp = 0, fn = 0;
  const perQuestion = [];
  let nlpScoreSum = 0;

  for (const q of dataset) {
    const diff = q.difficulty || "unknown";
    const factor = DIFFICULTY_FACTOR[diff] ?? 1.0;
    const p = Math.min(0.99, (categoryScore(model, taskType) * factor) / 100);
    const correct = rng() < p;

    // Simulate LLM answer if we have ground_truth
    const simulatedAnswer = correct ? (q.ground_truth || "Correctly generated answer") : "I do not know the answer to this question.";
    let nlpSim = 0.0;
    if (q.ground_truth) {
      try {
        const resp = await fetch("http://127.0.0.1:8000/api/v1/evaluate/nlp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ predicted: simulatedAnswer, ground_truth: q.ground_truth })
        });
        const data = await resp.json();
        nlpSim = data.similarity || 0.0;
      } catch (err) {
        nlpSim = correct ? 1.0 : 0.0; // fallback if python server is down
      }
    } else {
      nlpSim = correct ? 1.0 : 0.0;
    }
    nlpScoreSum += nlpSim;

    const keywords = Array.isArray(q.keywords) ? q.keywords : [];
    const matched = correct
      ? keywords.length
      : Math.floor(keywords.length * Math.max(0, rng() * 0.4));

    tp += matched;
    fn += keywords.length - matched;
    fp += correct ? 0 : Math.floor(rng() * 2);

    perQuestion.push({
      id: q.id,
      difficulty: diff,
      correct,
      nlp_similarity: round1(nlpSim * 100),
      keywords_matched: matched,
      keywords_total: keywords.length,
      partial_score: correct ? 1.0 : matched / Math.max(keywords.length, 1)
    });
  }

  const total = dataset.length;
  const correctCount = perQuestion.filter((r) => r.correct).length;
  const accuracy = total > 0 ? (correctCount / total) * 100 : 0;

  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const byDifficulty = {};
  for (const r of perQuestion) {
    const d = r.difficulty;
    if (!byDifficulty[d]) byDifficulty[d] = { correct: 0, total: 0 };
    byDifficulty[d].total++;
    if (r.correct) byDifficulty[d].correct++;
  }
  const diffAccuracy = Object.fromEntries(
    Object.entries(byDifficulty).map(([d, v]) => [d, round1((v.correct / v.total) * 100)])
  );

  return {
    accuracy: round1(accuracy),
    f1: round1(f1 * 100),
    nlp_similarity: round1((nlpScoreSum / Math.max(dataset.length, 1)) * 100),
    precision: round1(precision * 100),
    recall: round1(recall * 100),
    error_rate: round1(100 - accuracy),
    correct_count: correctCount,
    total_count: total,
    by_difficulty: diffAccuracy,
    per_question: perQuestion
  };
}

/**
 * Run N independent trials and return aggregated stats (mean, std, 95% CI)
 * for every model. Fixed seeds make results reproducible.
 */
async function runTrials(models, dataset, taskType, n = 5) {
  const SEEDS = [42, 137, 271, 418, 999];

  const trialData = [];
  for (let i = 0; i < n; i++) {
    const rng = createRng(SEEDS[i] ?? i * 31 + 7);
    const trial = {};
    for (const model of models) {
      trial[modelName(model)] = await scoreModelOnDataset(model, dataset, taskType, rng);
    }
    trialData.push(trial);
  }

  // Find the leader model (highest mean accuracy)
  let leaderName = null;
  let maxMeanAcc = -1;
  for (const model of models) {
    const name = modelName(model);
    const accuracies = trialData.map((t) => t[name].accuracy);
    const mAcc = mean(accuracies);
    if (mAcc > maxMeanAcc) {
      maxMeanAcc = mAcc;
      leaderName = name;
    }
  }

  const leaderAccuracies = leaderName ? trialData.map((t) => t[leaderName].accuracy) : [];

  const aggregated = {};
  for (const model of models) {
    const name = modelName(model);
    const accuracies = trialData.map((t) => t[name].accuracy);
    const f1s = trialData.map((t) => t[name].f1);
    const nlpSims = trialData.map((t) => t[name].nlp_similarity);
    const errorRates = trialData.map((t) => t[name].error_rate);

    const mAcc = mean(accuracies);
    const sAcc = std(accuracies);
    const se = sAcc / Math.sqrt(n);

    // Compute Welch's t-test p-value compared to the leader model
    const pValue = name === leaderName
      ? 1.0
      : Number(welchTTest(leaderAccuracies, accuracies).toFixed(4));

    aggregated[name] = {
      accuracy: {
        mean: round1(mAcc),
        std: round1(sAcc),
        ci_lower: round1(Math.max(0, mAcc - 1.96 * se)),
        ci_upper: round1(Math.min(100, mAcc + 1.96 * se))
      },
      f1: { mean: round1(mean(f1s)), std: round1(std(f1s)) },
      nlp_similarity: { mean: round1(mean(nlpSims)), std: round1(std(nlpSims)) },
      error_rate: round1(mean(errorRates)),
      p_value: pValue,
      n_trials: n,
      by_difficulty: trialData[n - 1][name].by_difficulty,
      per_question: trialData[n - 1][name].per_question
    };
  }

  return { n_trials: n, task_type: taskType, dataset_size: dataset.length, models: aggregated };
}

// ── helpers ──────────────────────────────────────────────────────────────────
const round1 = (x) => Math.round(x * 10) / 10;
const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const std = (arr) => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
};
const sampleVariance = (arr) => {
  const m = mean(arr);
  if (arr.length <= 1) return 0;
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
};
const modelName = (m) => m.model || m.name || "unknown";

// Welch's t-test for comparing two trial accuracy distributions
function welchTTest(sample1, sample2) {
  const n1 = sample1.length;
  const n2 = sample2.length;
  if (n1 === 0 || n2 === 0) return 1.0;

  const m1 = mean(sample1);
  const m2 = mean(sample2);
  const v1 = sampleVariance(sample1);
  const v2 = sampleVariance(sample2);

  if (m1 === m2) return 1.0;
  if (v1 === 0 && v2 === 0) return 0.0;

  const tStat = (m1 - m2) / Math.sqrt(v1 / n1 + v2 / n2);
  
  const num = Math.pow(v1 / n1 + v2 / n2, 2);
  const den = Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1);
  const df = den > 0 ? num / den : 1.0;

  return tTestPValue(tStat, df);
}

// Approximates the p-value for Student's t-distribution
function tTestPValue(tStat, df) {
  const t = Math.abs(tStat);
  if (df <= 0) return 1.0;
  const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
  return 2 * (1 - normalCDF(Math.abs(z)));
}

// Standard normal distribution CDF approximation
function normalCDF(z) {
  const p = 0.2316419;
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  
  const x = Math.abs(z);
  const t = 1.0 / (1.0 + p * x);
  const val = 1.0 - (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * 
              (b1 * t + b2 * t*t + b3 * t*t*t + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
              
  return z >= 0 ? val : 1.0 - val;
}

module.exports = { runTrials, scoreModelOnDataset, createRng };
