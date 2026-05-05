/**
 * AI Model Benchmark Analyzer — Frontend Logic
 * Handles:
 *  - Standard benchmark charts & recommendation engine (Tab 1)
 *  - Custom benchmark analysis, charts, recommendation (Tab 2)
 *  - Gemini API mode toggle & file upload
 */

// ─── Global State ──────────────────────────────────────────────────────────────
let benchmarkData   = null;   // Data from /get-data
let selectedTask    = null;   // Recommendation engine task selection
let charts          = {};     // All Chart.js instances (keyed by canvas id)
let currentMode     = 'simulated';   // 'simulated' | 'real_api'
let selectedDiff    = 'all';         // Difficulty filter
let rankingSort     = 'score';
let rankingFilter   = 'all';
let rankingTimer    = null;
let pendingDatasetFile = null;

const SCORE_CATEGORIES = ['coding', 'math', 'reasoning', 'chat'];
const CATEGORY_META = {
  coding:    { label: 'Coding',    icon: '💻', chartId: 'chart-coding' },
  math:      { label: 'Math',      icon: '🧮', chartId: 'chart-math' },
  reasoning: { label: 'Reasoning', icon: '🧠', chartId: 'chart-reasoning' },
  chat:      { label: 'Chat',      icon: '💬', chartId: 'chart-chat' },
};

// ─── Chart.js Global Defaults ──────────────────────────────────────────────────
if (window.Chart) {
  Chart.defaults.color          = '#a0a0b8';
  Chart.defaults.font.family    = "'Inter', sans-serif";
  Chart.defaults.font.size      = 12;
  Chart.defaults.plugins.legend.display = false;
}

// ─── Model Color Palette ───────────────────────────────────────────────────────
const MODEL_COLORS = {
  'GPT-5.4':                 { bg: 'rgba(16, 163, 127, 0.78)',  border: '#10a37f' },
  'GPT-5.4 Pro':             { bg: 'rgba(0, 206, 201, 0.78)',   border: '#00cec9' },
  'Gemini 3.1 Pro':          { bg: 'rgba(66, 133, 244, 0.78)',  border: '#4285f4' },
  'Claude Opus 4.7':         { bg: 'rgba(212, 165, 116, 0.78)', border: '#d4a574' },
  'Claude Opus 4.6':         { bg: 'rgba(196, 149, 106, 0.78)', border: '#c4956a' },
  'Llama 4 Maverick':        { bg: 'rgba(6, 104, 225, 0.78)',   border: '#0668E1' },
  'Qwen3 Max':               { bg: 'rgba(253, 203, 110, 0.78)', border: '#fdcb6e' },
  'DeepSeek-V3.2 Reasoner':  { bg: 'rgba(253, 121, 168, 0.78)', border: '#fd79a8' },
  'GPT-4':         { bg: 'rgba(16, 163, 127, 0.75)',  border: '#10a37f' },
  'GPT-4o':        { bg: 'rgba(14, 164, 122, 0.75)',  border: '#0ea47a' },
  'Claude-3':      { bg: 'rgba(212, 165, 116, 0.75)', border: '#d4a574' },
  'Claude-3.5':    { bg: 'rgba(196, 149, 106, 0.75)', border: '#c4956a' },
  'Gemini':        { bg: 'rgba(66, 133, 244, 0.75)',  border: '#4285f4' },
  'Gemini-1.5':    { bg: 'rgba(59, 120, 231, 0.75)',  border: '#3b78e7' },
  'Llama-2':       { bg: 'rgba(6, 104, 225, 0.75)',   border: '#0668E1' },
  'Mistral-Large': { bg: 'rgba(255, 112, 0, 0.75)',   border: '#ff7000' },
};

const FALLBACK_COLORS = [
  { bg: 'rgba(108, 92, 231, 0.75)',  border: '#6c5ce7' },
  { bg: 'rgba(253, 121, 168, 0.75)', border: '#fd79a8' },
  { bg: 'rgba(0, 206, 201, 0.75)',   border: '#00cec9' },
  { bg: 'rgba(253, 203, 110, 0.75)', border: '#fdcb6e' },
];

