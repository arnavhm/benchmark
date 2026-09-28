const fs = require("fs");
const path = require("path");
const { PROVIDERS, hasKey } = require("./providers");

const ROOT = path.join(__dirname, "..", "..", "..");
const CONFIG_PATH = path.join(ROOT, "data", "live_models.json");
const RUNS_DIR = process.env.LIVE_RUNS_DIR || path.join(ROOT, "data", "live_runs");
const CUSTOM_DIR = process.env.LIVE_CUSTOM_DATASETS_DIR || path.join(ROOT, "datasets", "custom");

/**
 * Each dataset is graded on explicit criteria whose maxima sum to 10.
 * The judge scores every criterion separately; the total is the answer's score.
 */
const GENERIC_CRITERIA = [
  { key: "correctness", label: "correct", max: 7, desc: "7 = the core answer/claim matches the reference (or is equivalent); partial for partly right; 0 = wrong or contradicts the reference" },
  { key: "completeness", label: "complete", max: 3, desc: "3 = covers the key points of the reference without adding errors; 0 = misses them or adds wrong/unsafe content" }
];

const BUILT_IN = {
  aviation: {
    label: "Aviation maintenance fault diagnosis",
    file: "aviation_maintenance_faults.json",
    instruction: "State the single most likely root cause and the specific inspection or maintenance action.",
    rubric:
      "This is an aircraft engine maintenance diagnosis task. Judge like a senior licensed engineer (B1). " +
      "The reference may list several acceptable causes joined by 'or' - an answer that commits to ANY of them is correct on root cause. " +
      "Accept equivalent terminology and closely related mechanisms (e.g. 'No. 1 bearing' = 'front bearing' = 'fan/N1 front bearing'; " +
      "'compressor fouling/erosion/blade damage' falls under 'compressor degradation'). Penalise unsafe advice.",
    criteria: [
      { key: "root_cause", label: "cause", max: 6, desc: "6 = matches any cause in the reference (or an equivalent term); about 3 = a different component or mechanism within the SAME engine system (systems: compressor, combustor, turbine, fan/rotor & bearings, oil system, fuel system, ignition/start, sensors/indication); 0 = a different system or wrong" },
      { key: "action", label: "action", max: 4, desc: "4 = the inspection/maintenance action a licensed engineer would take per the reference; partial for generic but safe actions; 0 = wrong or unsafe" }
    ]
  },
  math: {
    label: "Pure math",
    file: "dataset_pure_math.json",
    instruction: "Show brief working, then give the final answer on its own line.",
    rubric: "This is a math task. Mathematically equivalent forms of the final answer count as correct (e.g. 0.5 = 1/2, reordered terms).",
    criteria: [
      { key: "final_answer", label: "answer", max: 7, desc: "7 = final answer equals the reference (any equivalent form); 0 = different final answer, even if the method looks right" },
      { key: "working", label: "working", max: 3, desc: "3 = working is valid and supports the answer; 0 = missing or contains errors" }
    ]
  },
  logic: {
    label: "Logic puzzles",
    file: "dataset_logic_puzzles.json",
    instruction: "Give brief reasoning, then the final conclusion.",
    rubric: "This is a logic/reasoning puzzle.",
    criteria: [
      { key: "conclusion", label: "conclusion", max: 7, desc: "7 = conclusion matches the reference; 0 = different conclusion" },
      { key: "reasoning", label: "reasoning", max: 3, desc: "3 = reasoning is valid and consistent; 0 = contradictory or missing" }
    ]
  },
  code_review: {
    label: "Code review",
    file: "dataset_code_review.json",
    instruction: "Name the bug or issue (or say there is none) and the fix.",
    rubric: "This is a code review task. If the reference says there is no bug, an answer that invents a bug is wrong.",
    criteria: [
      { key: "issue", label: "issue", max: 6, desc: "6 = identifies the same bug/issue as the reference (or correctly says there is none); 0 = wrong issue" },
      { key: "fix", label: "fix", max: 4, desc: "4 = a correct fix for that issue; 0 = no fix or an incorrect one" }
    ]
  }
};

