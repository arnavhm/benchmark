#!/usr/bin/env node
/** Interactive key setup: `npm run setup`. Writes the keys to <project>/.env correctly on any OS. */
const readline = require("readline");
const { loadEnv, saveKeys, keyReport, ROOT_ENV, KEY_NAMES } = require("./env");

const HELP = {
  GROQ_API_KEY: "https://console.groq.com/keys (starts with gsk_)",
  OPENROUTER_API_KEY: "https://openrouter.ai/keys (starts with sk-or-)",
  GEMINI_API_KEY: "https://aistudio.google.com/app/apikey (starts with AIza)"
};

(async () => {
  loadEnv();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  console.log(`\nAPI key setup — keys are saved to ${ROOT_ENV}\nPress Enter to keep an existing key.\n`);
  console.log(`Current:\n${keyReport()}\n`);
  const updates = {};
  for (const k of KEY_NAMES) {
    const v = (await ask(`${k}  [${HELP[k]}]\n> `)).trim();
    if (v) updates[k] = v;
  }
  rl.close();
  if (Object.keys(updates).length) {
    const r = saveKeys(updates);
    console.log(`\n✅ Saved ${r.saved.join(", ")} to ${r.file}`);
  }
  console.log(`\nNow:\n${keyReport()}\n\nNext: npm run live:check   then   npm start\n`);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