function getModelColor(model, index = 0) {
  return MODEL_COLORS[model] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** Safely destroy a chart instance if it exists, then remove it from registry. */
function destroyChart(id) {
  if (window.Chart && charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  fetchBenchmarkData();
  setupSliders();
  setupTaskButtons();
  setupRankingControls();
  setupModeToggle();
  setupDifficultyPills();
  checkApiStatus();
});


// ═══════════════════════════════════════════════════════════════════════════════
// Tab Navigation
// ═══════════════════════════════════════════════════════════════════════════════

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Update buttons
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('tab-btn--active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('tab-btn--active');
      btn.setAttribute('aria-selected', 'true');
      // Update panels
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('tab-panel--active'));
      document.getElementById(`panel-${tab}`).classList.add('tab-panel--active');
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// API Status Check
// ═══════════════════════════════════════════════════════════════════════════════

async function checkApiStatus() {
  try {
    const resp = await fetch('/api-status');
    const data = await resp.json();
    const dot  = document.getElementById('api-status-dot');
    const txt  = document.getElementById('api-status-text');
    const link = document.getElementById('api-status-link');

    if (data.llm_dataset_analyzer) {
      dot.classList.add('dot--green');
      txt.textContent = `🧠 LLM dataset analyzer is ready (${data.dataset_analyzer_model})`;
    } else if (data.gemini_ready) {
      dot.classList.add('dot--green');
      txt.textContent = '⚡ Gemini API is ready — Real API mode enabled';
    } else if (data.gemini_sdk_installed) {
      dot.classList.add('dot--yellow');
      txt.textContent = '🔑 Gemini SDK installed but API key not set. Add GEMINI_API_KEY to .env to enable Real API mode.';
      link.style.display = 'inline';
      link.href = 'https://aistudio.google.com/app/apikey';
    } else {
      dot.classList.add('dot--gray');
      txt.textContent = '🎭 Rule-based dataset analysis active. Add OPENAI_API_KEY to enable LLM-powered dataset understanding.';
      link.style.display = 'inline';
      link.href = 'https://platform.openai.com/api-keys';
    }

    // Disable real-api button if not ready
    if (!data.gemini_ready) {
      const realBtn = document.getElementById('mode-real');
      if (realBtn) {
        realBtn.disabled = true;
        realBtn.title = 'Configure GEMINI_API_KEY in .env to enable Real API mode';
      }
    }
  } catch (e) {
    console.warn('Could not check API status:', e);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Standard Benchmark — Fetch & Render (Tab 1)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchBenchmarkData() {
  try {
    const response  = await fetch('/get-data');
    benchmarkData   = await response.json();
    renderStatsBar(benchmarkData.stats);
    renderCharts(benchmarkData);
    renderInsights(benchmarkData);
    renderLastUpdated(benchmarkData.lastUpdated, benchmarkData.source);
    analyzeModels({ silent: true });
  } catch (error) {
    console.error('Failed to fetch benchmark data:', error);
  }
}

// ─── Stats Bar ─────────────────────────────────────────────────────────────────
function renderStatsBar(stats) {
  const container  = document.getElementById('stats-bar');

  container.innerHTML = SCORE_CATEGORIES.map(category => `
    <div class="stat-card" id="stat-${category}">
      <div class="stat-card__label">${CATEGORY_META[category].icon} ${CATEGORY_META[category].label}</div>
      <div class="stat-card__value">${stats[category].max}</div>
      <div class="stat-card__detail">Leader: ${stats[category].leader} · Avg: ${stats[category].avg}</div>
    </div>
  `).join('');
}

// ─── Standard Charts ───────────────────────────────────────────────────────────
function renderCharts(data) {
  if (!window.Chart) {
    document.querySelectorAll('.chart-wrapper').forEach(wrapper => {
      if (wrapper.querySelector('canvas[id^="chart-"]')) {
        wrapper.innerHTML = '<div class="chart-fallback">Chart library unavailable. Benchmark data loaded successfully.</div>';
      }
    });
    return;
  }

  SCORE_CATEGORIES.forEach((category) => {
    const canvasId = CATEGORY_META[category].chartId;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    destroyChart(canvasId);

    const sorted = data.data
      .map(d => ({ model: d.model, score: d[category] }))
      .sort((a, b) => b.score - a.score);

    const labels = sorted.map(d => d.model);
    const scores = sorted.map(d => d.score);
    const colors = labels.map((m, i) => getModelColor(m, i));

    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: scores,
          backgroundColor: colors.map(c => c.bg),
          borderColor:     colors.map(c => c.border),
          borderWidth:     2,
          borderRadius:    6,
          borderSkipped:   false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(10, 10, 15, 0.95)',
            titleColor:  '#f0f0f5',
            bodyColor:   '#a0a0b8',
            borderColor: 'rgba(108, 92, 231, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            callbacks: { label: ctx => `Score: ${ctx.raw}%` },
          },
        },
        scales: {
          x: {
            beginAtZero: false,
            min:  Math.max(0, Math.min(...scores) - 15),
            max:  100,
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: {
              font: { size: 11, family: "'JetBrains Mono', monospace" },
              callback: v => v + '%',
            },
          },
          y: {
            grid:  { display: false },
            ticks: { font: { size: 12, weight: '600' }, color: '#e0e0ec' },
          },
        },
        animation: { duration: 1000, easing: 'easeOutQuart' },
      },
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Slider Setup
// ═══════════════════════════════════════════════════════════════════════════════

function setupSliders() {
  SCORE_CATEGORIES.map(category => `${category}-weight`).forEach(id => {
    const slider       = document.getElementById(id);
    if (!slider) return;
    const valueDisplay = document.getElementById(`${id}-value`);
    const group        = slider.closest('.slider-group');

    updateSliderFill(slider, group);
    slider.addEventListener('input', () => {
      valueDisplay.textContent = slider.value;
      updateSliderFill(slider, group);
      queueAnalyzeModels();
    });
  });
}

function updateSliderFill(slider, group) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  group.style.setProperty('--slider-percent', pct + '%');
}


// ═══════════════════════════════════════════════════════════════════════════════
// Task Buttons
// ═══════════════════════════════════════════════════════════════════════════════

function setupTaskButtons() {
  document.querySelectorAll('.task-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTask = btn.dataset.task;
      adjustSlidersForTask(selectedTask);
    });
  });
}

