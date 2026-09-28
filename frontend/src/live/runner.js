/**
 * Live benchmark runner.
 *
 * For every question: send it to every contestant model in parallel (real API calls),
 * then have the blind judge grade all answers together. Progress is emitted as events
 * so the dashboard can show answers arriving live. Finished runs are saved to
 * data/live_runs/ and can be replayed without network.
 */
const fs = require("fs");
const path = require("path");
const { callModel } = require("./providers");
const { judgeQuestion } = require("./judge");
const { lexicalSimilarity, mean, percentile, bootstrapCI } = require("./metrics");
const { RUNS_DIR, getDataset, loadConfig, loadDataset } = require("./config");

// Composite score: same structure as backend/core/engine.py (0.5 accuracy, 0.3 latency, 0.2 cost),
// with latency/cost ceilings rescaled for real per-call numbers.
const WEIGHTS = { accuracy: 0.5, latency: 0.3, cost: 0.2 };
const LATENCY_CEILING_MS = 10000; // mean latency >= 10 s scores 0 on speed
const COST_CEILING_USD = 0.005; // mean cost per answer >= $0.005 scores 0 on cost

function tierFor(score) {
  if (score > 85) return "Production";
  if (score > 70) return "Analysis";
  return "Research";
}

const TIER_ORDER = ["Research", "Analysis", "Production"];
/** Tier from composite, capped by accuracy: a fast but wrong model can never be "Production". */
function gatedTier(composite, accuracy, gate) {
  let tier = tierFor(composite);
  if (gate && accuracy !== null) {
    const cap = accuracy >= gate.production ? "Production" : accuracy >= gate.analysis ? "Analysis" : "Research";
    if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(cap)) tier = cap;
  }
  return tier;
}

function answerPrompt(q, maxWords, instruction) {
  return `${q.question}\n\nAnswer directly in at most ${maxWords} words. ${instruction || ""}`.trim();
}

async function runQuestion(q, contestants, settings, emit, instruction) {
  const answers = await Promise.all(
    contestants.map(async (c) => {
      emit("answer_start", { questionId: q.id, key: c.key });
      try {
        const r = await callModel(c.provider, {
          model: c.model,
          prompt: answerPrompt(q, settings.maxAnswerWords || 120, instruction),
          maxTokens: 4096,
          temperature: 0.2,
          extra: c.extra,
          pricing: c.pricing,
          fallbacks: c.fallbacks,
          timeoutMs: settings.requestTimeoutMs || 60000
        });
        if (!r.text) throw new Error(`Empty response (finish reason: ${r.finishReason || "unknown"})`);
        const result = {
          key: c.key,
          ok: true,
          text: r.text,
          latencyMs: Math.round(r.latencyMs),
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          reasoningTokens: r.reasoningTokens,
          costUsd: r.costUsd,
          costSource: r.costSource,
          servedModel: r.servedModel,
          servedBy: r.servedBy.model,
          fallbackUsed: r.fallbackUsed,
          lexical: Number(lexicalSimilarity(r.text, q.reference).toFixed(3))
        };
        emit("answer", { questionId: q.id, ...result });
        return result;
      } catch (error) {
        const result = { key: c.key, ok: false, error: error.message };
        emit("answer", { questionId: q.id, ...result });
        return result;
      }
    })
  );
  return answers;
}

