const fs = require("fs/promises");
const path = require("path");

const MODELS_PATH = path.join(__dirname, "..", "..", "data", "models.json");

async function loadModelsFromFile(filePath = MODELS_PATH) {
  const raw = await fs.readFile(filePath, "utf8");
  const payload = JSON.parse(raw);

  return {
    source: payload.source || "local-json",
    lastUpdated: payload.lastUpdated || new Date().toISOString(),
    models: Array.isArray(payload.models) ? payload.models : []
  };
}

async function fetchModelsFromApi(apiUrl) {
  if (!apiUrl) {
    const local = await loadModelsFromFile();
    return {
      ...local,
      source: "mock-api",
      lastUpdated: new Date().toISOString()
    };
  }

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Model API failed with ${response.status}`);
  }

  const payload = await response.json();
  return {
    source: payload.source || apiUrl,
    lastUpdated: payload.lastUpdated || new Date().toISOString(),
    models: Array.isArray(payload.models) ? payload.models : payload
  };
}

async function getModels(source = "local") {
  if (source === "api") {
    return fetchModelsFromApi(process.env.MODELS_API_URL);
  }

  return loadModelsFromFile();
}

module.exports = {
  getModels,
  loadModelsFromFile,
  fetchModelsFromApi
};