function adjustSlidersForTask(task) {
  const presets = {
    Coding:   { coding: 55, math: 20, reasoning: 20, chat: 5 },
    Math:     { coding: 10, math: 55, reasoning: 30, chat: 5 },
    Research: { coding: 10, math: 20, reasoning: 55, chat: 15 },
    Chatbot:  { coding: 5,  math: 10, reasoning: 25, chat: 60 },
  };
  const preset = presets[task];
  if (!preset) return;
  animateSlider('coding-weight', preset.coding);
  animateSlider('math-weight',   preset.math);
  animateSlider('reasoning-weight', preset.reasoning);
  animateSlider('chat-weight', preset.chat);
  queueAnalyzeModels();
}

function animateSlider(id, targetValue) {
  const slider       = document.getElementById(id);
  const valueDisplay = document.getElementById(`${id}-value`);
  const group        = slider.closest('.slider-group');
  slider.value       = targetValue;
  valueDisplay.textContent = targetValue;
  updateSliderFill(slider, group);
}

function setupRankingControls() {
  const sortSelect = document.getElementById('ranking-sort');
  const filterSelect = document.getElementById('ranking-filter');

  sortSelect?.addEventListener('change', () => {
    rankingSort = sortSelect.value;
    analyzeModels({ silent: true });
  });

  filterSelect?.addEventListener('change', () => {
    rankingFilter = filterSelect.value;
    analyzeModels({ silent: true });
  });
}

function queueAnalyzeModels() {
  clearTimeout(rankingTimer);
  rankingTimer = setTimeout(() => analyzeModels({ silent: true }), 250);
}

function getCurrentWeights() {
  return SCORE_CATEGORIES.reduce((weights, category) => {
    weights[category] = parseInt(document.getElementById(`${category}-weight`)?.value || '0', 10);
    return weights;
  }, {});
}