function summarise(contestants, questions, settings = {}) {
  const costInComposite = settings.costInComposite !== false;
  return contestants
    .map((c) => {
      const rows = questions.map((q) => q.answers.find((a) => a.key === c.key)).filter(Boolean);
      const ok = rows.filter((r) => r.ok && r.grade);
      const scores = ok.map((r) => r.grade.score * 10); // 0-100
      const latencies = rows.filter((r) => r.ok).map((r) => r.latencyMs);
      const costs = rows.filter((r) => r.ok && Number.isFinite(r.costUsd)).map((r) => r.costUsd);
      const accuracy = mean(scores);
      const passCount = ok.filter((r) => r.grade.score >= 7).length;
      const meanLatency = mean(latencies);
      const meanCost = mean(costs);
      const totalCost = costs.reduce((s, x) => s + x, 0);

      let composite = null;
      if (accuracy !== null && meanLatency !== null) {
        const latencyNorm = Math.max(0, 100 * (1 - meanLatency / LATENCY_CEILING_MS));
        if (meanCost === null || !costInComposite) {
          // No price available: score on accuracy + speed only, re-weighted to sum to 1.
          composite = (accuracy * WEIGHTS.accuracy + latencyNorm * WEIGHTS.latency) / (WEIGHTS.accuracy + WEIGHTS.latency);
        } else {
          const costNorm = Math.max(0, 100 * (1 - meanCost / COST_CEILING_USD));
          composite = accuracy * WEIGHTS.accuracy + latencyNorm * WEIGHTS.latency + costNorm * WEIGHTS.cost;
        }
      }
      const ci = bootstrapCI(scores);
      return {
        key: c.key,
        label: c.label,
        vendor: c.vendor,
        provider: c.provider,
        model: c.model,
        answered: latencies.length,
        graded: ok.length,
        errors: rows.filter((r) => !r.ok).length,
        accuracy: accuracy === null ? null : Number(accuracy.toFixed(1)),
        accuracyCI: ci ? { lower: Number(ci.lower.toFixed(1)), upper: Number(ci.upper.toFixed(1)) } : null,
        passRate: ok.length ? Number(((passCount / ok.length) * 100).toFixed(1)) : null,
        lexical: ok.length ? Number((mean(ok.map((r) => r.lexical)) * 100).toFixed(1)) : null,
        latencyMs: {
          mean: meanLatency === null ? null : Math.round(meanLatency),
          p50: latencies.length ? Math.round(percentile(latencies, 50)) : null,
          p95: latencies.length ? Math.round(percentile(latencies, 95)) : null
        },
        costUsd: {
          total: costs.length ? Number(totalCost.toFixed(6)) : null,
          perAnswer: meanCost === null ? null : Number(meanCost.toFixed(6)),
          perCorrect: passCount && costs.length ? Number((totalCost / passCount).toFixed(6)) : null,
          source: rows.find((r) => r.ok)?.costSource || null
        },
        outputTokens: rows.filter((r) => r.ok).reduce((s, r) => s + (r.outputTokens || 0), 0),
        fallbacks: rows.filter((r) => r.ok && r.fallbackUsed).length,
        fallbackModels: [...new Set(rows.filter((r) => r.ok && r.fallbackUsed).map((r) => r.servedBy))],
        composite: composite === null ? null : Number(composite.toFixed(1)),
        tier: composite === null ? null : gatedTier(composite, accuracy, settings.accuracyGate)
      };
    })
    // Safety-critical domain: rank by judged accuracy first, composite breaks ties.
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || (b.composite ?? -1) - (a.composite ?? -1))
    .map((m, i) => ({ ...m, rank: m.composite === null ? null : i + 1 }));
}

/**
 * Run a live benchmark. `emit(type, payload)` receives progress events.
 * Returns the saved run object.
 */
async function runLiveBenchmark({ dataset = "aviation", limit = 0, models = null } = {}, emit = () => {}) {
  const { contestants: all, judge, settings } = loadConfig();
  const contestants = all.filter((c) => c.available && (!models || models.includes(c.key)));
  const skipped = all.filter((c) => !contestants.includes(c)).map((c) => ({
    key: c.key,
    label: c.label,
    reason: c.available ? "not selected" : `no API key for ${c.provider}`
  }));
  if (!contestants.length) throw new Error("No models available — set GROQ_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY in .env");
  if (!judge.available) throw new Error(`Judge needs an API key for ${judge.provider}`);

  const def = getDataset(dataset);
  if (!def) throw new Error(`Unknown dataset "${dataset}"`);
  let questions = loadDataset(dataset);
  if (limit > 0) questions = questions.slice(0, limit);

  const run = {
    id: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    startedAt: new Date().toISOString(),
    dataset: { id: dataset, label: def.label, size: questions.length },
    criteria: def.criteria.map(({ key, label, max }) => ({ key, label, max })),
    judge: { label: judge.label, provider: judge.provider, model: judge.model },
    contestants: contestants.map(({ key, label, vendor, provider, model }) => ({ key, label, vendor, provider, model })),
    skipped,
    method: {
      scoring: `Blind LLM-as-judge vs reference answer (answers shuffled and anonymised); each answer scored on ${def.criteria.map((c) => `${c.label} /${c.max}`).join(" + ")} = /10`,
      composite: settings.costInComposite === false
        ? `accuracy x 0.625 + speed x 0.375 (the 0.5/0.3 accuracy/speed weights, cost left out because every call runs on a free tier); speed = 0 at ${LATENCY_CEILING_MS / 1000}s mean latency`
        : `accuracy x ${WEIGHTS.accuracy} + speed x ${WEIGHTS.latency} + cost x ${WEIGHTS.cost}; speed = 0 at ${LATENCY_CEILING_MS / 1000}s mean latency, cost = 0 at $${COST_CEILING_USD}/answer`,
      tiers: settings.accuracyGate
        ? `Production > 85, Analysis > 70 (composite), capped by accuracy: Production needs >= ${settings.accuracyGate.production}% judged accuracy, Analysis >= ${settings.accuracyGate.analysis}%. Ranked by accuracy first.`
        : "Production > 85, Analysis > 70, Research <= 70",
      ci: "95% bootstrap CI over questions (2000 resamples)"
    },
    questions: []
  };

  emit("start", {
    id: run.id,
    dataset: run.dataset,
    criteria: run.criteria,
    judge: run.judge,
    contestants: run.contestants,
    skipped,
    questions: questions.map((q) => ({ id: q.id, question: q.question, reference: q.reference, difficulty: q.difficulty }))
  });

  const concurrency = Math.max(1, settings.questionConcurrency || 2);
  const results = new Array(questions.length);
  let cursor = 0;

  async function worker() {
    while (cursor < questions.length) {
      const idx = cursor++;
      const q = questions[idx];
      const answers = await runQuestion(q, contestants, settings, emit, def.instruction);
      const good = answers.filter((a) => a.ok);
      let judgeCall = null;
      try {
        emit("judge_start", { questionId: q.id });
        const judged = await judgeQuestion(q, good.map((a) => ({ key: a.key, text: a.text })), {
          judge,
          rubric: def.rubric,
          criteria: def.criteria,
          seed: idx + 11
        });
        judgeCall = judged.judgeCall;
        emit("judge_model", { questionId: q.id, model: judgeCall?.servedBy, fallbackUsed: judgeCall?.fallbackUsed });
        for (const a of answers) if (judged.grades[a.key]) a.grade = judged.grades[a.key];
        emit("judged", { questionId: q.id, grades: judged.grades });
      } catch (error) {
        emit("judge_error", { questionId: q.id, error: error.message });
      }
      results[idx] = { ...q, answers, judgeCall };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, questions.length) }, worker));

  run.questions = results;
  run.finishedAt = new Date().toISOString();
  run.durationMs = new Date(run.finishedAt) - new Date(run.startedAt);
  run.summary = summarise(contestants, results, settings);
  run.billedCostUsd = Number(results.reduce((s, q) => s + q.answers.reduce((t, a) => t + (a.ok && a.costSource === "billed" ? a.costUsd || 0 : 0), 0), 0).toFixed(6));
  run.freeTierNote = settings.freeTierNote || null;
  run.judgeModelsUsed = [...new Set(results.map((q) => q.judgeCall?.servedBy).filter(Boolean))];
  run.judgeCostUsd = Number(results.reduce((s, q) => s + (q.judgeCall?.costUsd || 0), 0).toFixed(6));

  saveRun(run);
  emit("done", { id: run.id, summary: run.summary, durationMs: run.durationMs, judgeCostUsd: run.judgeCostUsd });
  return run;
}

