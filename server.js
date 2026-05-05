const express = require("express");
const path = require("path");
const rankingRoutes = require("./src/routes/rankings");

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

app.listen(PORT, () => {
  console.log(`AI Benchmark Analyzer running at http://127.0.0.1:${PORT}`);
});