function renderLastUpdated(lastUpdated, source) {
  const el = document.getElementById('last-updated');
  if (!el || !lastUpdated) return;

  const formatted = new Date(lastUpdated).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  el.textContent = `Last updated: ${formatted} · Source: ${source || 'local-json'}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Recommendation Engine (Tab 1)
// ═══════════════════════════════════════════════════════════════════════════════

async function analyzeModels(options = {}) {
  const btn              = document.getElementById('analyze-btn');
  const resultsContainer = document.getElementById('results-container');

  if (!options.silent) {
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  }

  const weights = getCurrentWeights();

  try {
    const response = await fetch('/recommend', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        task_type: selectedTask,
        weights,
        sortBy: rankingSort,
        filterCategory: rankingFilter,
      }),
    });
    const result = await response.json();
    renderResults(result);
    renderInsights(result);
    renderLastUpdated(result.lastUpdated, result.source);
  } catch (error) {
    console.error('Analysis failed:', error);
    resultsContainer.innerHTML = `
      <div class="results-placeholder">
        <div class="results-placeholder__icon">⚠️</div>
        <div class="results-placeholder__text">Analysis failed. Please try again.</div>
      </div>`;
  } finally {
    if (!options.silent) {
      btn.disabled  = false;
      btn.innerHTML = '🔍 Analyze &amp; Recommend';
    }
  }
}

function renderResults(result) {
  const container = document.getElementById('results-container');
  const best      = result.rankings[0];
  if (!best) {
    container.innerHTML = `
      <div class="results-placeholder">
        <div class="results-placeholder__icon">🔎</div>
        <div class="results-placeholder__text">No models match this filter</div>
        <div class="results-placeholder__hint">Try switching the filter back to All Models</div>
      </div>`;
    return;
  }
  const maxScore  = best.weighted_score;

  let html = `<div class="results-content">`;

  html += `
    <div class="winner-card">
      <div class="winner-badge">🏆 Top Recommendation</div>
      <div class="winner-name">${best.model}</div>
      <div class="winner-provider">${best.provider}</div>
      <div class="winner-score">
        <span class="winner-score__value">${best.weighted_score.toFixed(1)}</span>
        <span class="winner-score__label">weighted score</span>
      </div>
      <div class="winner-explanation">${result.explanation}</div>
      <div class="winner-use-case">Best use-case: ${best.bestUseCase}</div>
      <div class="strengths">
        ${best.strengths.map(s => `<span class="strength-pill">${s}</span>`).join('')}
      </div>
    </div>`;

  if (result.task_recommendation) {
    const tr = result.task_recommendation;
    html += `
      <div class="task-rec-card">
        <div class="task-rec-card__header">
          <span class="task-rec-card__icon">${tr.icon}</span>
          <span class="task-rec-card__title">Task-Based Pick: ${tr.task}</span>
        </div>
        <div class="task-rec-card__model">${tr.recommended_model}</div>
        <div class="task-rec-card__reason">${tr.reason}</div>
      </div>`;
  }

  if (result.reasoning) {
    html += `
      <div class="reasoning-card">
        <div class="reasoning-card__header">
          <span class="reasoning-card__icon">🧩</span>
          <span class="reasoning-card__title">Reasoning Engine</span>
        </div>
        <p class="reasoning-card__summary">${result.reasoning.summary}</p>
        <div class="reasoning-card__grid">
          <div class="reasoning-point">
          <span class="reasoning-point__label">Strengths</span>
            <span class="reasoning-point__value">${(result.reasoning.strengths || result.reasoning.category_strengths || []).join(' · ')}</span>
          </div>
          <div class="reasoning-point">
            <span class="reasoning-point__label">Best use-case</span>
            <span class="reasoning-point__value">${result.reasoning.bestUseCase || best.bestUseCase}</span>
          </div>
          <div class="reasoning-point">
            <span class="reasoning-point__label">Trade-off</span>
            <span class="reasoning-point__value">${result.reasoning.tradeOff || result.reasoning.trade_off}</span>
          </div>
        </div>
      </div>`;
  }

  html += `<ul class="rankings-list">`;
  result.rankings.forEach((model, index) => {
    const barWidth = (model.weighted_score / maxScore) * 100;
    html += `
      <li class="ranking-item" style="animation: slideInRight 0.3s ease-out ${index * 0.05}s both">
        <div class="ranking-rank">${index + 1}</div>
        <div class="ranking-info">
          <div class="ranking-model">${model.model}</div>
          <div class="ranking-provider">${model.provider}</div>
        </div>
        <div class="ranking-bar-wrapper">
          <div class="ranking-bar" style="width: ${barWidth}%"></div>
        </div>
        <div class="ranking-score">${model.weighted_score.toFixed(1)}</div>
      </li>`;
  });
  html += `</ul></div>`;

  container.innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Model Insights (Tab 1)
// ═══════════════════════════════════════════════════════════════════════════════

function renderInsights(data) {
  const container = document.getElementById('insights-grid');
  if (!container) return;

  if (data.insights && data.insights.length) {
    container.innerHTML = data.insights.map((insight, index) => `
      <div class="insight-card insight-card--generated" style="--card-accent: ${insight.accent || '#6c5ce7'}; animation-delay: ${index * 0.05}s">
        <div class="insight-card__header">
          <div class="insight-card__icon">${insight.icon}</div>
          <div class="insight-card__title-wrap">
            <div class="insight-card__name">${insight.title}</div>
            <div class="insight-card__provider">Generated insight</div>
          </div>
        </div>
        <div class="insight-card__desc">${insight.body}</div>
      </div>
    `).join('');
    return;
  }

  if (!data.model_info) return;

  container.innerHTML = data.data.map(model => {
    const info  = data.model_info[model.model] || {};
    const color = info.color || '#6c5ce7';
    return `
      <div class="insight-card" style="--card-accent: ${color}" id="insight-${model.model.replace(/[^a-z0-9]/gi, '')}">
        <div class="insight-card__header">
          <div class="insight-card__name">${model.model}</div>
          <div class="insight-card__provider">${info.provider || 'Unknown'}</div>
        </div>
        <div class="insight-card__desc">${info.description || ''}</div>
        <div class="insight-card__scores">
          <div class="mini-score"><span class="mini-score__label">Coding</span><span class="mini-score__value">${model.coding}</span></div>
          <div class="mini-score"><span class="mini-score__label">Math</span><span class="mini-score__value">${model.math}</span></div>
          <div class="mini-score"><span class="mini-score__label">Reasoning</span><span class="mini-score__value">${model.reasoning}</span></div>
          <div class="mini-score"><span class="mini-score__label">Chat</span><span class="mini-score__value">${model.chat}</span></div>
        </div>
        <div class="strengths">
          ${(info.strengths || []).map(s => `<span class="strength-pill">${s}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}


// ═══════════════════════════════════════════════════════════════════════════════
// Custom Benchmark — Mode Toggle & Difficulty (Tab 2)
// ═══════════════════════════════════════════════════════════════════════════════

function setupModeToggle() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-btn--active'));
      btn.classList.add('mode-btn--active');
      currentMode = btn.dataset.mode;
    });
  });
}

function setupDifficultyPills() {
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('pill-btn--active'));
      btn.classList.add('pill-btn--active');
      selectedDiff = btn.dataset.diff;
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Custom Benchmark — Run (Tab 2)
// ═══════════════════════════════════════════════════════════════════════════════

async function runCustomBenchmark() {
  const runBtn    = document.getElementById('run-benchmark-btn');
  const loading   = document.getElementById('custom-loading');
  const resultsEl = document.getElementById('custom-results');
  const loadingSub = document.getElementById('loading-sub');

  // Get selected categories
  const categories = ['coding', 'math', 'reasoning', 'chat']
    .filter(cat => document.getElementById(`cat-${cat}`)?.checked);

  if (categories.length === 0) {
    alert('Please select at least one category.');
    return;
  }

  // Show loading
  runBtn.disabled  = true;
  runBtn.innerHTML = '<span class="spinner"></span> Running…';
  loading.style.display  = 'flex';
  resultsEl.style.display = 'none';

  // Animated sub-text
  const steps = [
    'Loading questions…',
    'Evaluating GPT-4 responses…',
    'Evaluating Claude-3 responses…',
    'Evaluating Gemini responses…',
    'Evaluating Llama-2 responses…',
    'Computing scores…',
    'Generating recommendation…',
  ];
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    loadingSub.textContent = steps[Math.min(stepIdx++, steps.length - 1)];
  }, 700);

  try {
    const resp = await fetch('/run-custom-benchmark', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mode:       currentMode,
        difficulty: selectedDiff,
        categories,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server error');
    }

    const data = await resp.json();
    clearInterval(stepInterval);

    // Render everything
    renderCustomResults(data);
    resultsEl.style.display = 'block';
    // Scroll to results
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (error) {
    clearInterval(stepInterval);
    console.error('Custom benchmark failed:', error);
    alert(`Benchmark failed: ${error.message}`);
  } finally {
    loading.style.display = 'none';
    runBtn.disabled  = false;
    runBtn.innerHTML = '🚀 Run Custom Benchmark';
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Custom Benchmark — Render All Results
// ═══════════════════════════════════════════════════════════════════════════════

function renderCustomResults(data) {
  renderResultsMeta(data);
  renderDatasetAnalysisSummary(data);
  renderCustomRecommendation(data.recommendation, data.model_colors);
  renderOverallBarChart(data);
  renderRadarChart(data);
  renderDifficultyChart(data);
  renderResponseTimeChart(data);
  renderScoresTable(data);
}

// ─── Meta Bar ─────────────────────────────────────────────────────────────────
function renderResultsMeta(data) {
  const el = document.getElementById('results-meta');
  const modeLabel = data.mode === 'llm'
    ? '🧠 LLM dataset analysis'
    : data.mode === 'manual'
      ? '✋ Manual task selection'
      : data.mode === 'real_api'
    ? `⚡ Real API${data.gemini_api_used ? ' · Gemini live' : ' · Simulated fallback'}`
    : '🎭 Simulated';
  const fallbackNote = data.fallback_count > 0
    ? `<span class="meta-tag meta-tag--warn">⚠️ ${data.fallback_count} API fallbacks</span>` : '';

  el.innerHTML = `
    <span class="meta-tag">${modeLabel}</span>
    <span class="meta-tag">📝 ${data.total_questions} questions</span>
    <span class="meta-tag">🏷️ ${data.datasetType || data.categories.join(', ')}</span>
    <span class="meta-tag">🎯 ${data.difficulty_filter === 'all' ? 'All difficulties' : data.difficulty_filter}</span>
    ${data.confidence ? `<span class="meta-tag">📌 ${data.confidence}% confidence</span>` : ''}
    ${fallbackNote}
  `;
}

function renderDatasetAnalysisSummary(data) {
  const container = document.getElementById('dataset-analysis-summary');
  if (!container || !data.analysis) return;

  const analysis = data.analysis;
  const benchmarks = data.benchmarks || [];
  const weights = data.weights || {};

  container.innerHTML = `
    <div class="dataset-summary-grid">
      <div class="dataset-summary-card">
        <span class="dataset-summary-card__label">Task Type</span>
        <strong>${analysis.type}</strong>
        <small>${analysis.analyzer || 'rule-based'} analyzer</small>
      </div>
      <div class="dataset-summary-card">
        <span class="dataset-summary-card__label">Difficulty</span>
        <strong>${analysis.difficulty}</strong>
        <small>${analysis.reasoning_required ? 'Reasoning required' : 'Light reasoning'}</small>
      </div>
      <div class="dataset-summary-card">
        <span class="dataset-summary-card__label">Format</span>
        <strong>${analysis.format}</strong>
        <small>${analysis.size} samples</small>
      </div>
      <div class="dataset-summary-card">
        <span class="dataset-summary-card__label">Mapped Benchmarks</span>
        <strong>${benchmarks.join(', ')}</strong>
        <small>${Object.entries(weights).map(([k, v]) => `${k} ${v}`).join(' · ')}</small>
      </div>
    </div>
    <div class="dataset-summary-rationale">${analysis.rationale || data.explanation}</div>
  `;
}

// ─── Recommendation Card ──────────────────────────────────────────────────────
function renderCustomRecommendation(rec, modelColors) {
  const container = document.getElementById('custom-recommendation');
  if (!rec || !rec.recommended_model) {
    container.innerHTML = '<p class="text-muted">No recommendation available.</p>';
    return;
  }

  const color = modelColors?.[rec.recommended_model] || '#6c5ce7';

  container.innerHTML = `
    <div class="custom-winner-card" style="--winner-color: ${color}">
      <div class="custom-winner-header">
        <div class="custom-winner-trophy">🏆</div>
        <div>
          <div class="custom-winner-badge">Best on Custom Benchmark</div>
          <div class="custom-winner-name">${rec.recommended_model}</div>
        </div>
        <div class="custom-winner-score">
          <span class="custom-winner-score__val">${rec.score.toFixed(1)}</span>
          <span class="custom-winner-score__unit">%</span>
        </div>
      </div>
      <div class="custom-winner-explanation">${rec.explanation}</div>

      <div class="custom-rankings">
        ${rec.rankings.map((r, i) => `
          <div class="custom-rank-row">
            <span class="custom-rank-num">${i + 1}</span>
            <span class="custom-rank-model" style="color: ${r.color}">${r.model}</span>
            <div class="custom-rank-bar-wrap">
              <div class="custom-rank-bar" style="width:${r.overall}%; background: ${r.color}40; border-color: ${r.color}"></div>
            </div>
            <span class="custom-rank-score">${r.overall.toFixed(1)}%</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Overall Bar Chart ────────────────────────────────────────────────────────
function renderOverallBarChart(data) {
  destroyChart('custom-bar-chart');
  const ctx = document.getElementById('custom-bar-chart');
  if (!ctx) return;

  const models = data.models;
  const scores = models.map(m => data.overall_scores[m]);
  const colors = models.map((m, i) => getModelColor(m, i));

  charts['custom-bar-chart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: models,
      datasets: [{
        label: 'Overall Score (%)',
        data:            scores,
        backgroundColor: colors.map(c => c.bg),
        borderColor:     colors.map(c => c.border),
        borderWidth:     2,
        borderRadius:    8,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Score: ${ctx.raw.toFixed(1)}%`,
          },
          backgroundColor: 'rgba(10,10,15,0.95)',
          borderColor:     'rgba(108,92,231,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => v + '%', font: { size: 11 } },
        },
        x: {
          grid:  { display: false },
          ticks: { font: { size: 12, weight: '600' }, color: '#e0e0ec' },
        },
      },
      animation: { duration: 1200, easing: 'easeOutBounce' },
    },
  });
}

