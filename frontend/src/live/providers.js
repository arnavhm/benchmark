/**
 * Live provider clients — real HTTP calls to Groq, OpenRouter and Gemini.
 *
 * Every call returns what was actually measured:
 *   text, latencyMs (wall clock of the successful request), token counts from the
 *   provider's own usage block, and costUsd (OpenRouter: billed cost it reports;
 *   Groq/Gemini: tokens x list price from data/live_models.json).
 *
 * Keys come only from environment variables (loaded from the project .env):
 *   GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY
 */

const PLACEHOLDER = /^(your_|<|changeme|xxx|placeholder)/i;

const PROVIDERS = {
  groq: {
    label: "Groq",
    envKey: "GROQ_API_KEY",
    baseUrl: () => process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    concurrency: 4
  },
  openrouter: {
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: () => process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    concurrency: 4
  },
  gemini: {
    label: "Gemini",
    envKey: "GEMINI_API_KEY",
    baseUrl: () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    concurrency: 2
  }
};

function getKey(provider) {
  const def = PROVIDERS[provider];
  if (!def) return null;
  const key = (process.env[def.envKey] || "").trim();
  if (!key || PLACEHOLDER.test(key)) return null;
  return key;
}

function hasKey(provider) {
  return Boolean(getKey(provider));
}

