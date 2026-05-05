const path = require("path");

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, headerIndex) => {
      row[header || `column_${headerIndex + 1}`] = values[headerIndex] || "";
      return row;
    }, { id: index + 1 });
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseText(text) {
  return text
    .split(/\n\s*\n|\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => ({ id: index + 1, text: value }));
}

function normalizeJsonPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.samples)) return payload.samples;
  if (Array.isArray(payload.questions)) return payload.questions;
  return [payload];
}

function parseDatasetFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const text = file.buffer.toString("utf8");

  if (ext === ".json" || file.mimetype === "application/json") {
    return normalizeJsonPayload(JSON.parse(text));
  }

  if (ext === ".csv" || file.mimetype === "text/csv") {
    return parseCsv(text);
  }

  return parseText(text);
}

function getDatasetSamples(records, limit = 10) {
  return records.slice(0, limit).map((record) => {
    if (typeof record === "string") return { text: record };
    return record;
  });
}

module.exports = {
  parseDatasetFile,
  getDatasetSamples,
  parseCsv,
  parseText
};