// ─── Radar Chart ──────────────────────────────────────────────────────────────
function renderRadarChart(data) {
  destroyChart('custom-radar-chart');
  const ctx = document.getElementById('custom-radar-chart');
  if (!ctx) return;

  const categories  = data.categories;
  const catLabels   = categories.map(c => c.charAt(0).toUpperCase() + c.slice(1));
  const models      = data.models;

  const datasets = models.map((model, i) => {
    const color = getModelColor(model, i);
    return {
      label: model,
      data:  categories.map(cat => data.category_scores[cat]?.[model] ?? 0),
      backgroundColor: color.bg.replace('0.75', '0.12'),
      borderColor:     color.border,
      borderWidth:     2,
      pointBackgroundColor: color.border,
      pointRadius:     4,
      pointHoverRadius: 6,
    };
  });

  charts['custom-radar-chart'] = new Chart(ctx, {
    type: 'radar',
    data: { labels: catLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color:  '#a0a0b8',
            padding: 16,
            font: { size: 12 },
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10,10,15,0.95)',
          borderColor:     'rgba(108,92,231,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` },
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          beginAtZero: true,
          grid:     { color: 'rgba(255,255,255,0.07)' },
          angleLines:{ color: 'rgba(255,255,255,0.07)' },
          pointLabels: { color: '#e0e0ec', font: { size: 13, weight: '600' } },
          ticks: {
            display: true,
            color: '#6c6c85',
            backdropColor: 'transparent',
            stepSize: 25,
            callback: v => v + '%',
          },
        },
      },
      animation: { duration: 1000 },
    },
  });
}

