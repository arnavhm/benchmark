const express = require("express");
const path = require("path");
const fs = require("fs");
// The routes are located at project-root `src/routes/...` (not under web/)
const rankingRoutes = require("../src/routes/rankings");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(__dirname, "..", "..", ".env"));

const app = express();
const PORT = process.env.PORT || 5002;

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(rankingRoutes);

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
  });
}

module.exports = { app };
