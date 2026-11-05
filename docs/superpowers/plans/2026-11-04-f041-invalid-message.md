# F041 POST /v1/messages, structured invalid message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every way a message can be rejected at `POST /v1/messages` answers a structured 4xx whose code is countable by the runner (F050), and failures that never reach a Fastify handler are structured and logged too.

**Architecture:** F036 and F040 already produce the structured errors. This feature pins the whole invalid matrix on the real route with a canary per case (Task 1) and closes the one gap F036's review named: socket-level rejections (`clientError`) that bypass the handler (Task 2). No in-memory counter: the runner counts HTTP responses by `error.code`; a persisted counter arrives with F055.

**Tech Stack:** TypeScript on Node, Fastify 5.12.8, `node:test`, `@decidere/schema`.

**Spec:** `docs/progress/feature-list.json` F041 (+ notes), ADR-008 (error table, "Todo rechazo debe quedar contado por código"), AGENTS.md "Errores", ADR-001.

## Global Constraints

- Closed error codes and fixed messages stay as in `apps/api/src/errors.ts`; no value, key or parser text is ever reflected (ADR-001/008).
- No state in memory between requests (AGENTS.md "Stack"): no counters in the API process.
- Do not edit existing tests. Synthetic data only. Code and commits in English, docs in Spanish. Branch `feat/f041-invalid-message`, stacked on `feat/f040-post-messages`. No push without approval.
- Fastify option for socket-level errors: `clientErrorHandler?: (error: ConnectionError, socket: Socket) => void` (verified in `node_modules/fastify/fastify.d.ts:210`, Fastify 5.12.8). Check at runtime that it replaces Node's default 400 before relying on it.

## Review Focus

1. Each invalid class below leaks no canary in body, headers or logs.
2. A request cut mid-body or with a malformed HTTP line gets a structured 400 with `x-request-id`, not Node's bare `HTTP/1.1 400 Bad Request`.
3. A valid message is never rejected by the new code: Task 2 re-runs `ingest.test.ts` and `tests/post-messages.e2e.test.ts` unchanged.
4. A client that sends a valid request in several slow TCP chunks is not treated as a client error (Task 2 test: a split valid request still gets 200).
5. Socket-level handler never throws or leaks the Node error text, even for a destroyed socket (Task 2 test: write to an already-destroyed socket does not crash the process).

---

### Task 1: Invalid matrix on the real route

**Files:**
- Test: `apps/api/src/ingest-invalid.test.ts`

**Interfaces:**
- Consumes: `buildApp({ logStream, rules, allowedSources })` as in `ingest.test.ts`.
- Produces: nothing (tests only).

- [ ] **Step 1: Write the tests.** One table-driven test per row, each posting a synthetic message with a canary string in the offending field and asserting status, `error.code`, fixed `error.message`, `x-request-id` header, `cache-control: no-store`, and that the canary is absent from body, headers and captured logs:
  - `schema_version: "9.9"` → 422 `validation_failed`, details `[{path:"/schema_version", code:"unsupported_version"}]`
  - missing `instances` → 422, `required`
  - unknown top-level field named with the canary → 422, `unknown_field`, canary absent
  - `value: "canary"` (string) → 422, `invalid_type`
  - `value: 9999` for `resp_rate` → 422, `out_of_range`
  - duplicate (variable, offset) pair → 422, `duplicate_measurement`
  - `instances: []` → 422, `out_of_range`
  - malformed JSON with canary → 400 `invalid_json`
  - source outside the allowlist, canary-valued → 403 `forbidden`
  - body over 131072 bytes → 413
  - `text/plain` → 415
  - `PUT /v1/messages` → 404 `not_found`
- [ ] **Step 2: Run** `node --test apps/api/src/ingest-invalid.test.ts` → Expected: PASS (behavior exists since F036/F040). If a row fails, it is a bug: apply systematic debugging, fix with a RED test first.
- [ ] **Step 3: Commit** `test(api): pin the invalid-message matrix on POST /v1/messages`.

### Task 2: Structured answer for socket-level rejections

**Files:**
- Modify: `apps/api/src/app.ts` (Fastify option for client errors)
- Test: `apps/api/src/client-error.test.ts`

**Interfaces:**
- Produces: a client-error handler that writes a raw HTTP/1.1 400 response with `content-type: application/json`, `cache-control: no-store`, `x-request-id` (fresh UUID), body `errorBody("bad_request", id)`, then closes the socket; and logs one line `{ apiError: { code: "bad_request", status: 400 } }` with no error text.

- [ ] **Step 1: Write failing tests** with a real listening app and `node:net`: (a) a malformed request line (`"GARBAGE\r\n\r\n"`) gets a response whose body parses to `{"error":{"code":"bad_request",...}}` with an `x-request-id`; (b) logs hold the apiError line and no byte of the sent garbage; (c) a valid request split across two TCP writes still gets 200; (d) a handler call with an already-destroyed socket does not throw.
- [ ] **Step 2: Run** → FAIL (Node's default bare 400).
- [ ] **Step 3: Implement** the handler through `clientErrorHandler`, using `errorBody` and `STATUS` from `errors.ts`; write with `socket.end` only if the socket is writable.
- [ ] **Step 4: Run** `npm test -w apps/api` → PASS, no existing test edited.
- [ ] **Step 5: Commit** `feat(api): answer socket-level rejections with a structured 400`.

### Task 3: Docs and status

- [ ] **Step 1:** ADR-008 (Spanish): list how the runner counts (by `error.code` in the response; socket-level 400 included; process-level cuts that send nothing are visible only as a missing response, so the runner treats no-response as rejected).
- [ ] **Step 2:** `PROGRESS.md` entry; `feature-list.json` F041 `passing` only if both criteria have evidence. Criterion 2 ("the runner counts") needs F050, which does not exist: mark F041 `passing` for the API side and keep the runner criterion as a handoff in `notes`, or leave it `failing` (ask the user).
- [ ] **Step 3:** `npm run verify` and `npm run scan:phi`; run `/clinical-review`; commit `docs(adr): record how rejected messages are counted`.

## Not in this plan

- The runner, the simulator and the coverage metric (F050); persisted counters (F055); auth/rate-limit codes 401/429 (F052/F057/F064); log retention docs (F011).
