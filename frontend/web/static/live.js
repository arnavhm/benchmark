/* ═══════════════════════════════════════════════════════════════════════════
   Live Benchmark tab — real model calls streamed from /api/live/run (SSE)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { config: null, run: null, source: null, startedAt: 0, timer: null, chart: null };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtMs = (ms) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);
  const fmtUsd = (x) => {
    if (x == null) return "—";
    if (x === 0) return "$0";
    if (x < 0.01) return `$${x.toFixed(5)}`;
    return `$${x.toFixed(4)}`;
  };
  const scoreClass = (s) => (s >= 7 ? "good" : s >= 4 ? "mid" : "bad");
  const PALETTE = ["#4285f4", "#00cec9", "#fdcb6e", "#e17055", "#a29bfe", "#00b894"];

  function formatAnswer(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n{2,}/g, "<br><br>")
      .replace(/\n/g, "<br>");
  }

  // ── Config / status ──────────────────────────────────────────────────────
  async function loadKeys() {
    try {
      const k = await (await fetch("/api/live/keys")).json();
      const entries = Object.entries(k.keys);
      const setCount = entries.filter(([, v]) => v.set).length;
      $("live-keys-file").textContent = k.envFile;
      $("live-keys-summary").innerHTML = entries
        .map(([name, v]) => `<span class="${v.set ? "" : "live-warn"}">${esc(name.replace("_API_KEY", ""))} ${v.set ? `✓ ${esc(v.hint)}` : "✗ missing"}</span>`)
        .join(" · ");
      if (setCount < entries.length && !state.keysOpened) { $("live-keys").open = true; state.keysOpened = true; }
    } catch { /* older server */ }
  }

  async function saveKeys(e) {
    e.preventDefault();
    const form = $("live-keys-form");
    const body = {};
    for (const input of form.querySelectorAll("input")) if (input.value.trim()) body[input.name] = input.value.trim();
    const status = $("live-keys-status");
    if (!Object.keys(body).length) { status.innerHTML = '<span class="live-warn">Paste at least one key.</span>'; return; }
    status.innerHTML = '<span class="live-muted">Saving…</span>';
    try {
      const res = await fetch("/api/live/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      form.reset();
      status.innerHTML = `✅ Saved ${data.saved.length} key(s). Now click <strong>🔎 Check models</strong>.`;
      await loadConfig();
    } catch (err) {
      status.innerHTML = `<span class="live-warn">❌ ${esc(err.message)}</span>`;
    }
  }

  async function loadConfig() {
    loadKeys();
    const res = await fetch("/api/live/config");
    state.config = await res.json();
    renderStatus();
    renderDatasetOptions();
    $("live-replay-btn").disabled = !state.config.runs.length;
    if (state.config.runs.length) {
      $("live-replay-btn").title = `Last run: ${new Date(state.config.runs[0].startedAt).toLocaleString()}`;
    }
  }

  function renderStatus() {
    const { providers, contestants, judge } = state.config;
    const chips = Object.entries(providers)
      .map(([id, p]) => `<span class="live-chip ${p.keySet ? "live-chip--ok" : "live-chip--off"}" title="${esc(p.envKey)}">
          <span class="live-chip__dot"></span>${esc(p.label)} ${p.keySet ? "key set" : "no key"}</span>`)
      .join("");
    const models = contestants
      .map((c, i) => `<span class="live-model-pill ${c.available ? "" : "live-model-pill--off"}" style="--pill:${PALETTE[i % PALETTE.length]}">
          ${esc(c.label)}<small>${esc(c.model)}</small></span>`)
      .join("");
    $("live-status").innerHTML = `
      <div class="live-status__row">${chips}</div>
      <div class="live-status__row live-status__models">${models}</div>
      <div class="live-status__judge">⚖️ Judge: <strong>${esc(judge.label)}</strong> <code>${esc(judge.model)}</code>
        ${judge.available ? "" : '<span class="live-warn">no key for judge provider</span>'}</div>`;
    const anyReady = contestants.some((c) => c.available) && judge.available;
    $("live-run-btn").disabled = !anyReady;
    if (anyReady && /No API keys yet/.test($("live-note").textContent)) $("live-note").innerHTML = "";
    if (!anyReady) {
      $("live-note").innerHTML = "No API keys yet — paste them in <strong>🔑 API keys</strong> above (no restart needed). You can still replay a saved run.";
    }
  }

  function renderDatasetOptions(selectId) {
    const current = selectId || $("live-dataset").value;
    const opt = (d) => `<option value="${esc(d.id)}">${esc(d.label)} (${d.size} questions)</option>`;
    const builtIn = state.config.datasets.filter((d) => !d.custom);
    const custom = state.config.datasets.filter((d) => d.custom);
    $("live-dataset").innerHTML =
      `<optgroup label="Built-in">${builtIn.map(opt).join("")}</optgroup>` +
      (custom.length ? `<optgroup label="Uploaded">${custom.map(opt).join("")}</optgroup>` : "");
    if (current && state.config.datasets.some((d) => d.id === current)) $("live-dataset").value = current;
    renderCriteriaHint();
  }

  function renderCriteriaHint() {
    const d = state.config?.datasets.find((x) => x.id === $("live-dataset").value);
    $("live-criteria").innerHTML = d
      ? `Graded on: ${d.criteria.map((c) => `<strong>${esc(c.label)}</strong> /${c.max}`).join(" + ")} = /10`
      : "";
  }

  async function uploadDataset(e) {
    e.preventDefault();
    const file = $("live-upload-file").files[0];
    const status = $("live-upload-status");
    if (!file) { status.innerHTML = '<span class="live-warn">Choose a JSON or CSV file first.</span>'; return; }
    const form = new FormData();
    form.append("file", file);
    form.append("name", $("live-upload-name").value || file.name.replace(/\.[^.]+$/, ""));
    form.append("rubric", $("live-upload-rubric").value);
    status.innerHTML = '<span class="live-muted">Uploading…</span>';
    try {
      const res = await fetch("/api/live/datasets", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      status.innerHTML = `✅ Added <strong>${esc(data.name)}</strong> — ${data.size} questions. Selected below.`;
      await loadConfig();
      renderDatasetOptions(data.id);
    } catch (err) {
      status.innerHTML = `<span class="live-warn">❌ ${esc(err.message)}</span>`;
    }
  }

  // ── Preflight ────────────────────────────────────────────────────────────
  async function preflight() {
    const btn = $("live-check-btn");
    btn.disabled = true;
    btn.textContent = "Checking…";
    $("live-preflight").style.display = "block";
    $("live-preflight").innerHTML = '<div class="live-muted">Asking each provider for its model list…</div>';
    try {
      const data = await (await fetch("/api/live/preflight")).json();
      const row = (c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✅" : "❌"} <strong>${esc(c.label)}</strong> <code>${esc(c.model)}</code>
          ${c.ok ? "" : `— ${esc(c.reason)}${c.suggestions?.length ? `<br><span class="live-muted">Available ids: ${c.suggestions.map((s) => `<code>${esc(s)}</code>`).join(" ")}</span>` : ""}`}</li>`;
      $("live-preflight").innerHTML = `<ul class="live-preflight__list">${data.contestants.map(row).join("")}${row({ ...data.judge, label: "Judge · " + data.judge.label })}</ul>
        <div class="live-muted">Fix a failing id in <code>data/live_models.json</code> (or the <code>LIVE_*_MODEL</code> env vars) and restart.</div>`;
    } catch (e) {
      $("live-preflight").innerHTML = `<div class="live-warn">Preflight failed: ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "🔎 Check models";
    }
  }

  // ── Live run (SSE) ───────────────────────────────────────────────────────
  function startRun() {
    if (state.source) return;
    const dataset = $("live-dataset").value;
    const limit = $("live-limit").value;
    state.run = null;
    $("live-preflight").style.display = "none";
    $("live-note").innerHTML = "";
    $("live-chart-card").style.display = "none";
    $("live-method").innerHTML = "";
    $("live-results").style.display = "block";
    $("live-leaderboard").innerHTML = '<div class="live-muted">Waiting for answers…</div>';
    $("live-questions").innerHTML = "";
    $("live-run-btn").disabled = true;
    $("live-run-btn").textContent = "⏳ Running…";
    $("live-progress").style.display = "block";
    state.startedAt = Date.now();
    clearInterval(state.timer);
    state.timer = setInterval(updateProgress, 250);

    const src = new EventSource(`/api/live/run?dataset=${encodeURIComponent(dataset)}&limit=${encodeURIComponent(limit)}`);
    state.source = src;
    src.addEventListener("start", (e) => onStart(JSON.parse(e.data)));
    src.addEventListener("answer_start", (e) => onAnswerStart(JSON.parse(e.data)));
    src.addEventListener("answer", (e) => onAnswer(JSON.parse(e.data)));
    src.addEventListener("judge_start", (e) => onJudgeStart(JSON.parse(e.data)));
    src.addEventListener("judged", (e) => onJudged(JSON.parse(e.data)));
    src.addEventListener("judge_error", (e) => onJudgeError(JSON.parse(e.data)));
    src.addEventListener("done", (e) => onDone(JSON.parse(e.data)));
    src.addEventListener("fatal", (e) => finish(JSON.parse(e.data).error));
    src.onerror = () => { if (state.source) finish("Connection to the server was lost."); };
  }

  function finish(error) {
    if (state.source) state.source.close();
    state.source = null;
    clearInterval(state.timer);
    updateProgress();
    $("live-run-btn").disabled = false;
    $("live-run-btn").textContent = "▶ Run live benchmark";
    if (error) $("live-note").innerHTML = `<span class="live-warn">⚠️ ${esc(error)}</span>`;
  }

  function onStart(msg) {
    state.run = { ...msg, answers: {}, grades: {}, judging: {}, judgeErrors: {} };
    $("live-note").innerHTML = msg.skipped?.length
      ? `<span class="live-muted">Skipped: ${msg.skipped.map((s) => `${esc(s.label)} (${esc(s.reason)})`).join(", ")}</span>`
      : "";
    renderRunHeader(msg);
    renderQuestionShells();
  }

  function onAnswerStart({ questionId, key }) {
    const cell = document.querySelector(`[data-cell="${CSS.escape(questionId)}|${CSS.escape(key)}"]`);
    if (cell) cell.classList.add("live-answer--pending");
  }

  function onAnswer(a) {
    state.run.answers[`${a.questionId}|${a.key}`] = a;
    renderCell(a.questionId, a.key);
    renderLiveLeaderboard();
  }

  function onJudgeStart({ questionId }) {
    state.run.judging[questionId] = true;
    const el = document.querySelector(`[data-qstatus="${CSS.escape(questionId)}"]`);
    if (el) el.innerHTML = '<span class="live-spinner"></span> judging…';
  }

  function onJudged({ questionId, grades }) {
    state.run.judging[questionId] = false;
    Object.entries(grades).forEach(([key, g]) => { state.run.grades[`${questionId}|${key}`] = g; renderCell(questionId, key); });
    const el = document.querySelector(`[data-qstatus="${CSS.escape(questionId)}"]`);
    if (el) el.innerHTML = "✅ judged";
    renderLiveLeaderboard();
  }

  function onJudgeError({ questionId, error }) {
    state.run.judgeErrors[questionId] = error;
    const el = document.querySelector(`[data-qstatus="${CSS.escape(questionId)}"]`);
    if (el) el.innerHTML = `<span class="live-warn" title="${esc(error)}">judge failed</span>`;
  }

  async function onDone({ id }) {
    finish();
    const run = await (await fetch(`/api/live/runs/${encodeURIComponent(id)}`)).json();
    renderSavedRun(run, { live: true });
    loadConfig();
  }

  function updateProgress() {
    if (!state.run) return;
    const total = state.run.questions.length * state.run.contestants.length;
    const answered = Object.keys(state.run.answers).length;
    const judged = state.run.questions.filter((q) => state.run.judging[q.id] === false || state.run.judgeErrors[q.id]).length;
    const pct = total ? Math.round(((answered + judged * state.run.contestants.length) / (total * 2)) * 100) : 0;
    $("live-progress-fill").style.width = `${pct}%`;
    $("live-progress-text").textContent =
      `${answered}/${total} answers · ${judged}/${state.run.questions.length} questions judged · ${((Date.now() - state.startedAt) / 1000).toFixed(1)} s`;
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function renderRunHeader(run) {
    $("live-run-meta").innerHTML = `
      <span>📂 ${esc(run.dataset.label)} · ${run.dataset.size} questions</span>
      <span>🤖 ${run.contestants.length} models</span>
      <span>⚖️ ${esc(run.judge.label)}</span>
      ${run.startedAt ? `<span>🕒 ${new Date(run.startedAt).toLocaleString()}</span>` : ""}`;
  }

  function renderQuestionShells() {
    const run = state.run;
    $("live-questions").innerHTML = run.questions.map((q, qi) => `
      <article class="live-q">
        <header class="live-q__head">
          <span class="live-q__id">${esc(q.id)}</span>
          <span class="live-q__diff live-q__diff--${esc(q.difficulty)}">${esc(q.difficulty)}</span>
          <span class="live-q__status" data-qstatus="${esc(q.id)}">waiting…</span>
        </header>
        <p class="live-q__text">${esc(q.question)}</p>
        <details class="live-q__ref"><summary>Expert reference answer</summary><p>${esc(q.reference)}</p></details>
        <div class="live-q__answers" style="--cols:${run.contestants.length}">
          ${run.contestants.map((c, i) => `
            <div class="live-answer" data-cell="${esc(q.id)}|${esc(c.key)}" style="--pill:${PALETTE[i % PALETTE.length]}">
              <div class="live-answer__model">${esc(c.label)}</div>
              <div class="live-answer__body"><span class="live-muted">queued</span></div>
            </div>`).join("")}
        </div>
      </article>`).join("");
  }

  function renderCell(questionId, key) {
    const cell = document.querySelector(`[data-cell="${CSS.escape(questionId)}|${CSS.escape(key)}"]`);
    if (!cell) return;
    const a = state.run.answers[`${questionId}|${key}`];
    const g = state.run.grades[`${questionId}|${key}`];
    cell.classList.remove("live-answer--pending");
    if (!a) return;
    if (!a.ok) {
      cell.classList.add("live-answer--error");
      cell.querySelector(".live-answer__body").innerHTML = `<div class="live-warn">❌ ${esc(a.error)}</div>`;
      return;
    }
    cell.querySelector(".live-answer__body").innerHTML = `
      ${g ? `<div class="live-score live-score--${scoreClass(g.score)}" title="${esc(g.rationale)}">${g.score}/10 · ${esc(g.verdict)}${g.breakdown ? `<span class="live-score__parts">${(state.run.criteria || []).filter((c) => g.breakdown[c.key] !== undefined).map((c) => `${esc(c.label)} ${g.breakdown[c.key]}/${c.max}`).join(" · ")}</span>` : ""}</div>` : ""}
      <div class="live-answer__text">${formatAnswer(a.text)}</div>
      <div class="live-answer__meta">
        <span title="Wall-clock latency of the API call">⏱ ${fmtMs(a.latencyMs)}</span>
        <span title="${a.costSource === "billed" ? "Cost billed by provider" : "Tokens × list price"}">💲 ${fmtUsd(a.costUsd)}</span>
        <span title="Input / output tokens">🔤 ${a.inputTokens}/${a.outputTokens}</span>
      </div>
      ${a.fallbackUsed ? `<div class="live-fallback" title="Primary model was overloaded; this answer came from the backup model">↪ answered by <code>${esc(a.servedBy)}</code> (primary overloaded)</div>` : ""}
      ${g ? `<div class="live-answer__why">⚖️ ${esc(g.rationale)}</div>` : ""}`;
  }

  /** While running: provisional leaderboard from answers/grades received so far. */
  function renderLiveLeaderboard() {
    const run = state.run;
    const rows = run.contestants.map((c) => {
      const answers = run.questions.map((q) => run.answers[`${q.id}|${c.key}`]).filter((a) => a && a.ok);
      const grades = run.questions.map((q) => run.grades[`${q.id}|${c.key}`]).filter(Boolean);
      const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
      return {
        label: c.label,
        vendor: c.vendor,
        accuracy: grades.length ? avg(grades.map((g) => g.score * 10)) : null,
        graded: grades.length,
        latency: avg(answers.map((a) => a.latencyMs)),
        cost: avg(answers.filter((a) => a.costUsd != null).map((a) => a.costUsd)),
        answered: answers.length
      };
    }).sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
    $("live-leaderboard").innerHTML = `
      <div class="live-muted" style="margin-bottom:8px">Provisional — updates as answers and grades arrive</div>
      <table class="live-table"><thead><tr><th>Model</th><th>Judge accuracy</th><th>Mean latency</th><th>Cost / answer</th><th>Progress</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><strong>${esc(r.label)}</strong><div class="live-muted">${esc(r.vendor)}</div></td>
        <td>${r.accuracy == null ? "—" : r.accuracy.toFixed(1) + "%"}</td>
        <td>${fmtMs(r.latency == null ? null : Math.round(r.latency))}</td>
        <td>${fmtUsd(r.cost)}</td>
        <td>${r.answered} answered · ${r.graded} graded</td></tr>`).join("")}</tbody></table>`;
  }

  function renderFinalLeaderboard(run) {
    const leader = run.summary.find((m) => m.rank === 1);
    const tierClass = (t) => `tier-badge tier-${String(t || "research").toLowerCase()}`;
    $("live-leaderboard").innerHTML = `
      ${leader ? `<div class="live-winner">🏆 <strong>${esc(leader.label)}</strong> leads with composite ${leader.composite}
        — judge accuracy ${leader.accuracy}%${leader.accuracyCI ? ` (95% CI ${leader.accuracyCI.lower}–${leader.accuracyCI.upper})` : ""},
        mean latency ${fmtMs(leader.latencyMs.mean)}, ${fmtUsd(leader.costUsd.perAnswer)} per answer.</div>` : ""}
      <div class="live-table-wrap"><table class="live-table">
        <thead><tr>
          <th>#</th><th>Model</th><th title="Mean blind-judge score ×10, with 95% bootstrap CI over questions">Judge accuracy</th>
          <th title="Share of answers scored ≥ 7/10">Pass rate</th><th title="Word overlap with the expert reference">Lexical overlap</th>
          <th>Latency (mean / p95)</th><th title="What these calls would cost on a paid tier">Cost / answer<div class="live-muted">paid-tier equiv.</div></th><th>Cost / correct<div class="live-muted">paid-tier equiv.</div></th><th>Composite</th><th>Tier</th>
        </tr></thead>
        <tbody>${run.summary.map((m) => `<tr>
          <td>${m.rank ?? "—"}</td>
          <td><strong>${esc(m.label)}</strong><div class="live-muted">${esc(m.vendor)} · <code>${esc(m.model)}</code></div>${m.fallbacks ? `<div class="live-fallback">↪ ${m.fallbacks}/${m.answered} answers from backup ${m.fallbackModels.map((x) => `<code>${esc(x)}</code>`).join(" ")}</div>` : ""}</td>
          <td>${m.accuracy == null ? "—" : `<strong>${m.accuracy}%</strong>`}${m.accuracyCI ? `<div class="live-muted">${m.accuracyCI.lower}–${m.accuracyCI.upper}</div>` : ""}</td>
          <td>${m.passRate == null ? "—" : m.passRate + "%"}</td>
          <td>${m.lexical == null ? "—" : m.lexical + "%"}</td>
          <td>${fmtMs(m.latencyMs.mean)}<div class="live-muted">p95 ${fmtMs(m.latencyMs.p95)}</div></td>
          <td>${fmtUsd(m.costUsd.perAnswer)}<div class="live-muted">${m.costUsd.source === "billed" ? "billed" : "list price"}</div></td>
          <td>${fmtUsd(m.costUsd.perCorrect)}</td>
          <td><strong>${m.composite ?? "—"}</strong></td>
          <td>${m.tier ? `<span class="${tierClass(m.tier)}">${esc(m.tier)}</span>` : "—"}${m.errors ? `<div class="live-warn">${m.errors} errors</div>` : ""}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    renderChart(run);
    const spend = run.freeTierNote
      ? `<div class="live-free">💸 <strong>Actual spend for this run: $${(run.billedCostUsd || 0).toFixed(4)}</strong> — ${esc(run.freeTierNote)}</div>`
      : "";
    $("live-method").innerHTML = spend + `
      <strong>Method.</strong> ${esc(run.method.scoring)}. Composite = ${esc(run.method.composite)}. Tiers: ${esc(run.method.tiers)}.
      Accuracy CI: ${esc(run.method.ci)}. Latency is measured wall-clock per API call; cost is ${run.summary.some((m) => m.costUsd.source === "billed") ? "billed cost reported by OpenRouter, or " : ""}provider tokens × list price.
      Judge model(s) that graded: ${(run.judgeModelsUsed || []).map((x) => `<code>${esc(x)}</code>`).join(", ") || "—"}. Judge cost for this run: ${fmtUsd(run.judgeCostUsd)} · Run time: ${(run.durationMs / 1000).toFixed(1)} s · Run id <code>${esc(run.id)}</code>`;
  }

  function renderChart(run) {
    const canvas = $("live-chart");
    if (!window.Chart || !canvas) return;
    if (state.chart) state.chart.destroy();
    const pts = run.summary.filter((m) => m.accuracy != null && m.latencyMs.mean != null);
    state.chart = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: pts.map((m) => {
          const idx = run.contestants.findIndex((c) => c.key === m.key);
          const color = PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
          const cost = m.costUsd.perAnswer || 0;
          return {
            label: m.label,
            data: [{ x: m.latencyMs.mean / 1000, y: m.accuracy, r: 8 + Math.min(22, Math.sqrt(cost * 1e6) / 2), cost }],
            backgroundColor: color + "99",
            borderColor: color
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#a0a0b8" } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.y.toFixed(1)}% · ${ctx.raw.x.toFixed(2)} s · ${fmtUsd(ctx.raw.cost)}/answer` } }
        },
        scales: {
          x: { title: { display: true, text: "Mean latency (s) — lower is better", color: "#a0a0b8" }, ticks: { color: "#a0a0b8" }, grid: { color: "rgba(255,255,255,0.06)" }, beginAtZero: true },
          y: { title: { display: true, text: "Judge accuracy (%)", color: "#a0a0b8" }, ticks: { color: "#a0a0b8" }, grid: { color: "rgba(255,255,255,0.06)" }, min: 0, max: 100 }
        }
      }
    });
    $("live-chart-card").style.display = "block";
  }

  /** Render a finished run (live or replayed from disk). */
  function renderSavedRun(run, { live = false } = {}) {
    state.run = {
      ...run,
      questions: run.questions.map(({ id, question, reference, difficulty }) => ({ id, question, reference, difficulty })),
      answers: {},
      grades: {},
      judging: {},
      judgeErrors: {}
    };
    run.questions.forEach((q) => {
      state.run.judging[q.id] = false;
      q.answers.forEach((a) => {
        state.run.answers[`${q.id}|${a.key}`] = { questionId: q.id, ...a };
        if (a.grade) state.run.grades[`${q.id}|${a.key}`] = a.grade;
      });
    });
    $("live-results").style.display = "block";
    renderRunHeader(run);
    renderQuestionShells();
    run.questions.forEach((q) => {
      const el = document.querySelector(`[data-qstatus="${CSS.escape(q.id)}"]`);
      if (el) el.innerHTML = q.answers.some((a) => a.grade) ? "✅ judged" : '<span class="live-warn">not judged</span>';
      q.answers.forEach((a) => renderCell(q.id, a.key));
    });
    renderFinalLeaderboard(run);
    if (!live) {
      $("live-note").innerHTML = `<span class="live-muted">Showing saved run from ${new Date(run.startedAt).toLocaleString()} (no API calls made).</span>`;
      $("live-progress").style.display = "none";
    }
  }

  async function replay() {
    const res = await fetch("/api/live/runs/latest");
    if (!res.ok) {
      $("live-note").innerHTML = '<span class="live-warn">No saved run yet.</span>';
      return;
    }
    renderSavedRun(await res.json());
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("panel-live")) return;
    $("live-run-btn").addEventListener("click", startRun);
    $("live-check-btn").addEventListener("click", preflight);
    $("live-replay-btn").addEventListener("click", replay);
    $("live-dataset").addEventListener("change", renderCriteriaHint);
    $("live-upload-form").addEventListener("submit", uploadDataset);
    $("live-keys-form").addEventListener("submit", saveKeys);
    loadConfig().catch((e) => { $("live-note").innerHTML = `<span class="live-warn">Could not load live config: ${esc(e.message)}</span>`; });
  });
})();
