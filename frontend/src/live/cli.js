#!/usr/bin/env node
/**
 * Run a live benchmark from the terminal (same engine as the dashboard) and save it.
 *   npm run live                      # aviation, all questions
 *   npm run live -- math 3            # dataset, question limit
 *   npm run live -- --check           # only verify model ids against each provider
 */
const fs = require("fs");
const path = require("path");

const { loadEnv, keyReport } = require("./env");
const envFiles = loadEnv();
if (process.argv.includes("--check")) {
  console.log(envFiles.length ? `Loaded .env from: ${envFiles.join(", ")}` : "No .env file found - create one in the project root (copy .env.example).");
  console.log(`API keys:\n${keyReport()}\n`);
}

const { loadConfig } = require("./config");
const { listModels } = require("./providers");
const { runLiveBenchmark, rejudgeRun, loadRun } = require("./runner");

async function check() {
  const { contestants, judge } = loadConfig();
  const all = [...contestants, { ...judge, key: "judge" }];
  for (const c of [...contestants, judge]) for (const f of c.fallbacks || []) all.push({ ...f, key: "fallback", fallback: true });
  const lists = {};
  for (const p of new Set(all.map((c) => c.provider))) lists[p] = await listModels(p);
  for (const c of all) {
    const l = lists[c.provider];
    const ok = l.ok && l.ids.includes(c.model);
    console.log(`${ok ? "OK  " : "FAIL"} ${c.provider.padEnd(10)} ${c.fallback ? "(fallback) " : ""}${c.model}${ok ? "" : `  (${l.ok ? "id not found" : l.error})`}`);
  }
  for (const [p, l] of Object.entries(lists)) {
    const failed = all.some((c) => c.provider === p && l.ok && !l.ids.includes(c.model));
    if (!failed) continue;
    const ids = l.ids.filter((id) => !/whisper|tts|guard|embed|playai|orpheus|compound/i.test(id));
    console.log(`\nText models available on ${p} (${ids.length}):`);
    console.log(ids.length > 60 ? ids.filter((id) => /llama|qwen|kimi|mistral|gemma|deepseek/i.test(id)).join("\n") : ids.join("\n"));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return check();
  if (args[0] === "--list") {
    const l = await listModels(args[1] || "openrouter");
    if (!l.ok) return console.log(l.error);
    const re = new RegExp(args[2] || ".", "i");
    return console.log(l.ids.filter((id) => re.test(id)).sort().join("\n"));
  }
  const onEvent = (type, p) => {
    if (type === "answer") console.log(`${p.ok ? "answer" : "ERROR "} ${p.questionId} ${p.key}${p.ok ? ` ${p.latencyMs}ms${p.fallbackUsed ? ` [fallback: ${p.servedBy}]` : ""}` : `: ${String(p.error).slice(0, 200)}`}`);
    if (type === "judged") console.log(`judged ${p.questionId}`);
    if (type === "judge_error") console.log(`JUDGE ERROR ${p.questionId}: ${p.error}`);
  };
  const started = Date.now();
  let run;
  if (args[0] === "--rejudge") {
    const source = loadRun(args[1] || "latest");
    if (!source) throw new Error("No saved run to re-judge.");
    console.log(`Re-judging ${source.id} (${source.questions.length} questions) with the current judge...`);
    run = await rejudgeRun(source, onEvent);
  } else {
    const [dataset = "aviation", limit = "0"] = args;
    run = await runLiveBenchmark({ dataset, limit: Number(limit) }, onEvent);
  }
  console.log(`\nSaved ${run.id} in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (args[0] === "--rejudge") {
    for (const q of run.questions) for (const a of q.answers) if (a.grade) console.log(`${q.id} ${a.key.padEnd(14)} ${a.grade.score}/10 ${a.grade.breakdown ? `(${(run.criteria || []).map((c) => `${c.label} ${a.grade.breakdown[c.key]}/${c.max}`).join(", ")})` : ""} ${a.grade.rationale}`);
  }
  console.table(run.summary.map((m) => ({
    rank: m.rank, model: m.label, accuracy: m.accuracy, pass: m.passRate, "mean ms": m.latencyMs.mean,
    "$/answer": m.costUsd.perAnswer, composite: m.composite, tier: m.tier, errors: m.errors
  })));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
