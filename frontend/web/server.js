const express = require("express");
const path = require("path");
const fs = require("fs");
// The routes are located at project-root `src/routes/...` (not under web/)
const rankingRoutes = require("../src/routes/rankings");
const liveRoutes = require("../src/routes/live");

const { loadEnv, keyReport } = require("../src/live/env");
const envFiles = loadEnv();

const app = express();
const PORT = process.env.PORT || 5002;

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(rankingRoutes);
app.use(liveRoutes);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: "Unable to process ranking request.",
    detail: error.message
  });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Benchmark Analyzer running at http://127.0.0.1:${PORT}`);
    console.log(envFiles.length ? `Loaded .env from: ${envFiles.join(", ")}` : "No .env file found - create one in the project root (copy .env.example).");
    console.log(`API keys:\n${keyReport()}`);
  });
}

module.exports = { app };
