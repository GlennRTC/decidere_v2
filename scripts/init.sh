#!/usr/bin/env bash
# init.sh -- installs deps, starts the API in dev mode and runs an end-to-end smoke check.
# Stack: npm workspaces (apps/api Fastify, apps/web Vite). Supabase is remote; no local DB step.
# Until F001 (monorepo scaffold) is passing there is no package.json: the script says so and exits 0.
set -euo pipefail

cd "$(dirname "$0")/.."
API_PORT="${API_PORT:-3000}"
API_URL="http://localhost:${API_PORT}"

if [ ! -f package.json ]; then
  echo "init.sh: no package.json yet -- scaffold pending (feature F001). Nothing to start."
  exit 0
fi

echo "== 1. dependencies =="
npm install

echo "== 2. environment =="
# Variable names live in .env.example; values are never printed.
if [ -f .env.example ] && [ ! -f .env ]; then
  echo "Missing .env -- copy .env.example to .env and fill in the values (never commit it)." >&2
  exit 1
fi

echo "== 3. start API (dev) =="
LOG_FILE="$(mktemp -t decidere-api.XXXXXX.log)"  # server logs carry no payloads by design (see AGENTS.md)
PORT="$API_PORT" npm run dev -w apps/api >"$LOG_FILE" 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

echo "== 4. end-to-end health check =="
for _ in $(seq 1 30); do
  if curl -sf "${API_URL}/health" >/dev/null; then
    echo "OK: ${API_URL}/health responded (pid ${API_PID}, log ${LOG_FILE})"
    # Smoke test of the central flow, once a synthetic seed exists.
    SMOKE_SEED="seeds/smoke.json"
    if [ -f "$SMOKE_SEED" ]; then
      : "${INGEST_API_KEY:?INGEST_API_KEY must be set to POST /v1/messages}"
      curl -sf -X POST "${API_URL}/v1/messages" \
        -H "content-type: application/json" -H "x-api-key: ${INGEST_API_KEY}" \
        --data-binary "@${SMOKE_SEED}" >/dev/null \
        && echo "OK: POST /v1/messages accepted ${SMOKE_SEED}" \
        || { echo "FAIL: POST /v1/messages smoke test" >&2; exit 1; }
    else
      echo "NOTE: ${SMOKE_SEED} not found -- POST smoke test skipped."
    fi
    exit 0
  fi
  sleep 1
done

echo "FAIL: API did not answer ${API_URL}/health in 30s. Last log lines:" >&2
tail -n 20 "$LOG_FILE" >&2
exit 1
