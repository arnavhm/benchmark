# How the Live Benchmark scores models

This file documents the full scoring engine so anyone can check how a number on the dashboard was produced.
Source: `frontend/src/live/` (`runner.js`, `judge.js`, `config.js`, `metrics.js`, `providers.js`).

## 1. Collecting answers
- Every question in the chosen dataset is sent to every contestant model with the same prompt:
  the question, a word limit (120 words) and a dataset-specific instruction (e.g. *"State the single most likely root cause and the specific inspection or maintenance action"* for aviation).
- Calls are real HTTP requests to Groq, OpenRouter and the Gemini API.
- **Latency** = wall-clock time of the successful API request.
- **Tokens** = the provider's own usage report. **Cost** = OpenRouter's billed cost when available, otherwise tokens × the paid-tier list price in `data/live_models.json`.
  All calls in the default setup run on free tiers, so the dashboard also shows the *actual* spend (normally $0).

## 2. Blind grading (LLM-as-judge)
- A separate **judge model** that is not competing grades the answers (default: GPT-OSS 120B on Groq).
- For each question the judge receives the question, the **reference answer**, and all answers labelled **A, B, C, D in a shuffled order**. It never sees model names.
- The judge scores each answer on **explicit criteria that sum to 10** and gives a ≤ 25-word rationale:

| Dataset | Criteria |
|---|---|
| Aviation maintenance | root cause /6 + maintenance action /4 |
| Pure math | final answer /7 + working /3 |
| Logic puzzles | conclusion /7 + reasoning /3 |
| Code review | issue identified /6 + fix /4 |
| Uploaded (any domain) | correctness /7 + completeness /3, plus the uploader's own grading guidance |

- Rubric rules, e.g. for aviation: any cause listed in the reference counts; equivalent terminology counts
  (*"No. 1 bearing" = "front bearing"*); a different component in the same engine system gets about half credit on cause; unsafe advice scores 0.
- Temperature 0, JSON output. The exact prompt is `buildPrompt()` in `frontend/src/live/judge.js`.

## 3. Metrics per model
| Metric | Definition |
|---|---|
| Judge accuracy | mean judge score × 10 (0–100) |
| 95% CI | bootstrap over questions, 2,000 resamples |
| Pass rate | share of answers scoring ≥ 7/10 |
| Lexical overlap | term-frequency cosine similarity with the reference (a cheap cross-check, not used for ranking) |
| Latency | mean and p95 over answered questions |
| Cost / answer, cost / correct | paid-tier equivalent (see above) |

## 4. Composite, ranking and tiers
- **Composite** = 0.625 × accuracy + 0.375 × speed, where speed = 100 × (1 − mean latency / 10 s), floored at 0.
  (These are the original 0.5 / 0.3 accuracy/latency weights re-normalised; cost is excluded because every call is free.)
  Set `"costInComposite": true` in `data/live_models.json` to use 0.5 × accuracy + 0.3 × speed + 0.2 × cost.
- **Ranking is by accuracy first**, composite breaks ties.
- **Tiers**: Production > 85 composite, Analysis > 70, else Research — **capped by accuracy**:
  Production needs ≥ 85% accuracy and Analysis ≥ 70%. A fast but wrong model can never be "Production".

## 5. Reliability and transparency
- Rate limits (HTTP 429) with a short "try again in …" are retried; overloads (5xx, timeouts) fall back to a **named backup model**
  (e.g. Gemini Flash-Lite → Gemini 3.5 Flash). Every backup answer is flagged on the dashboard with the model that actually answered.
- Every run is saved as JSON in `data/live_runs/` (answers, tokens, latency, per-criterion grades, judge rationale) and can be replayed offline
  or re-graded with a different judge: `npm run live -- --rejudge`.

## Known limitations
- The judge is itself a language model; its grades are only as good as the reference answers and rubric.
  GPT-OSS 120B shares a model family with the GPT-OSS 20B contestant.
- Free tiers have rate limits, so large runs may take longer or use backup models (always shown).
- Small datasets give wide confidence intervals; the CI column shows this honestly.
