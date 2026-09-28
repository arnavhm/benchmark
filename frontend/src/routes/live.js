/**
 * Live Benchmark routes — real model calls, streamed to the dashboard via Server-Sent Events.
 *
 *   GET /api/live/config      models, judge, which provider keys are set, datasets, saved runs
 *   GET /api/live/preflight   checks every configured model id against the provider's model list
 *   GET /api/live/run         SSE stream of a new live run (?dataset=aviation&limit=5)
 *   GET /api/live/runs        saved runs
 *   GET /api/live/runs/:id    one saved run ("latest" for the newest) — used for offline replay
 */
const express = require("express");
const multer = require("multer");
const { parseDatasetFile } = require("../logic/datasetParser");
const { listModels, PROVIDERS } = require("../live/providers");
const { getDatasets, getDataset, loadConfig, loadDataset, saveCustomDataset, providerStatus } = require("../live/config");
const { runLiveBenchmark, listRuns, loadRun } = require("../live/runner");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
let activeRun = null;

router.get("/api/live/config", (req, res) => {
  const { contestants, judge, settings } = loadConfig();
  res.json({
    providers: providerStatus(),
    contestants: contestants.map(({ key, label, vendor, provider, model, available, pricing }) => ({
      key, label, vendor, provider, model, available, pricing
    })),
    judge: { label: judge.label, provider: judge.provider, model: judge.model, available: judge.available },
    settings,
    datasets: Object.entries(getDatasets()).map(([id, d]) => {
      let size = 0;
      try { size = loadDataset(id).length; } catch { /* ignore */ }
      return { id, label: d.label, size, custom: Boolean(d.custom), criteria: d.criteria.map(({ label, max }) => ({ label, max })) };
    }),
    runs: listRuns(),
    running: Boolean(activeRun)
  });
});

router.get("/api/live/preflight", async (req, res, next) => {
  try {
    const { contestants, judge } = loadConfig();
    const providers = [...new Set([...contestants.map((c) => c.provider), judge.provider])];
    const lists = Object.fromEntries(await Promise.all(providers.map(async (p) => [p, await listModels(p)])));

    const check = (provider, model) => {
      const list = lists[provider];
      if (!list?.ok) return { ok: false, reason: list?.error || "provider unavailable" };
      if (list.ids.includes(model)) return { ok: true };
      const stem = model.split("/").pop().split(/[-.:]/)[0];
      const suggestions = list.ids.filter((id) => id.toLowerCase().includes(stem.toLowerCase())).slice(0, 8);
      return { ok: false, reason: `model id not found on ${PROVIDERS[provider].label}`, suggestions };
    };

    res.json({
      providers: Object.fromEntries(Object.entries(lists).map(([p, l]) => [p, { ok: l.ok, error: l.error || null, modelCount: l.ids.length }])),
      contestants: contestants.map((c) => ({ key: c.key, label: c.label, provider: c.provider, model: c.model, ...check(c.provider, c.model) })),
      judge: { label: judge.label, provider: judge.provider, model: judge.model, ...check(judge.provider, judge.model) }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/live/run", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);

  if (activeRun) {
    send("fatal", { error: "A live run is already in progress. Wait for it to finish." });
    return res.end();
  }

  const dataset = getDataset(req.query.dataset) ? req.query.dataset : "aviation";
  const limit = Math.max(0, Math.min(100, Number(req.query.limit) || 0));
  const models = req.query.models ? String(req.query.models).split(",") : null;

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  activeRun = runLiveBenchmark({ dataset, limit, models }, send);
  try {
    await activeRun;
  } catch (error) {
    send("fatal", { error: error.message });
  } finally {
    clearInterval(heartbeat);
    activeRun = null;
    res.end();
  }
});

// Upload any Q&A dataset (JSON array or CSV) to benchmark live. Optional: name, rubric (grading guidance).
router.post("/api/live/datasets", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const rows = parseDatasetFile(req.file);
    const name = String(req.body?.name || req.file.originalname.replace(/\.[^.]+$/, "")).slice(0, 60);
    const rubric = String(req.body?.rubric || "").slice(0, 1500);
    const saved = saveCustomDataset({ name, rubric, rows });
    res.json({ ok: true, ...saved, name });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/api/live/runs", (req, res) => res.json({ runs: listRuns() }));

router.get("/api/live/runs/:id", (req, res) => {
  const run = loadRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No saved run found. Run a live benchmark first." });
  res.json(run);
});

module.exports = router;
