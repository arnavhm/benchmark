#!/usr/bin/env bash
# demo.sh — boot the benchmark server and run a quick end-to-end smoke test.
# Usage: bash scripts/demo.sh [--keep]
#   --keep  leave the server running after the demo completes

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-5002}"
BASE="http://127.0.0.1:${PORT}"
KEEP=false

for arg in "$@"; do
  [[ "$arg" == "--keep" ]] && KEEP=true
done

# ── helpers ──────────────────────────────────────────────────────────────────
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    green "Server stopped."
  fi
}

# ── pre-flight ────────────────────────────────────────────────────────────────
cd "$ROOT"

command -v node >/dev/null 2>&1 || { red "node not found — install Node.js >=18"; exit 1; }
command -v curl >/dev/null 2>&1 || { red "curl not found"; exit 1; }

if [[ ! -d node_modules ]]; then
  yellow "Installing npm dependencies…"
  npm install --silent
fi

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  yellow "No .env found — copying from .env.example (Gemini features will use rule-based fallback)"
  cp .env.example .env
fi

# ── start server (skip if already running, clear stale processes if needed) ───
if curl -sf "${BASE}/" -o /dev/null 2>/dev/null; then
  green "Server already running at ${BASE} — reusing it."
  SERVER_PID=""
else
  # Kill any stale process occupying the port
  STALE=$(lsof -ti :"${PORT}" 2>/dev/null || true)
  if [[ -n "$STALE" ]]; then
    yellow "Clearing stale process on port ${PORT} (PID ${STALE})…"
    kill "$STALE" 2>/dev/null || true
    sleep 0.5
  fi

  green "Starting server on port ${PORT}…"
  node web/server.js &
  SERVER_PID=$!
  [[ "$KEEP" == "false" ]] && trap cleanup EXIT

  # wait up to 10 s for the server to become ready
  for i in $(seq 1 20); do
    curl -sf "${BASE}/" -o /dev/null 2>/dev/null && break
    sleep 0.5
  done
  curl -sf "${BASE}/" -o /dev/null 2>/dev/null || { red "Server did not start in time."; exit 1; }
  green "Server is up at ${BASE}"
fi

# ── demo requests ─────────────────────────────────────────────────────────────
echo ""
yellow "── 1. Default rankings (equal weights) ──────────────────────────────────"
curl -s -X POST "${BASE}/api/models/rankings" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Top model : {d[\"best_model\"]}')
print(f'Explanation: {d[\"explanation\"]}')
print('Rankings:')
for r in d['rankings'][:5]:
    print(f'  #{r[\"rank\"]:1d}  {r[\"model\"]:<28s}  score={r[\"finalScore\"]:.1f}')
"

echo ""
yellow "── 2. Coding-heavy weights (coding=60, math=10, reasoning=20, chat=10) ──"
curl -s -X POST "${BASE}/api/models/rankings" \
  -H "Content-Type: application/json" \
  -d '{"weights":{"coding":60,"math":10,"reasoning":20,"chat":10}}' \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Top model: {d[\"best_model\"]}')
for r in d['rankings'][:3]:
    print(f'  #{r[\"rank\"]:1d}  {r[\"model\"]:<28s}  score={r[\"finalScore\"]:.1f}  coding={r[\"coding\"]}')
"

echo ""
yellow "── 3. Upload custom dataset (math_sample.json fixture) ─────────────────"
FIXTURE="${ROOT}/__tests__/fixtures/math_sample.json"
if [[ -f "$FIXTURE" ]]; then
  curl -s -X POST "${BASE}/upload-custom-dataset" \
    -F "file=@${FIXTURE};type=application/json" \
    -F "useLLM=false" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'{d[\"message\"]}')
print(f'Dataset type  : {d[\"analysis\"][\"type\"]}')
print(f'Difficulty     : {d[\"analysis\"][\"difficulty\"]}')
print(f'Recommended    : {d[\"recommendedModel\"]}  (confidence {d[\"confidence\"]}%)')
print(f'Top 3 rankings:')
for r in d['ranking'][:3]:
    print(f'  #{r[\"rank\"]:1d}  {r[\"model\"]:<28s}  score={r[\"score\"]:.1f}')
"
else
  yellow "Fixture not found at ${FIXTURE} — skipping upload demo"
fi

echo ""
green "Demo complete. Open ${BASE} in a browser to explore the dashboard."
if [[ "$KEEP" == "true" && -n "${SERVER_PID:-}" ]]; then
  yellow "Server still running (PID ${SERVER_PID}). Stop it with: kill ${SERVER_PID}"
fi
exit 0