// ── Simple per-provider concurrency limiter ──────────────────────────────────
const queues = {};
function limiter(provider) {
  if (!queues[provider]) queues[provider] = { active: 0, waiting: [] };
  const q = queues[provider];
  const max = PROVIDERS[provider]?.concurrency || 2;
  return {
    async acquire() {
      if (q.active < max) { q.active++; return; }
      await new Promise((resolve) => q.waiting.push(resolve));
      q.active++;
    },
    release() {
      q.active--;
      const next = q.waiting.shift();
      if (next) next();
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(res, bodyText, attempt) {
  const header = res?.headers?.get?.("retry-after");
  if (header && Number.isFinite(Number(header))) return Math.min(20000, Number(header) * 1000);
  const tryAgain = bodyText && bodyText.match(/try again in ([0-9.]+)(ms|s)/i);
  if (tryAgain) return Math.min(20000, Math.ceil(tryAgain[2].toLowerCase() === "ms" ? Number(tryAgain[1]) : Number(tryAgain[1]) * 1000) + 250);
  const m = bodyText && bodyText.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/);
  if (m) return Math.min(20000, Math.round(Number(m[1]) * 1000));
  return 2000 * 2 ** attempt;
}

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry wrapper for rate limits / transient server errors. Latency is measured per attempt.
 * Short, explicit waits (e.g. Groq "try again in 480ms" token-per-minute limits) are honoured up to
 * 4 attempts; long or unknown waits give up after 2 attempts so a fallback model can take over quickly.
 */
async function withRetries(fn, maxAttempts = 4) {
  let lastError;
  for (let i = 0; i < maxAttempts; i++) {
    const started = performance.now();
    const { res, text } = await fn();
    const latencyMs = performance.now() - started;
    if (res.ok) return { text, latencyMs, attempts: i + 1 };
    lastError = new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    const delay = retryDelayMs(res, text, i);
    const shortWait = res.status === 429 && explicitShortWait(res, text);
    if (i === maxAttempts - 1 || (i >= 1 && !shortWait)) break;
    await sleep(shortWait ? Math.max(delay, 500) : delay);
  }
  throw lastError;
}

/** True when the provider explicitly asks us to wait 5 s or less. */
function explicitShortWait(res, text) {
  const header = Number(res?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return header <= 5;
  const m = String(text || "").match(/try again in ([0-9.]+)(ms|s)/i);
  if (m) return (m[2].toLowerCase() === "ms" ? Number(m[1]) / 1000 : Number(m[1])) <= 5;
  return false;
}

function priceCost(pricing, inputTokens, outputTokens) {
  if (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output)) return null;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1e6;
}

// ── OpenAI-compatible (Groq, OpenRouter) ─────────────────────────────────────
async function callOpenAICompatible(provider, { model, system, prompt, maxTokens, temperature, json, extra, pricing, timeoutMs }) {
  const key = getKey(provider);
  if (!key) throw new ProviderError(`${PROVIDERS[provider].envKey} is not set`, 0);

  const headers = { Authorization: `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "AI Benchmark Analyzer";
  }

  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature,
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(extra || {})
  };

  const url = `${PROVIDERS[provider].baseUrl()}/chat/completions`;
  const { text, latencyMs, attempts } = await withRetries(() => postJson(url, headers, body, timeoutMs));
  const data = JSON.parse(text);
  if (data.error) throw new ProviderError(data.error.message || JSON.stringify(data.error), data.error.code);

  const choice = data.choices?.[0];
  // Some open-weight reasoning models (e.g. Qwen) inline their chain of thought in <think> tags — strip it.
  const content = (choice?.message?.content || "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  const usage = data.usage || {};
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;

  let costUsd = null;
  let costSource = "list-price";
  if (provider === "openrouter" && Number.isFinite(usage.cost)) {
    costUsd = usage.cost;
    costSource = "billed";
  } else {
    costUsd = priceCost(pricing, inputTokens, outputTokens);
  }

  return {
    text: content,
    latencyMs,
    attempts,
    inputTokens,
    outputTokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
    costUsd,
    costSource,
    servedModel: data.model || model,
    finishReason: choice?.finish_reason || null
  };
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini({ model, system, prompt, maxTokens, temperature, json, pricing, timeoutMs }) {
  const key = getKey("gemini");
  if (!key) throw new ProviderError("GEMINI_API_KEY is not set", 0);

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(json ? { responseMimeType: "application/json" } : {})
    },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {})
  };

  const url = `${PROVIDERS.gemini.baseUrl()}/models/${encodeURIComponent(model)}:generateContent`;
  const { text, latencyMs, attempts } = await withRetries(() =>
    postJson(url, { "x-goog-api-key": key }, body, timeoutMs)
  );
  const data = JSON.parse(text);
  const candidate = data.candidates?.[0];
  const content = (candidate?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();

  const u = data.usageMetadata || {};
  const inputTokens = u.promptTokenCount || 0;
  // Thinking tokens are billed as output tokens.
  const outputTokens = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);

  return {
    text: content,
    latencyMs,
    attempts,
    inputTokens,
    outputTokens,
    reasoningTokens: u.thoughtsTokenCount || 0,
    costUsd: priceCost(pricing, inputTokens, outputTokens),
    costSource: "list-price",
    servedModel: data.modelVersion || model,
    finishReason: candidate?.finishReason || null
  };
}

/**
 * Call any configured model.
 * @returns {Promise<{text, latencyMs, inputTokens, outputTokens, costUsd, costSource, ...}>}
 */
async function callOnce(provider, options) {
  if (!PROVIDERS[provider]) throw new ProviderError(`Unknown provider "${provider}"`, 0);
  const opts = { maxTokens: 1024, temperature: 0.2, timeoutMs: 60000, ...options };
  const lim = limiter(provider);
  await lim.acquire();
  try {
    if (provider === "gemini") return await callGemini(opts);
    return await callOpenAICompatible(provider, opts);
  } finally {
    lim.release();
  }
}

const OVERLOAD = new Set([429, 500, 502, 503, 504]);
// Circuit breaker: a model that just failed with overload is skipped for a while (if a fallback exists).
const COOL_OFF_MS = 120000;
const overloadedUntil = new Map();
function isOverload(error) {
  return OVERLOAD.has(error?.status) || error?.name === "AbortError" || error?.name === "TimeoutError" || /fetch failed/i.test(error?.message || "");
}

/**
 * Call a model; if it is overloaded / rate-limited / times out, try each entry of
 * options.fallbacks ([{provider, model, pricing}]) in order. The result records which
 * model actually answered (servedBy) and whether a fallback was used.
 */
async function callModel(provider, options) {
  const base = [{ provider, model: options.model, pricing: options.pricing }, ...(options.fallbacks || [])];
  const failures = [];
  const skipped = [];
  const chain = [...base];
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (i > 0 && !hasKey(step.provider)) continue;
    const coolKey = `${step.provider}:${step.model}`;
    if (!step.retry && i < chain.length - 1 && (overloadedUntil.get(coolKey) || 0) > Date.now()) {
      failures.push(`${step.model}: skipped (overloaded in the last 2 min)`);
      skipped.push({ ...step, retry: true, index: base.indexOf(step) });
      continue;
    }
    try {
      const result = await callOnce(step.provider, { ...options, model: step.model, pricing: step.pricing ?? options.pricing });
      if (step.retry) overloadedUntil.delete(coolKey);
      const baseIndex = step.retry ? step.index : i;
      return { ...result, servedBy: { provider: step.provider, model: step.model }, fallbackUsed: baseIndex > 0, fallbackReasons: failures };
    } catch (error) {
      failures.push(`${step.model}: ${String(error.message).split("\n")[0].slice(0, 120)}`);
      if (isOverload(error)) overloadedUntil.set(coolKey, Date.now() + COOL_OFF_MS);
      const moreToTry = i < chain.length - 1 || skipped.length;
      if (!isOverload(error) || !moreToTry) {
        if (failures.length > 1) error.message = failures.join(" → ");
        throw error;
      }
      // Everything else failed: give the models we skipped one more chance.
      if (i === chain.length - 1 && skipped.length) chain.push(...skipped.splice(0));
    }
  }
  throw new ProviderError(failures.join(" → ") || "No model available", 0);
}

/** Lists model ids the key can access — used by the "Check models" preflight. */
async function listModels(provider) {
  const key = getKey(provider);
  if (!key) return { ok: false, error: `${PROVIDERS[provider].envKey} is not set`, ids: [] };
  try {
    let url;
    let headers = {};
    if (provider === "gemini") {
      url = `${PROVIDERS.gemini.baseUrl()}/models?pageSize=1000`;
      headers = { "x-goog-api-key": key };
    } else {
      url = `${PROVIDERS[provider].baseUrl()}/models`;
      headers = { Authorization: `Bearer ${key}` };
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, ids: [] };
    const data = JSON.parse(text);
    const ids = provider === "gemini"
      ? (data.models || []).map((m) => String(m.name || "").replace(/^models\//, ""))
      : (data.data || []).map((m) => m.id);
    return { ok: true, ids };
  } catch (error) {
    return { ok: false, error: error.message, ids: [] };
  }
}

module.exports = { PROVIDERS, callModel, listModels, hasKey, ProviderError, _overloadedUntil: overloadedUntil };
