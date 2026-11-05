#!/usr/bin/env bash
# init.sh -- smoke check: installs deps (npm ci unless SKIP_INSTALL=1), starts the API, checks /health, then stops it.
# Env: API_PORT (default 3000; passed to the server as PORT), SKIP_INSTALL. For a long-running dev server use `npm run dev -w apps/api`.
# Stack: npm workspaces (apps/api Fastify, apps/web Vite). Supabase is remote; no local DB step.
# Until F030 (monorepo scaffold) is passing there is no package.json: the script says so and exits 0.
set -euo pipefail

cd "$(dirname "$0")/.."
API_PORT="${API_PORT:-3000}"
API_URL="http://127.0.0.1:${API_PORT}"

if [ ! -f package.json ]; then
  echo "init.sh: no package.json yet -- scaffold pending (feature F030). Nothing to start."
  exit 0
fi

if [ ! -f apps/api/package.json ]; then
  echo "init.sh: apps/api not scaffolded yet -- API skeleton pending (feature F032). Run npm ci first to install dependencies. Nothing to start."
  exit 0
fi

echo "== 1. dependencies =="
if [ -z "${SKIP_INSTALL:-}" ]; then npm ci; fi

echo "== 2. environment =="
# Variable names live in .env.example; values are never printed.
if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example (safe defaults, no secrets). Edit it for local overrides; never commit it."
fi
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

echo "== 3. start API =="
LOG_FILE="$(mktemp -t decidere-api.XXXXXX.log)"  # server logs carry no payloads by design (see AGENTS.md)
if curl -s -o /dev/null "${API_URL}/health"; then
  echo "FAIL: port ${API_PORT} is busy -- something already answers ${API_URL}/health. Stop it or set API_PORT." >&2
  exit 1
fi
# Run node directly (the npm wrapper does not forward SIGTERM) in its own session, so the
# trap can signal the whole group. No --watch: a failed start must exit so the loop below sees it.
PORT="$API_PORT" setsid node apps/api/src/server.ts >"$LOG_FILE" 2>&1 &
API_PID=$!
cleanup() {
  kill -- "-${API_PID}" 2>/dev/null || true
  for _ in $(seq 1 50); do kill -0 "-${API_PID}" 2>/dev/null || return 0; sleep 0.1; done
  kill -KILL -- "-${API_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "== 4. end-to-end health check =="
for _ in $(seq 1 30); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "FAIL: API process exited early. Last log lines:" >&2
    tail -n 20 "$LOG_FILE" >&2
    exit 1
  fi
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
