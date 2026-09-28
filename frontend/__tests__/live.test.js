/**
 * Live Benchmark tests — run against a local fake provider server, so no real keys are used.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { lexicalSimilarity, percentile, bootstrapCI } = require("../src/live/metrics");
const { shuffleLabels } = require("../src/live/judge");

describe("metrics", () => {
  it("lexical similarity is 1 for identical text and 0 for disjoint text", () => {
    expect(lexicalSimilarity("borescope inspection compressor", "borescope inspection compressor")).toBeCloseTo(1);
    expect(lexicalSimilarity("fuel pump", "oil filter")).toBe(0);
  });

  it("percentile interpolates", () => {
    expect(percentile([100, 200, 300, 400, 500], 50)).toBe(300);
    expect(percentile([100, 200], 95)).toBeCloseTo(195);
  });

  it("bootstrap CI brackets the mean", () => {
    const ci = bootstrapCI([60, 70, 80, 90, 100]);
    expect(ci.lower).toBeLessThanOrEqual(80);
    expect(ci.upper).toBeGreaterThanOrEqual(80);
  });
});

describe("judge blinding", () => {
  it("labels every answer once and is deterministic per seed", () => {
    const answers = ["a", "b", "c", "d"].map((key) => ({ key, text: key }));
    const one = shuffleLabels(answers, 3);
    const two = shuffleLabels(answers, 3);
    expect(one.map((a) => a.label)).toEqual(["A", "B", "C", "D"]);
    expect(one.map((a) => a.key)).toEqual(two.map((a) => a.key));
    expect(new Set(one.map((a) => a.key)).size).toBe(4);
  });
});

describe("live runner (fake providers)", () => {
  let server;
  let runsDir;
  let runLiveBenchmark;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const j = body ? JSON.parse(body) : {};
        const judgeReply = (prompt) => JSON.stringify({
          grades: [...prompt.matchAll(/### Answer ([A-Z])/g)].map((m) =>
            prompt.includes('"correctness":0')
              ? { id: m[1], correctness: 5, completeness: 2, verdict: "partial", rationale: "ok" }
              : { id: m[1], score: 8, verdict: "correct", rationale: "ok" })
        });
        res.setHeader("content-type", "application/json");
        if (req.url.includes("chat/completions") && j.model === "flaky-tpm" && !global.__flakyServed) {
          global.__flakyServed = true;
          res.statusCode = 429;
          return res.end(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute. Please try again in 120ms." } }));
        }
        if (req.url.includes("chat/completions")) {
          const prompt = j.messages[j.messages.length - 1].content;
          const usage = { prompt_tokens: 100, completion_tokens: 50 };
          if (req.url.startsWith("/or")) usage.cost = 0.00002;
          return res.end(JSON.stringify({ choices: [{ message: { content: j.response_format ? judgeReply(prompt) : "Borescope the HPC." } }], usage }));
        }
        if (req.url.includes("gemini-overloaded")) {
          res.statusCode = 503;
          return res.end(JSON.stringify({ error: { code: 503, message: "high demand" } }));
        }
        if (req.url.includes(":generateContent")) {
          const prompt = j.contents[0].parts[0].text;
          const text = j.generationConfig.responseMimeType ? judgeReply(prompt) : "Inspect compressor blades.";
          return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-runs-"));
    Object.assign(process.env, {
      GROQ_API_KEY: "test", OPENROUTER_API_KEY: "test", GEMINI_API_KEY: "test",
      GROQ_BASE_URL: `${base}/groq`, OPENROUTER_BASE_URL: `${base}/or`, GEMINI_BASE_URL: `${base}/gemini`,
      LIVE_RUNS_DIR: runsDir,
      LIVE_CUSTOM_DATASETS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "live-custom-"))
    });
    jest.resetModules();
    ({ runLiveBenchmark } = require("../src/live/runner"));
  });

  afterAll(() => server.close());

  it("answers, judges, summarises and saves a run", async () => {
    const events = [];
    const run = await runLiveBenchmark({ dataset: "aviation", limit: 2 }, (type) => events.push(type));

    expect(run.questions).toHaveLength(2);
    expect(run.summary).toHaveLength(4);
    for (const m of run.summary) {
      expect(m.errors).toBe(0);
      expect(m.accuracy).toBe(80);
      expect(m.latencyMs.mean).toBeGreaterThanOrEqual(0);
      if (m.costUsd.perAnswer !== null) expect(m.costUsd.perAnswer).toBeGreaterThan(0);
      expect(m.composite).toBeGreaterThan(0);
      expect(m.tier).toBeTruthy();
    }
    expect(run.summary.find((m) => m.provider === "openrouter").costUsd.source).toBe("billed");
    expect(events.filter((e) => e === "answer")).toHaveLength(8);
    expect(events.filter((e) => e === "judged")).toHaveLength(2);
    expect(events[events.length - 1]).toBe("done");
    expect(fs.readdirSync(runsDir)).toContain(`${run.id}.json`);
  });

  it("falls back to the backup model when the primary is overloaded", async () => {
    const { callModel } = require("../src/live/providers");
    const started = Date.now();
    const r = await callModel("gemini", {
      model: "gemini-overloaded",
      prompt: "hi",
      fallbacks: [{ provider: "gemini", model: "gemini-backup" }]
    });
    expect(r.fallbackUsed).toBe(true);
    expect(r.servedBy.model).toBe("gemini-backup");
    // second call skips the overloaded model immediately (circuit breaker)
    const t2 = Date.now();
    const r2 = await callModel("gemini", { model: "gemini-overloaded", prompt: "hi", fallbacks: [{ provider: "gemini", model: "gemini-backup" }] });
    expect(r2.servedBy.model).toBe("gemini-backup");
    expect(Date.now() - t2).toBeLessThan(1000);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15000);

  it("accepts an uploaded CSV dataset in any domain and grades it on generic criteria", async () => {
    const request = require("supertest");
    const { app } = require("../web/server");
    const csv = 'prompt,answer,difficulty\n"Capital of Karnataka?","Bengaluru",easy\n"GST standard rate slabs in India include?","5%, 12%, 18% and 28%",medium\n';
    const up = await request(app)
      .post("/api/live/datasets")
      .field("name", "India quiz")
      .field("rubric", "Accept Bangalore as Bengaluru.")
      .attach("file", Buffer.from(csv), { filename: "quiz.csv", contentType: "text/csv" });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ id: "custom:india-quiz", size: 2 });

    const cfg = await request(app).get("/api/live/config");
    expect(cfg.body.datasets.map((d) => d.id)).toContain("custom:india-quiz");

    const run = await runLiveBenchmark({ dataset: "custom:india-quiz" });
    expect(run.criteria.map((c) => c.key)).toEqual(["correctness", "completeness"]);
    const grade = run.questions[0].answers[0].grade;
    expect(grade.score).toBe(7);
    expect(grade.breakdown).toEqual({ correctness: 5, completeness: 2 });
  });

  it("rejects an upload with no usable question/answer rows", async () => {
    const request = require("supertest");
    const { app } = require("../web/server");
    const res = await request(app)
      .post("/api/live/datasets")
      .attach("file", Buffer.from('[{"foo":"bar"}]'), { filename: "bad.json", contentType: "application/json" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No usable rows/);
  });

  it("honours a short 'try again in Xms' rate limit instead of failing", async () => {
    const { callModel } = require("../src/live/providers");
    const r = await callModel("groq", { model: "flaky-tpm", prompt: "hi" });
    expect(r.text).toBeTruthy();
    expect(r.attempts).toBe(2);
    expect(r.fallbackUsed).toBe(false);
  });
});
