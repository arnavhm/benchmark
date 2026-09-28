const fs = require("fs");
const os = require("os");
const path = require("path");

const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "envtest-")), ".env");
process.env.LIVE_ENV_FILE = envFile;
fs.writeFileSync(envFile, "PORT=5002\nGROQ_API_KEY=your_groq_api_key_here\nDEBUG_API=false\n");
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

const request = require("supertest");
const { app } = require("../web/server");

describe("API keys from the dashboard", () => {
  it("saves pasted keys to .env, replaces placeholders, keeps other lines, applies immediately", async () => {
    const res = await request(app).post("/api/live/keys").send({ GROQ_API_KEY: " gsk_test_123 ", GEMINI_API_KEY: '"AIza_test_456"' });
    expect(res.status).toBe(200);
    expect(res.body.saved).toEqual(["GROQ_API_KEY", "GEMINI_API_KEY"]);
    const text = fs.readFileSync(envFile, "utf8");
    expect(text).toContain("PORT=5002");
    expect(text).toContain("DEBUG_API=false");
    expect(text).toContain("GROQ_API_KEY=gsk_test_123");
    expect(text).toContain("GEMINI_API_KEY=AIza_test_456");
    expect(text).not.toContain("your_groq_api_key_here");
    expect(process.env.GROQ_API_KEY).toBe("gsk_test_123");

    const status = await request(app).get("/api/live/keys");
    expect(status.body.keys.GROQ_API_KEY).toEqual({ set: true, hint: "gsk_…123" });
    expect(JSON.stringify(status.body)).not.toContain("gsk_test_123");

    const cfg = await request(app).get("/api/live/config");
    expect(cfg.body.providers.groq.keySet).toBe(true);
  });

  it("rejects empty or malformed keys", async () => {
    expect((await request(app).post("/api/live/keys").send({})).status).toBe(400);
    expect((await request(app).post("/api/live/keys").send({ GROQ_API_KEY: "gsk bad key" })).status).toBe(400);
  });
});
