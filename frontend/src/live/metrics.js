/**
 * Real statistics over real per-question results.
 */

const STOPWORDS = new Set(("a an and are as at be been but by can could do does for from has have if in into is it its " +
  "may might must no not of on or should so such than that the their then there these this those to was " +
  "were what when which while will with would you your also any each more most other some very").split(" "));

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Term-frequency cosine similarity (0..1) between an answer and the reference. */
function lexicalSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const fa = new Map();
  const fb = new Map();
  ta.forEach((t) => fa.set(t, (fa.get(t) || 0) + 1));
  tb.forEach((t) => fb.set(t, (fb.get(t) || 0) + 1));
  let dot = 0;
  for (const [t, v] of fa) if (fb.has(t)) dot += v * fb.get(t);
  const norm = (m) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  return dot / (norm(fa) * norm(fb));
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% bootstrap confidence interval of the mean, resampling questions. */
function bootstrapCI(xs, iterations = 2000, seed = 7) {
  if (xs.length < 2) return null;
  const rng = seededRng(seed);
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rng() * xs.length)];
    means.push(sum / xs.length);
  }
  return { lower: percentile(means, 2.5), upper: percentile(means, 97.5) };
}

module.exports = { lexicalSimilarity, mean, percentile, bootstrapCI, seededRng };
