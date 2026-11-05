# F011 Structured logging without PHI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin, with tests, that every log line the API emits uses only an approved set of fields and never carries a request value, and make that set the documented contract.

**Architecture:** The logging code already exists (pino through Fastify, serializers in `apps/api/src/app.ts`, success line in `ingest.ts`). F011 adds an audit helper that parses captured log lines and checks key paths and values, drives it over every request class (success, each rejection, socket-level, 500) and over a real server process, and removes pino's default `pid` and `hostname` so the field set equals what AGENTS.md can list.

**Tech Stack:** TypeScript on Node, Fastify 5 / pino, `node:test`.

**Spec:** `docs/progress/feature-list.json` F011 (3 criteria + note "test canario con valor centinela en logs y errores"), AGENTS.md "Convenciones: Logging" and "Reglas no negociables de dominio", ADR-001, ADR-008 (F040/F041 sections).

## Decisions that need the user's approval

1. **Amend AGENTS.md "Logging"** (project document): keep the clinical fields (`message_id`, `case_id`, class, certainty, fired rule ids) and add the operational ones the code already emits: `level`, `time`, `msg` (closed set), `reqId`/`request_id`, `req.method`, `req.path` (no query string), `res.statusCode`, `responseTime`, `historical_ignored`, `apiError{code,status,count}`, `err{name,code}`. Without this, criterion 3 ("exactly the fields in AGENTS.md") cannot be true.
2. **Drop pino's `pid` and `hostname`** (`base: null`). They are infrastructure identifiers, not clinical, but they are not in the contract and add nothing in a serverless host.

## Global Constraints

- Never in any log line: payload, `instance_id`, `source`, variable names or values, units, `t_offset_min`, trace, headers, query string, request-body text, parser or V8 error messages (ADR-001, AGENTS.md).
- Log `err` as `{name, code}` only, strings, bounded to 64 characters (already enforced by `errSerializer`).
- No state in memory between requests; no new dependency.
- Do not edit existing tests. Synthetic data only; sentinels are fake. Code and commits in English; docs in Spanish. Branch `feat/f011-logging-no-phi`, from `main`. No push without approval.

## Review Focus

1. A later change that logs one extra field (for example `observed` or `source`) must fail a test (Task 1 proves the audit rejects it).
2. A sentinel placed in the query string, a header, a body value, a body key name and the `source` never appears in any log value or key (Task 2).
3. `err` never carries `message` or `stack` on any path, including the 500 path (Task 2).
4. Startup and shutdown lines of the real process obey the same set (Task 3).
5. The success line's `results[].certainty` is `null` today and stays within the set when F047 gives it a number (Task 1: allowed types for `certainty` are `null | number`).

---

### Task 1: Log audit helper

**Files:**
- Create: `apps/api/src/testing/log-audit.ts`
- Test: `apps/api/src/testing/log-audit.test.ts`

**Interfaces:**
- Produces:
  - `ALLOWED_LOG_PATHS: ReadonlySet<string>` — flattened key paths, arrays as `[]`: `level`, `time`, `reqId`, `request_id`, `msg`, `req.method`, `req.path`, `res.statusCode`, `responseTime`, `message_id`, `historical_ignored`, `results[].case_id`, `results[].class`, `results[].certainty`, `results[].rules_fired[]`, `apiError.code`, `apiError.status`, `apiError.count`, `err.name`, `err.code`.
  - `ALLOWED_MESSAGES: ReadonlySet<string>` — `incoming request`, `request completed`, `message interpreted`, `request failed`, `request error`; plus the pattern `^Server listening at http://127\.0\.0\.1:\d+$` for the listen line.
  - `auditLogLines(raw: string, forbidden: readonly (string | number)[]): { lines: number; problems: string[] }` — parses NDJSON; returns a problem for each unknown key path, unknown `msg`, non-JSON line, and for any string or number leaf (excluding `time`, `responseTime`) equal to or containing a forbidden value (strings by substring, numbers by equality).

- [ ] **Step 1: Write failing tests** in `log-audit.test.ts`: `accepts a success line`; `rejects an extra field (observed)`; `rejects hostname and pid`; `rejects a forbidden string inside a value`; `rejects a forbidden number as a value but ignores time and responseTime`; `rejects an unknown msg`; `rejects a non-JSON line`; `allows certainty null and a number`.
- [ ] **Step 2: Run** `node --test apps/api/src/testing/log-audit.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the helper (flatten with array marker `[]`; leaf scan).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `test(api): add a log audit helper with an approved field set`.

### Task 2: Audit every request class

**Files:**
- Modify: `apps/api/src/app.ts` (`base: null` in the logger options, after approval 2)
- Test: `apps/api/src/logging.test.ts`

**Interfaces:**
- Consumes: `auditLogLines`, `buildApp({ logStream, rules, allowedSources })`.

- [ ] **Step 1: Write failing tests**, each capturing logs and asserting `problems` is `[]`, using sentinels `forbidden = [197, 391, 13, "sentinelq7", "sentinel-src", "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26", "resp_rate", "sbp", "gcs", "mm[Hg]"]` plus the response body for error cases (no sentinel number or string inside `error`): success with sentinel values (200); all-null (200); 422 with an out-of-range sentinel value; 422 with an unknown field named `sentinelq7`; 400 malformed JSON containing `sentinelq7`; 403 with `source: "sentinel-src"`; 413; 415; 404 with query string `?q=sentinelq7` (no `?` in `req.path`); socket-level garbage containing `sentinelq7`; 500 (`ruleSet: []`); `/health` produces no request lines.
- [ ] **Step 2: Run** `node --test apps/api/src/logging.test.ts` → Expected: FAIL on `pid` and `hostname` for every case.
- [ ] **Step 3: Implement** `base: null` in the logger options of `buildApp`.
- [ ] **Step 4: Run** → PASS; then `npm test -w apps/api` → no existing test edited or broken.
- [ ] **Step 5: Commit** `feat(api): log only the approved field set`.

### Task 3: Real process, docs and status

**Files:**
- Test: `tests/logging.e2e.test.ts`
- Modify (after approval 1): `AGENTS.md` "Logging" line; `docs/adr/ADR-008-contrato-de-mensaje-v1.md` (section "Campos de log (F011)"); `docs/progress/PROGRESS.md`; `docs/progress/feature-list.json` (`status`/`notes`)

- [ ] **Step 1: Write the test** (same spawn pattern as `tests/post-messages.e2e.test.ts`, stdout piped): start `server.ts`, POST one valid sentinel message and one malformed body, stop the process with SIGTERM, then `auditLogLines(stdout, forbidden).problems` is `[]` and at least the listen line and one `message interpreted` line were seen.
- [ ] **Step 2: Run** `node --test tests/logging.e2e.test.ts` → PASS (Task 2 already removed `pid`/`hostname`); if the listen line carries other fields, adjust the allowed set only with a ruling.
- [ ] **Step 3: Docs.** AGENTS.md "Logging" lists exactly `ALLOWED_LOG_PATHS`; ADR-008 records the set, the sentinel method, and the still-open questions (log destination, retention, access, residency on Vercel; legal opinion on `message_id` and `case_id`).
- [ ] **Step 4:** `npm run verify` and `npm run scan:phi` → exit 0 and `hits 0`; run `/clinical-review`.
- [ ] **Step 5: Commit** `docs(agents): define the approved log fields`.

## Not in this plan

- Log destination, retention and access control (needs a deployment decision, F034/F027, and legal input).
- A persisted rejection counter (F055); the F047 certainty value; request-id propagation to a client.