/** Re-grade a saved run's answers with the current judge/rubric — no new contestant calls. */
async function rejudgeRun(sourceRun, emit = () => {}) {
  const { judge, settings } = loadConfig();
  if (!judge.available) throw new Error(`Judge needs an API key for ${judge.provider}`);
  const dataset = sourceRun.dataset.id;
  const def = getDataset(dataset);
  if (!def) throw new Error(`Dataset "${dataset}" no longer exists`);
  const run = JSON.parse(JSON.stringify(sourceRun));
  run.id = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  run.rejudgedFrom = sourceRun.id;
  run.judge = { label: judge.label, provider: judge.provider, model: judge.model };
  run.criteria = def.criteria.map(({ key, label, max }) => ({ key, label, max }));
  run.startedAt = new Date().toISOString();
  for (let i = 0; i < run.questions.length; i++) {
    const q = run.questions[i];
    q.answers.forEach((a) => delete a.grade);
    const good = q.answers.filter((a) => a.ok);
    try {
      const judged = await judgeQuestion(q, good.map((a) => ({ key: a.key, text: a.text })), {
        judge,
        rubric: def.rubric,
        criteria: def.criteria,
        seed: i + 11
      });
      q.judgeCall = judged.judgeCall;
      for (const a of q.answers) if (judged.grades[a.key]) a.grade = judged.grades[a.key];
      emit("judged", { questionId: q.id, grades: judged.grades });
    } catch (error) {
      emit("judge_error", { questionId: q.id, error: error.message });
    }
  }
  const contestants = run.contestants;
  run.summary = summarise(contestants, run.questions, settings);
  run.method.tiers = settings.accuracyGate
    ? `Production > 85, Analysis > 70 (composite), capped by accuracy: Production needs >= ${settings.accuracyGate.production}% judged accuracy, Analysis >= ${settings.accuracyGate.analysis}%. Ranked by accuracy first.`
    : run.method.tiers;
  run.judgeModelsUsed = [...new Set(run.questions.map((q) => q.judgeCall?.servedBy).filter(Boolean))];
  run.judgeCostUsd = Number(run.questions.reduce((s, q) => s + (q.judgeCall?.costUsd || 0), 0).toFixed(6));
  run.finishedAt = new Date().toISOString();
  saveRun(run);
  return run;
}

function saveRun(run) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2));
}

function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
        return { id: r.id, startedAt: r.startedAt, dataset: r.dataset, models: r.contestants.length, leader: r.summary?.[0]?.label || null };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadRun(id) {
  const runs = listRuns();
  const target = id === "latest" || !id ? runs[0]?.id : id;
  if (!target || !/^run-[\w-]+$/.test(target)) return null;
  const file = path.join(RUNS_DIR, `${target}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

module.exports = { runLiveBenchmark, rejudgeRun, listRuns, loadRun, summarise, tierFor, gatedTier };
