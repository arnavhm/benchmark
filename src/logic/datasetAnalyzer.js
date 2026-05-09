const { analyzeDatasetWithLLM } = require("./llmDatasetAnalyzer");

const TASK_KEYWORDS = {
  coding: ["code", "function", "python", "javascript", "class", "bug", "algorithm", "return", "compile"],
  math: ["solve", "calculate", "equation", "probability", "sum", "integer", "algebra", "geometry", "answer"],
  reasoning: ["infer", "therefore", "because", "premise", "conclusion", "which statement", "best explanation"],
  chat: ["assistant", "user", "conversation", "reply", "respond", "customer", "support", "message"]
};

function stringifySample(sample) {
  return typeof sample === "string" ? sample : JSON.stringify(sample);
}

function detectFormat(samplesText) {
  const lower = samplesText.toLowerCase();
  if (/```|def |function |class |return |console\.log/.test(lower)) return "code";
  if (/\b(a\)|b\)|c\)|d\)|multiple choice|options?)\b/.test(lower)) return "MCQ";
  if (/\b(user|assistant|system):|\bmessages?\b|\bconversation\b/.test(lower)) return "conversational";
  if (/\?|expected_answer|answer|output/.test(lower)) return "open-ended";
  return "unknown";
}

function detectDifficulty(samplesText, records) {
  const lower = samplesText.toLowerCase();
  const avgLength = records.length
    ? records.map((sample) => stringifySample(sample).length).reduce((sum, value) => sum + value, 0) / records.length
    : 0;

  if (/\bhard|advanced|expert|prove|optimi[sz]e|multi-step\b/.test(lower) || avgLength > 700) return "hard";
  if (/\beasy|basic|simple|beginner\b/.test(lower) || avgLength < 180) return "easy";
  return "medium";
}

function detectTaskType(samplesText) {
  const lower = samplesText.toLowerCase();
  const scores = Object.entries(TASK_KEYWORDS).map(([type, keywords]) => ({
    type,
    score: keywords.reduce((count, keyword) => count + (lower.includes(keyword) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);

  if (!scores[0] || scores[0].score === 0) return { type: "unclear", confidence: 0.35 };
  if (scores[1] && scores[0].score - scores[1].score <= 1) {
    return { type: "unclear", confidence: 0.48 };
  }

  return { type: scores[0].type, confidence: Math.min(0.9, 0.55 + scores[0].score * 0.08) };
}

function analyzeDatasetRuleBased(records, manualTaskType) {
  const samples = records.slice(0, 10);
  const samplesText = samples.map(stringifySample).join("\n\n");
  const detected = manualTaskType
    ? { type: manualTaskType, confidence: 0.82 }
    : detectTaskType(samplesText);
  const format = detectFormat(samplesText);
  const difficulty = detectDifficulty(samplesText, records);

  return {
    type: detected.type,
    difficulty,
    format,
    size: records.length,
    reasoning_required: detected.type === "reasoning" || detected.type === "math" || difficulty === "hard",
    confidence: Number(detected.confidence.toFixed(2)),
    analyzer: manualTaskType ? "manual" : "rule-based",
    rationale: manualTaskType
      ? `User selected ${manualTaskType} as the dataset type.`
      : `Detected from keywords, structure, and sample length across the first ${samples.length} samples.`
  };
}

async function analyzeDataset(records, options = {}) {
  if (options.manualTaskType) {
    return analyzeDatasetRuleBased(records, options.manualTaskType);
  }

  if (options.useLLM !== false) {
    try {
      const llmResult = await analyzeDatasetWithLLM(records.slice(0, 10));
      if (llmResult) {
        return {
          type: llmResult.type,
          difficulty: llmResult.difficulty,
          format: llmResult.format,
          size: records.length,
          reasoning_required: llmResult.reasoning_required,
          confidence: Math.max(0, Math.min(1, Number(llmResult.confidence))),
          analyzer: "gemini",
          rationale: llmResult.rationale
        };
      }
    } catch (error) {
      console.warn(`[Dataset Analyzer] LLM fallback: ${error.message}`);
    }
  }

  return analyzeDatasetRuleBased(records);
}

module.exports = {
  analyzeDataset,
  analyzeDatasetRuleBased
};
