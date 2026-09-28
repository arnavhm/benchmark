/**
 * Robust .env loader shared by the web server and the CLI.
 * - Looks for .env in the project root, frontend/ and the current directory.
 * - Real values beat placeholders (e.g. "your_groq_api_key_here"), and later lines beat earlier ones,
 *   so appending keys below the copied .env.example lines works.
 * - Strips surrounding quotes, "export " prefixes, BOM and Windows line endings.
 * - A real environment variable is only kept if it is not empty or a placeholder.
 */
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = /^(your_|<|changeme|xxx|placeholder|paste_)/i;
const isReal = (v) => typeof v === "string" && v.trim() !== "" && !PLACEHOLDER.test(v.trim());

function parse(text) {
  const out = {};
  for (let line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const key = line.slice(0, line.indexOf("=")).trim();
    let value = line.slice(line.indexOf("=") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (!key) continue;
    // later real values win; a placeholder never overwrites a real value
    if (isReal(value) || !(key in out)) out[key] = value;
  }
  return out;
}

function loadEnv() {
  const root = path.join(__dirname, "..", "..", "..");
  const candidates = [...new Set([
    path.join(root, ".env"),
    path.join(root, "frontend", ".env"),
    path.join(process.cwd(), ".env")
  ])];
  const loaded = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    loaded.push(file);
    const vars = parse(fs.readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(vars)) {
      if (!isReal(process.env[k]) && (isReal(v) || process.env[k] === undefined)) process.env[k] = v;
    }
  }
  return loaded;
}

function keyReport() {
  const mask = (v) => (isReal(v) ? `set (${v.trim().slice(0, 4)}…${v.trim().slice(-3)})` : "MISSING");
  return ["GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"].map((k) => `  ${k}: ${mask(process.env[k])}`).join("\n");
}

module.exports = { loadEnv, keyReport, parse };
