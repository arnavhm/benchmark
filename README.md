# AI Benchmark Analyzer

Benchmark real LLMs **live** on any question set: every answer is graded **blind** by a separate judge model on explicit criteria,
timed per call and costed, with confidence intervals. Runs entirely on **free tiers** (Groq, Gemini, OpenRouter `:free`).

- ⚡ **Live Benchmark** — built-in datasets (aviation maintenance, math, logic, code review) or **upload your own** CSV/JSON in any domain.
- 📐 **Open scoring** — see [SCORING.md](SCORING.md): blind judge, per-criterion scores, bootstrap CIs, accuracy-gated tiers.
- 🔁 **Reliable demos** — retries, named backup models, and every run saved to `data/live_runs/` for offline replay.

Default lineup: Gemini 3.1 Flash-Lite · GPT-OSS 20B (Groq) · Qwen3.8 27B (Groq) · Nemotron 3 Super 120B (OpenRouter free).
Judge: GPT-OSS 120B (Groq). Change any of these in `data/live_models.json` — adding a paid model (GPT, Claude, …) is one entry plus a key.

## Quick start

Requirements: Node.js 18+.

```bash
git clone https://github.com/arnavhm/benchmark.git
cd benchmark
cp .env.example .env        # then paste your keys into .env (never commit it)
cd frontend && npm install
npm run live:check          # every line should say OK
npm start                   # open http://127.0.0.1:5002
```

Keys (all have free tiers):
| Variable | Get one at |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |

A provider without a key is simply skipped. The judge runs on Groq, so `GROQ_API_KEY` is required.

## Running the demo
1. `npm start` and open http://127.0.0.1:5002 — the **Live Benchmark** tab opens first.
2. Click **🔎 Check models** — all ✅.
3. Pick a dataset, set **Questions → First 3**, click **▶ Run live benchmark**. Answers stream in side by side, then the judge's scores (hover a score for the rationale).
4. Open **📐 How scoring works** to explain the method.
5. **➕ Benchmark on your own dataset** → upload `datasets/examples/sample_upload_general_knowledge.csv` (or any CSV with `question` and `answer` columns) and run it — any domain works.
6. If Wi-Fi or rate limits misbehave, click **⏪ Load last saved run** — no API calls needed.

Free-tier limits: OpenRouter `:free` models allow roughly 50 requests/day on accounts without credits; Gemini's free tier allows only a few requests per minute. Keep live runs short (3–5 questions).

## Command line
```bash
cd frontend
npm run live:check                  # verify model ids against each provider
npm run live -- aviation 3          # run a benchmark from the terminal (dataset, question limit)
npm run live -- --rejudge           # re-grade the latest saved run with the current judge (no new model calls)
npm run live -- --list openrouter ":free"   # list available model ids
npm test                            # unit + integration tests (use a fake provider server, no keys needed)
```

## Project layout
```
frontend/
  src/live/        live benchmark engine: providers, judge, runner, metrics, config, CLI
  src/routes/      Express routes (live.js = Live Benchmark API; rankings.js = reference/analyzer tabs)
  web/             dashboard (templates/index.html, static/live.js, static/live.css)
data/live_models.json   contestants, judge, fallbacks, settings
data/live_runs/         saved runs (JSON)
datasets/               built-in datasets; datasets/custom/ holds uploads; datasets/examples/ sample upload
backend/                earlier Python prototype (FastAPI/Flask) — not used by the dashboard
```

The **Reference Leaderboard** and **Dataset Analyzer** tabs are earlier features that work from curated reference scores (`data/models.json`),
not live calls; they are labelled as estimates in the UI. The earlier README is kept at `docs/LEGACY_README.md`.
