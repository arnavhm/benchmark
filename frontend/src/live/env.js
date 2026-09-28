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

// Accepted file names, in priority order. ".env.example" is a last resort so a demo still works
// when keys were typed straight into the example file (never commit real keys!).
const NAMES = [".env", ".env.local", ".env.txt", "env", "env.txt", ".env.example"];

function loadEnv() {
  const root = path.join(__dirname, "..", "..", "..");
  const dirs = [...new Set([root, path.join(root, "frontend"), process.cwd()])];
  const loaded = [];
  for (const name of NAMES) {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const vars = parse(fs.readFileSync(file, "utf8"));
      let used = false;
      for (const [k, v] of Object.entries(vars)) {
        if (!isReal(process.env[k]) && (isReal(v) || process.env[k] === undefined)) {
          process.env[k] = v;
          if (isReal(v) && /_API_KEY$/.test(k)) used = true;
        }
      }
      if (used || name === ".env") loaded.push(file);
    }
  }
  return loaded;
}

/** Files in the project root that look like env files — printed when keys are missing, to help debugging. */
function envLikeFiles() {
  const root = path.join(__dirname, "..", "..", "..");
  try {
    return fs.readdirSync(root).filter((f) => /env/i.test(f));
  } catch {
    return [];
  }
}

function keyReport() {
  const mask = (v) => (isReal(v) ? `set (${v.trim().slice(0, 4)}…${v.trim().slice(-3)})` : "MISSING");
  return ["GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"].map((k) => `  ${k}: ${mask(process.env[k])}`).join("\n");
}

const KEY_NAMES = ["GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"];
const ROOT_ENV = process.env.LIVE_ENV_FILE || path.join(__dirname, "..", "..", "..", ".env");

/**
 * Save keys to the project-root .env (creating it if needed), replacing any existing
 * lines for those keys, and apply them to this process immediately.
 */
function saveKeys(updates) {
  const clean = {};
  for (const k of KEY_NAMES) {
    let v = updates[k];
    if (typeof v !== "string") continue;
    v = v.trim().replace(/^["']|["']$/g, "");
    if (!v) continue;
    if (/[\s=]/.test(v)) throw new Error(`${k} looks malformed (contains spaces or '=').`);
    clean[k] = v;
  }
  if (!Object.keys(clean).length) throw new Error("No keys provided.");
  const existing = fs.existsSync(ROOT_ENV) ? fs.readFileSync(ROOT_ENV, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/) : [];
  const kept = existing.filter((line) => {
    const key = line.replace(/^\s*export\s+/, "").split("=")[0].trim();
    return !(key in clean);
  });
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const lines = [...kept, ...Object.entries(clean).map(([k, v]) => `${k}=${v}`), ""];
  fs.writeFileSync(ROOT_ENV, lines.join("\n"));
  for (const [k, v] of Object.entries(clean)) process.env[k] = v;
  return { file: ROOT_ENV, saved: Object.keys(clean) };
}

function keyStatus() {
  return Object.fromEntries(KEY_NAMES.map((k) => {
    const v = process.env[k];
    return [k, isReal(v) ? { set: true, hint: `${v.trim().slice(0, 4)}…${v.trim().slice(-3)}` } : { set: false }];
  }));
}

module.exports = { loadEnv, keyReport, parse, envLikeFiles, saveKeys, keyStatus, KEY_NAMES, ROOT_ENV };
