# F040 POST /v1/messages (happy path, no persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /v1/messages` validates a message, evaluates qSOFA on every `current` instance, classifies each one and answers synchronously with class, rules fired, trace and `rule_set_version`; nothing is persisted and the payload is never logged.

**Architecture:** A pure `interpretMessage` (apps/api) turns a validated `Message` into per-instance engine inputs, calls `evaluateRuleSet` then `classify`, and returns the response body. A thin route (`registerIngest`) does source allowlist, `validateMessage`, `interpretMessage`, and structured logging. `server.ts` loads `knowledge/rules` once at startup and fails closed. A strict JSON parser rejects what `JSON.parse` silently accepts (ADR-008 gates).

**Tech Stack:** TypeScript on Node (native type stripping), Fastify 5, `node:test`, `@decidere/schema`, `@decidere/engine`, `@decidere/rules`.

**Spec:** `docs/progress/feature-list.json` F040 (criteria + gates in `notes`), ADR-008 ("Condiciones para F040"), ADR-010 (class policy handoff), ADR-001/003/004. Slice order: `docs/superpowers/specs/2026-11-03-mvp-decomposition-design.md` (tracer bullet, item 13).

## Decisions that need the user's approval before Task 2 (contract changes)

1. **Response shape** (new data contract). `200`:
   `{ message_id, rule_set: { version, approval }, policy: { version, provisional: true }, historical_ignored: number, results: Result[] }` where `Result = { case_id, class, reason_code, highest_reachable_class, conflict, certainty: null, rules_fired: string[], trace: RuleResult[] }`, one per `current` instance, in input order. `class` uses the Spanish names `crítico | vigilancia | sin alerta | revisión clínica` (ADR-010 maps `critical|watch|no_alert|review`). `certainty` is `null` until F047 (the field exists so the contract does not change later). `case_id` is a fresh random UUID per result; `instance_id` is never echoed, logged or stored (ADR-008).