const pick = (row, keys) => {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
};

/** Normalise any row shape into {id, question, reference, difficulty}. */
function normaliseRows(rows) {
  return (rows || [])
    .map((r, i) => {
      if (typeof r !== "object" || r === null) return null;
      return {
        id: String(pick(r, ["id", "qid", "question_id"]) || i + 1),
        question: pick(r, ["question", "prompt", "input", "query", "q", "instruction", "task"]),
        reference: pick(r, ["ground_truth", "expected_answer", "reference", "answer", "expected", "output", "target", "solution", "label"]),
        difficulty: (pick(r, ["difficulty", "level"]) || "unknown").toLowerCase()
      };
    })
    .filter((r) => r && r.question && r.reference);
}

function loadCustomDatasets() {
  if (!fs.existsSync(CUSTOM_DIR)) return {};
  const out = {};
  for (const f of fs.readdirSync(CUSTOM_DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, f), "utf8"));
      const id = `custom:${f.replace(/\.json$/, "")}`;
      out[id] = {
        label: `${d.name || f} (uploaded)`,
        custom: true,
        path: path.join(CUSTOM_DIR, f),
        instruction: "Answer directly and concisely.",
        rubric: d.rubric ? `Task-specific grading guidance from the dataset author: ${d.rubric}` : "Grade against the reference answer.",
        criteria: GENERIC_CRITERIA
      };
    } catch { /* skip unreadable file */ }
  }
  return out;
}

function getDatasets() {
  return { ...BUILT_IN, ...loadCustomDatasets() };
}

function getDataset(id) {
  return getDatasets()[id] || null;
}

function loadDataset(id) {
  const def = getDataset(id);
  if (!def) throw new Error(`Unknown dataset "${id}"`);
  const file = def.path || path.join(ROOT, "datasets", def.file);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return normaliseRows(Array.isArray(raw) ? raw : raw.questions || raw.data || []);
}

const slug = (s) => String(s || "dataset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "dataset";

/** Save an uploaded dataset; returns its id. */
function saveCustomDataset({ name, rubric, rows }) {
  const questions = normaliseRows(rows).slice(0, 100);
  if (!questions.length) {
    throw new Error("No usable rows. Each row needs a question (question/prompt/input) and a reference answer (answer/expected_answer/ground_truth/reference).");
  }
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  const base = slug(name);
  fs.writeFileSync(
    path.join(CUSTOM_DIR, `${base}.json`),
    JSON.stringify({ name: name || base, rubric: rubric || "", createdAt: new Date().toISOString(), questions }, null, 2)
  );
  return { id: `custom:${base}`, size: questions.length };
}

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const contestants = (raw.contestants || []).map((c) => ({
    ...c,
    model: (c.envModel && process.env[c.envModel]) || c.model,
    available: hasKey(c.provider)
  }));
  const judgeProvider = (raw.judge.envProvider && process.env[raw.judge.envProvider]) || raw.judge.provider;
  const judgeModel = (raw.judge.envModel && process.env[raw.judge.envModel]) || raw.judge.model;
  const judgeOverridden = judgeProvider !== raw.judge.provider || judgeModel !== raw.judge.model;
  const judge = {
    ...raw.judge,
    provider: judgeProvider,
    model: judgeModel,
    label: judgeOverridden ? `${judgeModel} (blind judge)` : raw.judge.label,
    pricing: raw.judge.pricing || contestants.find((c) => c.provider === judgeProvider && c.model === judgeModel)?.pricing || null,
    available: hasKey(judgeProvider)
  };
  return { contestants, judge, settings: raw.settings || {} };
}

function providerStatus() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, envKey: p.envKey, keySet: hasKey(id) }])
  );
}

module.exports = {
  ROOT, RUNS_DIR, CUSTOM_DIR, GENERIC_CRITERIA,
  getDatasets, getDataset, loadDataset, saveCustomDataset, normaliseRows,
  loadConfig, providerStatus
};