// ─── Difficulty Chart ─────────────────────────────────────────────────────────
function renderDifficultyChart(data) {
  destroyChart('custom-difficulty-chart');
  const ctx = document.getElementById('custom-difficulty-chart');
  if (!ctx) return;

  const difficulties = ['easy', 'medium', 'hard'];
  const diffColors   = {
    easy:   { bg: 'rgba(0, 206, 201, 0.7)',   border: '#00cec9' },
    medium: { bg: 'rgba(253, 203, 110, 0.7)', border: '#fdcb6e' },
    hard:   { bg: 'rgba(225, 112, 85, 0.7)',  border: '#e17055' },
  };
  const diffLabels   = { easy: '🟢 Easy', medium: '🟡 Medium', hard: '🔴 Hard' };
  const models       = data.models;

  const datasets = difficulties.map(diff => ({
    label:           diffLabels[diff],
    data:            models.map(m => data.difficulty_scores[m]?.[diff] ?? null),
    backgroundColor: diffColors[diff].bg,
    borderColor:     diffColors[diff].border,
    borderWidth:     2,
    borderRadius:    6,
    borderSkipped:   false,
  }));

  charts['custom-difficulty-chart'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: models, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#a0a0b8', font: { size: 12 }, usePointStyle: true, padding: 16 },
        },
        tooltip: {
          backgroundColor: 'rgba(10,10,15,0.95)',
          borderColor:     'rgba(108,92,231,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ctx.raw !== null ? ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` : ' No data',
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => v + '%', font: { size: 11 } },
        },
        x: { grid: { display: false }, ticks: { font: { weight: '600' }, color: '#e0e0ec' } },
      },
      animation: { duration: 900, easing: 'easeOutQuart' },
    },
  });
}

