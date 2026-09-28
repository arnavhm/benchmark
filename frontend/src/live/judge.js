/**
 * Blind LLM-as-judge.
 *
 * For each question the judge sees the reference answer and all contestant answers
 * labelled A, B, C, ... in a shuffled order — never the model names — and returns a
 * 0-10 rubric score per answer. One judge call per question grades every answer,
 * so all models are scored against each other on the same scale.
 */
const { callModel } = require("./providers");
const { seededRng } = require("./metrics");

const JUDGE_SYSTEM =
  "You are a strict, impartial evaluator for an LLM benchmark. You grade answers against a reference answer " +
  "written by a domain expert. You do not know which model wrote which answer. Judge substance, not length or style. " +
  "Respond with JSON only.";

function shuffleLabels(answers, seed) {
  const rng = seededRng(seed);
  const arr = [...answers];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((a, i) => ({ ...a, label: String.fromCharCode(65 + i) }));
}

function buildPrompt(question, rubric, labelled, criteria) {
  const blocks = labelled.map((a) => `### Answer ${a.label}\n${a.text}`).join("\n\n");
  if (criteria && criteria.length) {
    const lines = criteria.map((c) => `- ${c.key} (0-${c.max}): ${c.desc}`).join("\n");
    const shape = criteria.map((c) => `"${c.key}":0`).join(",");
    return `${rubric}

Score each answer on these criteria (they sum to 10):
${lines}

## Question
${question.question}

## Reference answer
${question.reference}

${blocks}

Return JSON exactly in this shape:
{"grades":[{"id":"A",${shape},"verdict":"correct|partial|incorrect","rationale":"max 25 words"}]}
Include one entry for every answer (${labelled.map((a) => a.label).join(", ")}).`;
  }
  return `${rubric}

Scoring rubric (0-10):
- 9-10: same root cause / final answer as the reference AND the correct action; nothing wrong or unsafe.
- 7-8: correct core answer, minor detail missing or slightly imprecise.
- 4-6: partially correct or too generic to act on.
- 1-3: mostly incorrect, with a fragment of the right idea.
- 0: wrong, empty, refuses, or gives unsafe advice.

## Question
${question.question}

## Reference answer (expert)
${question.reference}

${blocks}

Return JSON exactly in this shape:
{"grades":[{"id":"A","score":0,"verdict":"correct|partial|incorrect","rationale":"max 25 words"}]}
Include one entry for every answer (${labelled.map((a) => a.label).join(", ")}).`;
}

function parseJson(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  return JSON.parse(body);
}

/**
 * @param question {id, question, reference}
 * @param answers  [{key, text}] — only successful answers
 * @returns {grades: {[key]: {score, verdict, rationale, label}}, judgeCall}
 */
async function judgeQuestion(question, answers, { judge, rubric, criteria = null, seed = 1 }) {
  if (!answers.length) return { grades: {}, judgeCall: null };
  const labelled = shuffleLabels(answers, seed);
  const prompt = buildPrompt(question, rubric, labelled, criteria);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const call = await callModel(judge.provider, {
        model: judge.model,
        system: JUDGE_SYSTEM,
        prompt,
        maxTokens: 8192,
        temperature: 0,
        // If strict JSON mode was rejected (HTTP 400) on the first try, retry as plain text; the parser handles both.
        json: !(lastError && lastError.status === 400),
        extra: judge.extra,
        pricing: judge.pricing,
        fallbacks: judge.fallbacks
      });
      const parsed = parseJson(call.text);
      const grades = {};
      for (const g of parsed.grades || []) {
        const match = labelled.find((a) => a.label === String(g.id).trim().toUpperCase());
        if (!match) continue;
        const num = (x) => {
          const n = parseFloat(String(x ?? "").replace(/\/.*$/, ""));
          return Number.isFinite(n) ? n : null;
        };
        let raw = num(g.score);
        let breakdown = null;
        if (criteria && criteria.some((c) => g[c.key] !== undefined)) {
          breakdown = {};
          raw = 0;
          for (const c of criteria) {
            const v = Math.max(0, Math.min(c.max, num(g[c.key]) ?? 0));
            breakdown[c.key] = v;
            raw += v;
          }
        }
        const score = Math.max(0, Math.min(10, raw ?? 0));
        grades[match.key] = {
          score,
          breakdown,
          verdict: g.verdict || (score >= 7 ? "correct" : score >= 4 ? "partial" : "incorrect"),
          rationale: String(g.rationale || "").slice(0, 300),
          label: match.label
        };
      }
      const missing = labelled.filter((a) => !grades[a.key]);
      if (missing.length) throw new Error(`Judge skipped answers ${missing.map((m) => m.label).join(", ")}`);
      return {
        grades,
        judgeCall: { latencyMs: call.latencyMs, costUsd: call.costUsd, inputTokens: call.inputTokens, outputTokens: call.outputTokens, servedBy: call.servedBy.model, fallbackUsed: call.fallbackUsed }
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { judgeQuestion, buildPrompt, shuffleLabels, JUDGE_SYSTEM };
