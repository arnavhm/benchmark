const request = require("supertest");
const path = require("path");
const fs = require("fs");

const { app } = require("../web/server");

// ─── POST /api/models/rankings ────────────────────────────────────────────────

describe("POST /api/models/rankings", () => {
  const RANKING_SHAPE = expect.objectContaining({
    rankings: expect.arrayContaining([
      expect.objectContaining({
        model: expect.any(String),
        finalScore: expect.any(Number),
      }),
    ]),
    best_model: expect.any(String),
    weights_used: expect.any(Object),
    explanation: expect.any(String),
  });

  it("returns 200 with default weights", async () => {
    const res = await request(app).post("/api/models/rankings").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RANKING_SHAPE);
  });

  it("returns all 8 models ranked", async () => {
    const res = await request(app).post("/api/models/rankings").send({});
    expect(res.status).toBe(200);
    expect(res.body.rankings).toHaveLength(8);
  });

  it("each ranked model includes category scores", async () => {
    const res = await request(app).post("/api/models/rankings").send({});
    for (const model of res.body.rankings) {
      expect(typeof model.coding).toBe("number");
      expect(typeof model.math).toBe("number");
      expect(typeof model.reasoning).toBe("number");
      expect(typeof model.chat).toBe("number");
    }
  });

  it("applies custom weights and returns a ranked list", async () => {
    const res = await request(app)
      .post("/api/models/rankings")
      .send({ weights: { coding: 60, math: 10, reasoning: 20, chat: 10 } });
    expect(res.status).toBe(200);
    expect(res.body.rankings.length).toBeGreaterThan(0);
    expect(res.body.weights_used).toMatchObject({ coding: 60 });
  });

  it("accepts sortBy and filterCategory without error", async () => {
    const res = await request(app)
      .post("/api/models/rankings")
      .send({ sortBy: "score", filterCategory: "coding" });
    expect(res.status).toBe(200);
  });

  it("ranks are in descending score order", async () => {
    const res = await request(app).post("/api/models/rankings").send({});
    const scores = res.body.rankings.map((r) => r.finalScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});

// ─── POST /upload-custom-dataset ─────────────────────────────────────────────

describe("POST /upload-custom-dataset", () => {
  const FIXTURE = path.join(__dirname, "fixtures", "math_sample.json");

  it("returns 200 with a valid JSON dataset", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/3 samples/);
  });

  it("response includes ranking and dataset analysis", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ranking: expect.any(Array),
        analysis: expect.objectContaining({
          type: expect.any(String),
          difficulty: expect.any(String),
        }),
      })
    );
  });

  it("ranking is non-empty and each entry has a model name", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    expect(res.body.ranking.length).toBeGreaterThan(0);
    for (const entry of res.body.ranking) {
      expect(typeof entry.model).toBe("string");
    }
  });

  it("returns 400 when no file is attached", async () => {
    const res = await request(app).post("/upload-custom-dataset").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for an empty dataset", async () => {
    const emptyBuf = Buffer.from("[]");
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", emptyBuf, { filename: "empty.json", contentType: "application/json" });
    expect(res.status).toBe(400);
  });

  it("respects an explicit taskType override", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false")
      .field("taskType", "math");
    expect(res.status).toBe(200);
    expect(res.body.analysis.type).toBe("math");
  });

  it("includes sample rows in the response", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    expect(Array.isArray(res.body.samples)).toBe(true);
    expect(res.body.samples.length).toBeGreaterThan(0);
  });

  it("includes evaluation_metrics with n_trials and per-model stats", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    expect(res.status).toBe(200);
    const em = res.body.evaluation_metrics;
    expect(em).toBeDefined();
    expect(em.n_trials).toBe(5);
    expect(em.dataset_size).toBe(3);
    expect(typeof em.task_type).toBe("string");
    expect(typeof em.models).toBe("object");
    expect(Object.keys(em.models).length).toBeGreaterThan(0);
  });

  it("each model in evaluation_metrics has accuracy mean/std and 95% CI", async () => {
    const res = await request(app)
      .post("/upload-custom-dataset")
      .attach("file", FIXTURE)
      .field("useLLM", "false");
    const models = res.body.evaluation_metrics.models;
    for (const [, stats] of Object.entries(models)) {
      expect(typeof stats.accuracy.mean).toBe("number");
      expect(typeof stats.accuracy.std).toBe("number");
      expect(typeof stats.accuracy.ci_lower).toBe("number");
      expect(typeof stats.accuracy.ci_upper).toBe("number");
      expect(stats.accuracy.ci_upper).toBeGreaterThanOrEqual(stats.accuracy.ci_lower);
      expect(typeof stats.f1.mean).toBe("number");
      expect(typeof stats.error_rate).toBe("number");
    }
  });

  it("evaluation_metrics is deterministic across identical calls", async () => {
    const call = () =>
      request(app)
        .post("/upload-custom-dataset")
        .attach("file", FIXTURE)
        .field("useLLM", "false");
    const [r1, r2] = await Promise.all([call(), call()]);
    expect(r1.body.evaluation_metrics).toEqual(r2.body.evaluation_metrics);
  });
});