// ─── Response Time Chart ──────────────────────────────────────────────────────
function renderResponseTimeChart(data) {
  destroyChart('custom-time-chart');
  const ctx = document.getElementById('custom-time-chart');
  if (!ctx) return;

  const models = data.models;
  const times  = models.map(m => data.avg_response_times[m]);
  const colors = models.map((m, i) => getModelColor(m, i));

  charts['custom-time-chart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: models,
      datasets: [{
        label: 'Avg Response Time (s)',
        data:            times,
        backgroundColor: colors.map(c => c.bg),
        borderColor:     colors.map(c => c.border),
        borderWidth:     2,
        borderRadius:    6,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,10,15,0.95)',
          borderColor:     'rgba(108,92,231,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(3)}s` },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => v + 's', font: { size: 11 } },
        },
        x: { grid: { display: false }, ticks: { font: { weight: '600' }, color: '#e0e0ec' } },
      },
      animation: { duration: 800 },
    },
  });
}

// ─── Scores Table ─────────────────────────────────────────────────────────────
function renderScoresTable(data) {
  const container = document.getElementById('scores-table-container');
  const models    = data.models;
  const categories = data.categories;

  // Build header
  let html = `
    <div class="table-scroll">
      <table class="scores-table">
        <thead>
          <tr>
            <th class="th-model">Model</th>
            ${categories.map(c => `<th>${c.charAt(0).toUpperCase() + c.slice(1)}</th>`).join('')}
            <th class="th-overall">Overall</th>
            <th>Avg Time</th>
          </tr>
        </thead>
        <tbody>`;

  models.forEach((model, idx) => {
    const color = data.model_colors[model] || '#6c5ce7';
    const overall = data.overall_scores[model];
    const avgTime = data.avg_response_times[model];

    html += `<tr class="table-row" style="--row-color: ${color}">
      <td class="td-model">
        <span class="td-model__dot" style="background:${color}"></span>
        ${model}
      </td>`;

    categories.forEach(cat => {
      const score    = data.category_scores[cat]?.[model] ?? null;
      const pct      = score !== null ? score.toFixed(1) : '—';
      const cls      = score !== null
        ? (score >= 70 ? 'score-high' : score >= 45 ? 'score-mid' : 'score-low')
        : '';
      html += `<td><span class="score-badge ${cls}">${pct}${score !== null ? '%' : ''}</span></td>`;
    });

    html += `
      <td class="td-overall">
        <span class="overall-score">${overall.toFixed(1)}%</span>
        <div class="overall-bar" style="width:${overall}%; background:${color}40; border-color:${color}"></div>
      </td>
      <td class="td-time">${avgTime.toFixed(3)}s</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Dataset Upload
// ═══════════════════════════════════════════════════════════════════════════════

async function uploadDataset(input) {
  const statusEl = document.getElementById('upload-status');
  if (!input.files.length) return;

  const file   = input.files[0];
  pendingDatasetFile = file;
  await analyzeUploadedDataset(file);

  // Reset file input so selecting the same file again retriggers change.
  input.value = '';
}

async function analyzeUploadedDataset(file, taskType = '') {
  const statusEl = document.getElementById('upload-status');
  const fallbackEl = document.getElementById('manual-task-fallback');
  const resultsEl = document.getElementById('custom-results');
  const formData = new FormData();
  formData.append('file', file);
  if (taskType) formData.append('taskType', taskType);

  statusEl.style.display = 'flex';
  statusEl.className     = 'upload-status upload-status--loading';
  statusEl.innerHTML     = '<span class="spinner spinner--sm"></span> Analyzing dataset and ranking models…';

  try {
    const resp = await fetch('/upload-custom-dataset', { method: 'POST', body: formData });
    const data = await resp.json();

    if (!resp.ok) {
      statusEl.className  = 'upload-status upload-status--error';
      statusEl.textContent = `❌ ${data.error}`;
    } else {
      statusEl.className  = 'upload-status upload-status--success';
      statusEl.innerHTML  = `
        ✅ ${data.message || 'Dataset analyzed successfully.'}
        <span class="upload-detail">Type: ${data.datasetType} · Format: ${data.analysis.format} · Difficulty: ${data.difficulty}</span>
        ${data.warnings.length ? `<span class="upload-warn">⚠️ ${data.warnings.length} warnings</span>` : ''}
      `;
      fallbackEl.style.display = data.needsManualSelection ? 'flex' : 'none';
      renderCustomResults(data);
      resultsEl.style.display = 'block';
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    statusEl.className  = 'upload-status upload-status--error';
    statusEl.textContent = `❌ Upload failed: ${e.message}`;
  }
}

async function reanalyzeUploadedDataset() {
  if (!pendingDatasetFile) return;
  const taskType = document.getElementById('manual-task-type')?.value || 'reasoning';
  await analyzeUploadedDataset(pendingDatasetFile, taskType);
}