2. **New error code `forbidden` / 403 / "The source is not allowed."** for a `source` outside the allowlist (ADR-008 condition; the value is never repeated). 401 and 429 stay with F052/F057/F064.
3. **A message with zero `current` instances** (schema allows all-historical) returns `422 validation_failed` with `details: [{path:"/instances", code:"invalid_value"}]`, never `200` with empty results (coverage: no case is lost).
4. **Measurement choice (provisional, clinical question #4 of F038 still open):** when an instance has several measurements of one variable, the one with the largest `t_offset_min` (closest to now) is used; `null` or absent means missing → engine `unknown`. Recorded as provisional in ADR-008.
5. **Source allowlist** is a provisional env var `ALLOWED_SOURCES` (comma-separated, default `sim-1`); per-tenant allowlists arrive with F054.
6. **Dependencies:** `apps/api` gains workspace deps `@decidere/engine` and `@decidere/rules` (internal, no new external package). Confirm.

## Global Constraints

- Classes in the response: `crítico`, `vigilancia`, `sin alerta`, `revisión clínica`.
- ADR-001: no PII/PHI persisted; the raw payload lives only in memory during the request. Nothing in this feature writes storage.
- Logging (AGENTS.md): only `message_id` (after validation, never in an error branch), `case_id`, class, certainty, fired rule ids, and counts. Never the payload, `instance_id`, `source`, trace or clinical values.
- Errors keep the closed body `{"error":{"code","message","request_id","details"?}}`; messages are fixed strings; no echo of values or keys.
- The API does not hold state between requests except the rule set loaded at startup (immutable).
- Fail closed: startup aborts if rules fail to load or `loaded.severities.size !== loaded.meta.length` (otherwise every POST would be `internal_error`).
- Do not edit existing tests. If an existing test conflicts with a task, stop and report. Synthetic data only (reuse `packages/schema/src/fixtures.ts` shapes).
- Code and commits in English; docs in Spanish. Commits `feat(api): ...`, `docs(adr): ...`; branch `feat/f040-post-messages`, stacked on `feat/f039-class-policy`. No push without approval.

## Review Focus

1. Canary: an invalid body containing a canary string must not appear in any log line (V8 `SyntaxError` can quote a fragment) (Task 3).
2. `1e-400` / `2e1` and duplicate keys (`{"sbp":..,"sbp":..}`) are rejected as `invalid_json`, never read as apnea or as a silent last-wins (Task 3).
3. `text/plain` and non-UTF-8 charsets answer 415, not 422 (Task 3).
4. A message whose only current instance has all `null` values answers `revisión clínica`, not `sin alerta` (Task 1).
5. A response for a `crítico` must still be 200 with `class: "crítico"`; `PolicyError`/`RuleError` surface as `internal_error` 500 with no detail (Task 2).

---

### Task 1: `interpretMessage` (pure)

**Files:**
- Create: `apps/api/src/interpret.ts`
- Test: `apps/api/src/interpret.test.ts`
- Modify: `apps/api/package.json` (workspace deps, after approval 6)

**Interfaces:**
- Consumes: `Message`, `currentInstances` from `@decidere/schema`; `evaluateRuleSet`, `classify`, `ClassId`, `RuleResult` from `@decidere/engine`; `LoadedRuleSet` from `@decidere/rules`.
- Produces: `interpretMessage(message: Message, loaded: LoadedRuleSet, newCaseId?: () => string): Interpretation`, `type Interpretation` (the 200 body above), `CLASS_NAMES: Record<ClassId, string>`, `CANONICAL_VARIABLES: ReadonlySet<string>` (`resp_rate`, `sbp`, `gcs`; replaced by the F042 catalog).

- [ ] **Step 1: Write failing tests** in `interpret.test.ts`, loading the real `knowledge/rules` with `loadRuleSet(dir, {variables: CANONICAL_VARIABLES})`:
  - `qsofa 24/95/14 is crítico with sepsis.qsofa.v1 fired and trace entries for fr_alta, ta_baja, gcs_bajo`
  - `all normal (14 rr, 120 sbp, 15 gcs) is sin alerta`
  - `all-null values is revisión clínica with highest_reachable_class critical`
  - `latest measurement wins: rr 30 at -60 then rr 12 at 0 yields rr 12`
  - `three current instances give three results in order with distinct case_id`
  - `historical instances are not evaluated and are counted in historical_ignored`
  - `output never contains instance_id`: `JSON.stringify(result)` excludes the fixture `INSTANCE_ID`
  - `certainty is null and policy.provisional is true`
- [ ] **Step 2: Run** `node --test apps/api/src/interpret.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `interpretMessage`. Build a plain `Record<string, number>` per current instance (omit nulls), call `evaluateRuleSet(loaded.ruleSet, input)` then `classify(result, loaded.severities)`; `rules_fired` from `result.fired`; `trace` is `result.rules`. Pass only JSON-plain objects to the engine (F040 note: a throwing getter escapes `evaluateRuleSet`).
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(api): interpret messages with qSOFA and the class policy`.

### Task 2: Route, allowlist and `forbidden`

**Files:**
- Create: `apps/api/src/ingest.ts`
- Modify: `apps/api/src/app.ts` (new `BuildAppOptions`: `rules?: LoadedRuleSet`, `allowedSources?: ReadonlySet<string>`; registers the route only when `rules` is given), `apps/api/src/errors.ts` (`forbidden`)
- Test: `apps/api/src/ingest.test.ts`

**Interfaces:**
- Consumes: Task 1; `validateMessage`; `replyValidationFailed` (always `return` it from the async handler).
- Produces: `registerIngest(app: FastifyInstance, deps: { rules: LoadedRuleSet; allowedSources: ReadonlySet<string> }): void`; `ErrorCode` gains `"forbidden"` (403, fixed message above).

- [ ] **Step 1: Write failing tests** with `app.inject` and a capturing `logStream`:
  - `200 returns class crítico, rules_fired, trace and rule_set.version`
  - `N current instances are all processed`
  - `source outside allowlist is 403 forbidden and the source value is not in the body or logs`
  - `invalid message stays 422 validation_failed with details`
  - `zero current instances is 422 with path /instances`
  - `logs contain message_id, case_id and class, and contain neither source, instance_id nor any observed value`
  - `evaluation error (rules with a bad ruleSet) is 500 internal_error with a fixed body`
- [ ] **Step 2: Run** `node --test apps/api/src/ingest.test.ts` → FAIL.
- [ ] **Step 3: Implement** in order: allowlist check (before any log of the value) → `validateMessage` → zero-current check → `interpretMessage` → one `request.log.info` with counts and per-result `{case_id, class, certainty, rules_fired}` → `reply.code(200).send(body)`. `message_id` is logged only on this success branch. Add `forbidden` to `STATUS` and `MESSAGES`.
- [ ] **Step 4: Run** the new test and the existing `apps/api` suite (`npm test -w apps/api`) → PASS, no existing test edited.
- [ ] **Step 5: Commit** `feat(api): add POST /v1/messages with source allowlist`.

### Task 3: Strict body parsing (ADR-008 gates)

**Files:**
- Create: `apps/api/src/strict-json.ts`
- Modify: `apps/api/src/ingest.ts` (route-level `bodyLimit: 131072`, and the parser registration)
- Test: `apps/api/src/strict-json.test.ts`, `apps/api/src/ingest-body.test.ts`

**Interfaces:**
- Produces: `strictJsonParse(text: string): unknown` — throws an error with `code: "FST_ERR_CTP_INVALID_JSON_BODY"` (maps to `invalid_json` in `errors.ts`) on: any number token with an exponent, duplicate keys at any depth, `__proto__` keys. Accepts everything else `JSON.parse` accepts.

- [ ] **Step 1: Write failing tests:** unit (`rejects 2e1`, `rejects 1e-400`, `rejects 1E5`, `rejects duplicate key in nested object`, `accepts exponent-like text inside strings`, `accepts valid message`) and HTTP (`text/plain is 415`, `application/json; charset=latin1 is 415`, `invalid body with canary string leaves no canary in logs`, `body over 131072 bytes is 413`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `strictJsonParse` as a small string-aware scanner that runs before `JSON.parse` (exponent and duplicate-key checks need tokens; `JSON.parse` has already lost both). Wire it with the Fastify content-type parser API scoped to the ingest route's encapsulated plugin, remove the default `text/plain` parser there, and reject charsets other than utf-8. Verify the exact `addContentTypeParser` / `removeContentTypeParser` signatures against the installed Fastify version before coding (not verified here).
- [ ] **Step 4: Run** → PASS, plus `npm test -w apps/api` (existing `hardening.test.ts` must stay green; if it pins `text/plain` behavior, stop and report).
- [ ] **Step 5: Commit** `feat(api): reject ambiguous JSON bodies before parsing`.

### Task 4: Startup wiring and end-to-end test

**Files:**
- Modify: `apps/api/src/server.ts` (load rules from `knowledge/rules` relative to the repo, `ALLOWED_SOURCES`, fail-closed checks), `apps/api/src/config.ts` (`readAllowedSources(env): ReadonlySet<string>`, validates `^[a-z0-9-]{1,32}$` per entry)
- Test: `apps/api/src/config.test.ts` additions are new tests only; `tests/post-messages.e2e.test.ts`

**Interfaces:**
- Produces: `readAllowedSources(env: Record<string, string | undefined>): ReadonlySet<string>`.

- [ ] **Step 1: Write failing tests:** `readAllowedSources` (default `sim-1`, trims, rejects an invalid entry with a fixed message); e2e spawning `node apps/api/src/server.ts` on a free port (same pattern as `tests/init-sh.test.ts`), then `fetch` POST of a synthetic qSOFA message: `200` + `class: "crítico"` + `rule_set.version` starting `rs-`; an N=2 message; a second server start with a rules dir lacking `severity` exits non-zero.
- [ ] **Step 2: Run** `node --test tests/post-messages.e2e.test.ts` → FAIL.
- [ ] **Step 3: Implement** startup: `loadRuleSet(path, { variables: CANONICAL_VARIABLES })` before `listen`, `process.exit(1)` on `RuleLoadError` or `severities.size !== meta.length` (log only the error `name`/`code` via the existing `errInfo`). Rules directory path: relative to `import.meta.url` (Vercel packaging of `knowledge/rules` is unresolved, tracked in F034).
- [ ] **Step 4: Run** `npm run verify` and `npm run scan:phi` → exit 0 and `hits 0`.
- [ ] **Step 5: Commit** `feat(api): load rules at startup and serve POST /v1/messages`.

### Task 5: Docs, clinical review and feature status

**Files:**
- Modify: `docs/adr/ADR-008-contrato-de-mensaje-v1.md` (table: `forbidden` 403; response shape; `instance_id` not unique-checked, discarded; historical handling; measurement choice provisional; log retention/destination/access and retry semantics for the emitter; adults only), `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json` (`status`/`notes` only)

- [ ] **Step 1: Run** the `/clinical-review` skill (or `clinical-safety-compliance-reviewer`) on the branch diff; fix blocking findings.
- [ ] **Step 2: Update** the ADR and PROGRESS entry (what was done, evidence, open questions, handoffs to F041/F011/F047/F052).
- [ ] **Step 3: Set** F040 `passing` only if every criterion has evidence: curl returns class and trace (Task 4 e2e), N instances (Task 2), canary (Task 3), e2e (Task 4).
- [ ] **Step 4: Commit** `docs(adr): record the F040 response contract and gates`.

## Not in this plan

- API key and rate limiting (F052/F064), JWT (F057), persistence (F055), certainty value (F047), the invalid-message e2e matrix (F041), per-code rejection counters (F041/F011: the `apiError` log line exists, a counter does not).
- The F040 criterion "e2e against the API started with init.sh" is met by starting the same entrypoint (`node apps/api/src/server.ts`); `init.sh` itself only probes `/health` and requires `INGEST_API_KEY` for POSTs, which does not exist until F052. Do not add `seeds/smoke.json` before F052.
