# F043 Local-code mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A message may carry sender-local codes and units (schema 1.1); the API translates them to canonical variables, converts units, reports unmapped codes, rejects incompatible units, and stamps every interpretation with a `mapping_version`. F068 (rule-unit vs catalog UCUM) closes the plan.

**Architecture:** Mapping tables are versioned YAML in `knowledge/mappings/<source>.yaml` (one per allowlisted `source`; the source is the code namespace). They load at startup through the same hardened reader as rules (extracted, not copied), fail closed, and hash to `mapping_version`. A pure `mapMessage` in `apps/api` turns a 1.0 or 1.1 message into a canonical 1.0-shaped message plus per-instance `unmapped` codes; `interpretMessage` then runs unchanged. Schema 1.0 stays valid and passes through.

**Tech Stack:** TypeScript on Node, `node:test`, Ajv (schema), `yaml` (already a dependency of `packages/rules`). No new dependency.

**Spec:** `docs/progress/feature-list.json` F043 and F068; ADR-002 (note: `mapping_version`), ADR-007 (conversion and rounding belong to the mapper), ADR-008 (contract 1.0; "if `loinc` enters the message that is a pending decision that needs approval"); `docs/progress/PROGRESS.md` open point 7 (rounding).

## Decisions taken with the user (2026-11-05)

1. **Contract:** schema **1.1, additive**. 1.0 stays valid. Needs ADR-011 (Task 5). This is a data-contract change: user approval of the plan is the approval.
2. **Tables:** YAML under `knowledge/mappings/`, reviewed by PR. `mapping_version` is a content hash like `rule_set_version`. Editing UI (F017/F063) is out of scope.
3. **F068** is Task 6 of this plan.
4. **Rounding:** none. The mapper keeps the converted number; the engine compares decimals. Record as an open clinical question (13,3 kPa becomes about 99,76 mm[Hg] and fires qSOFA `sbp <= 100`).

## Global Constraints

- Contract 1.1 variable shape: `{code, value, unit, t_offset_min}` only. No free text: `code` matches `^[A-Za-z0-9._-]{1,32}$`, `unit` matches `^[A-Za-z0-9/%*\[\]{}._^-]{1,16}$`, `value` is `number | null` within ±1e6, `t_offset_min` as in 1.0 (integer, -10080..0). 1.1 keeps `message_id`, `source`, `instances` (1..20), `variables` (max 50) exactly as 1.0.
- A code the table does not know is never dropped: it is returned as `unmapped` and the message still classifies. Its value never reaches a log line (no new log field: `AGENTS.md` logging paragraph and `log-audit.ts` stay unchanged).
- Incompatible unit (unit not the canonical UCUM and not in the entry's conversions) is 422 `validation_failed` with `{path, code: "incompatible_unit"}`. Never reflect the received unit or code in an error.
- After conversion the canonical bounds of 1.0 apply (resp_rate 0..200, sbp 0..400, gcs 3..15); violation is `out_of_range`. Two measurements of one canonical variable at one offset in one instance is `duplicate_measurement`.
- Conversion is `canonical = value * factor + offset`. Every factor must be verified against UCUM (`mm[Hg]` = 133.3224 Pa) and cited in the table's `source` field; none is written from memory.
- Synthetic data only; no secrets; no new dependency. Code, commits and plan in English; ADR/PROGRESS in Spanish like the existing ones.
- Do not edit existing tests. Branch `feat/f043-local-code-mapper` from `main`; no push without approval. Run `npm run verify` and `npm run scan:phi` before marking `passing`.

## Review Focus

Inputs the spec implies but no acceptance criterion exercises, most likely first. Each has its test in the owning task.

1. Two local codes mapping to the same canonical variable at the same offset (`RR` and `RESP` both `resp_rate`, t=0): must be `duplicate_measurement`, never silent last-wins (Task 4).
2. Codes named like `Object.prototype` members (`constructor`, `__proto__`, `toString`): must come back `unmapped`, not crash or match (Task 4).
3. `source` allowlisted but without a mapping table, or a message where every variable is unmapped: 200 with all codes in `unmapped`, class from empty input; never 500 (Tasks 4, 5).
4. A huge value times a factor (`1e6 kPa`) overflowing the canonical bounds, and `null` values with a wrong unit: out_of_range and incompatible_unit respectively, never a non-finite number reaching the engine (Task 4).
5. A schema 1.0 message after this change: identical behaviour plus `mapping_version`; and the unmapped sentinel code absent from the log stream (Task 5).

## File Structure

- Modify `packages/schema/src/message.schema.ts`, `validate.ts`, `types.ts`, `index.ts`: 1.1 schema, version dispatch, `incompatible_unit` code, exported canonical bounds.
- Modify `packages/rules/src/load.ts`; create `packages/rules/src/files.ts` (shared hardened directory reader), `mappings.ts` (mapping loader), exports in `index.ts`.
- Create `knowledge/mappings/sim-1.yaml`.
- Create `apps/api/src/map.ts` (+ `map.test.ts`); modify `interpret.ts`, `ingest.ts`, `app.ts`, `server.ts`, `rules.ts`.
- Create `docs/adr/ADR-011-contrato-1-1-codigos-locales.md`; update ADR-002 note, `PROGRESS.md`, `feature-list.json`.

---

### Task 1: Schema 1.1 (local codes)

**Files:**
- Modify: `packages/schema/src/message.schema.ts`, `validate.ts`, `types.ts`, `index.ts`
- Test: `packages/schema/src/message11.test.ts` (new)

**Interfaces:**
- Produces: `SCHEMA_VERSION_11 = "1.1"`; `messageSchema11` (as in Global Constraints); `type MessageV11 = FromSchema<typeof messageSchema11>`; `validateMessage(input): { ok: true; value: Message | MessageV11 } | { ok: false; errors }` dispatching on `schema_version` ("1.0" and "1.1" each against its own compiled schema, anything else `unsupported_version`); `ValidationCode` gains `"incompatible_unit"`; `CANONICAL_BOUNDS: ReadonlyMap<string, { min: number; max: number }>` for `resp_rate`, `sbp`, `gcs`, built from the same constants `variableShape` receives (no second copy of 0/200, 0/400, 3/15).
- Consumes: existing `validateMessage`, `findDuplicate` (extend it to key on `code` for 1.1).

- [ ] **Step 1: Write failing tests in `message11.test.ts`** (fixtures from `fixtures.ts`, add a `validLocal()` there): valid 1.1 with decimals and `null` passes; `schema_version: "1.2"` is `unsupported_version`; a 1.1 variable with an extra `variable` key, a `code` of 33 chars, a `code` with a space, a `unit` with a space, `value` 1e7 and `t_offset_min: 1` each fail with `unknown_field`, `out_of_range`, `invalid_format`, `invalid_format`, `out_of_range`, `out_of_range`; duplicate `(code, t_offset_min)` is `duplicate_measurement` at `/instances/0/variables/1`; every existing 1.0 test still passes untouched; `CANONICAL_BOUNDS.get("gcs")` deep-equals `{ min: 3, max: 15 }`.
- [ ] **Step 2: Run** `npm test -w packages/schema` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the signatures above. Ajv options as the existing instance; `mapError` is shared (the `pattern` keyword already maps to `invalid_format`).
- [ ] **Step 4: Run** `npm test -w packages/schema && npm run typecheck` — Expected: PASS. If widening `validateMessage`'s return type breaks typecheck in `apps/api`, do not edit tests: make the minimal call-site change in `ingest.ts` (pass the union to `mapMessage` in Task 5's shape) in this same commit, or squash Tasks 1 and 5's type changes and say so in the commit message.
- [ ] **Step 5: Commit** `feat(schema): add contract 1.1 with sender-local codes`

### Task 2: Extract the hardened YAML directory reader

**Files:**
- Create: `packages/rules/src/files.ts`
- Modify: `packages/rules/src/load.ts`
- Test: existing `load.test.ts`, `load-errors.test.ts`, `parse*.test.ts` unchanged (they are the safety net)

**Interfaces:**
- Produces: `readYamlFiles(dir: string): { file: string; value: unknown }[]` — names sorted; applies today's checks in today's order (entry count, `.yaml` only, regular files, size before content, `O_NOFOLLOW|O_NONBLOCK` bounded read, strict UTF-8, `parseRuleYaml`), wrapping stage errors with the file name. Same `RuleLoadError` codes. `MAX_FILES`/`MAX_BYTES` move with it.
- Consumes: `parseRuleYaml`, `RuleLoadError`.

- [ ] **Step 1: Move** `inFile`, `io`, `readBounded` and the directory/size checks from `loadRuleSet` into `files.ts` as `readYamlFiles`; `loadRuleSet` calls it, then applies `checkRuleDoc`, id/file-name checks and the rest as before.
- [ ] **Step 2: Run** `npm test -w packages/rules && npm run typecheck` — Expected: all existing tests PASS with zero test edits. (Pure refactor: if any test needs editing, stop and report.)
- [ ] **Step 3: Commit** `refactor(rules): share the bounded YAML directory reader`

### Task 3: Mapping tables, loader and `mapping_version`

**Files:**
- Create: `packages/rules/src/mappings.ts`, `knowledge/mappings/sim-1.yaml`
- Modify: `packages/rules/src/index.ts`, `errors.ts` only if a new code is unavoidable (prefer existing `unknown_key`, `missing_key`, `invalid_type`, `invalid_value`, `file_id_mismatch`)
- Test: `packages/rules/src/mappings.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  type Conversion = { factor: number; offset: number };
  type MappingEntry = { variable: string; conversions: ReadonlyMap<string, Conversion> };
  type LoadedMappings = {
    version: string; // "map-" + first 16 hex of sha256(canonicalJson({v:1, tables}))
    tables: ReadonlyMap<string, ReadonlyMap<string, MappingEntry>>; // source -> local code -> entry
  };
  loadMappingSet(dir: string, options: { variables: ReadonlySet<string> }): LoadedMappings
  ```
- File format (closed keys, `format_version: 1`): `source`, `source_note` (citation of where factors were verified), `entries: [{ code, variable, units?: [{ unit, factor, offset }] }]`. File name must equal `<source>.yaml` (`file_id_mismatch`). An empty directory is valid (version of zero tables). `units` lists only non-canonical units; the canonical UCUM is always accepted and must not be listed.
- Load-time failures (all `RuleLoadError`): `variable` outside `options.variables`; duplicate `code` within a table; duplicate `unit` within an entry; non-finite or zero `factor`; `code`/`unit`/`source` failing the same patterns as the schema. Use `Map` (never plain-object lookup).
- `sim-1.yaml` content: `RR`→`resp_rate`, `SBP`→`sbp` with one conversion `kPa` (factor from UCUM, see below), `GCS`→`gcs`.

- [ ] **Step 1: Verify the kPa→mm[Hg] factor** against the UCUM definition (`mm[Hg]` = 133.3224 Pa on tx.fhir.org or the UCUM spec); compute `1000 / 133.3224`; record the source and date in `source_note`. If it cannot be verified, ship `sim-1.yaml` without the `kPa` conversion and say so in PROGRESS.
- [ ] **Step 2: Write failing tests**: loads `sim-1.yaml` from the repo and its `SBP` entry converts `kPa` with the verified factor (assert within 1e-4); same directory content gives the same `version`, changing one factor changes it, file order does not; each load-time failure above throws `RuleLoadError` with the expected code and path (temp directories); `file_id_mismatch`; unknown key at every level; a symlinked table is rejected (reuses reader behaviour: one test is enough).
- [ ] **Step 3: Run** `npm test -w packages/rules` — Expected: FAIL.
- [ ] **Step 4: Implement** `loadMappingSet` using `readYamlFiles` and a hand-written closed check in the style of `checkRuleDoc` (own-keys only, fresh plain objects); export `loadMappingSet`, `LoadedMappings`, `MappingEntry`, `Conversion` from `index.ts`.
- [ ] **Step 5: Run** `npm test -w packages/rules && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(rules): load versioned local-code mapping tables`

### Task 4: `mapMessage` (pure)

**Files:**
- Create: `apps/api/src/map.ts`
- Test: `apps/api/src/map.test.ts` (new)

**Interfaces:**
- Consumes: `LoadedMappings` (Task 3), `Message | MessageV11`, `ValidationError`, `VARIABLE_CATALOG`, `CANONICAL_BOUNDS` (Task 1).
- Produces:
  ```ts
  type Mapped = { message: Message; mapping_version: string; unmapped: string[][] };
  mapMessage(input: Message | MessageV11, mappings: LoadedMappings):
    { ok: true; value: Mapped } | { ok: false; errors: ValidationError[] }
  ```
  `message` is 1.0-shaped (one cast inside `map.ts`, marked `// ponytail:` — canonical values may be decimals, which the 1.0 type already allows as `number`). `unmapped[i]` aligns with `message.instances[i]`: distinct codes, in first-seen order. A 1.0 input passes through untouched with `unmapped` all `[]`. `mapping_version` is `mappings.version` in both cases. Errors: first error only, `{path: "/instances/i/variables/j", code}` — `incompatible_unit` (unit neither canonical UCUM from the catalog nor in `conversions`; checked also when `value` is `null`), `out_of_range` (converted value outside `CANONICAL_BOUNDS` or non-finite), `duplicate_measurement` (same canonical variable and offset after mapping). A `null` value maps to `null`. Mapping runs over historical instances too (same validation), a historical one only contributes errors.

- [ ] **Step 1: Write failing tests** with a hand-built `LoadedMappings`: known code with canonical unit maps unchanged; `13.3 kPa` SBP → `99.7…` (assert within 0.05); unknown code → `unmapped` and absent from `variables`; `constructor`, `__proto__`, `toString` codes → unmapped; unit `mg/dL` on `RR` → `incompatible_unit` at the right path; `null` with unit `mg/dL` → `incompatible_unit`; `1e6 kPa` → `out_of_range`; `RR` and `RESP` both → `resp_rate` at t=0 → `duplicate_measurement` at the second path; source without a table → everything unmapped; 1.0 input returns the same object contents and `mapping_version`; the function does not mutate its input (deep-freeze the input).
- [ ] **Step 2: Run** `npm test -w apps/api -- --test-name-pattern=map` (or `node --test apps/api/src/map.test.ts`) — Expected: FAIL.
- [ ] **Step 3: Implement** `mapMessage`; table lookup by `input.source` then `code`; conversion `value * factor + offset`; canonical unit from `VARIABLE_CATALOG`.
- [ ] **Step 4: Run** the same command plus `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): map local codes and units to canonical variables`

### Task 5: Wire the mapper into the POST, startup and docs

**Files:**
- Modify: `apps/api/src/interpret.ts`, `ingest.ts`, `app.ts`, `server.ts`, `rules.ts`
- Create: `docs/adr/ADR-011-contrato-1-1-codigos-locales.md`
- Modify: `docs/adr/ADR-002-reglas-como-datos-versionados.md` (note), `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json` (F043 `passing` only after verify)
- Test: `apps/api/src/ingest-local.test.ts` (new); extend `tests/post-messages.e2e.test.ts` with new tests only

**Interfaces:**
- Consumes: `loadMappingSet`, `LoadedMappings`, `mapMessage`, `Mapped`.
- Produces: `loadActiveMappings(dir: string): LoadedMappings` in `rules.ts` (passes `MESSAGE_VARIABLES`) and `DEFAULT_MAPPINGS_DIR` (`knowledge/mappings/`, env `MAPPINGS_DIR` like `RULES_DIR`); `IngestDeps.mappings: LoadedMappings`; `BuildAppOptions.mappings?` (the route registers when `rules` is given; default to an empty table set of version computed by `loadMappingSet` on an empty directory is NOT allowed — build an explicit `EMPTY_MAPPINGS` constant with `version: "map-empty"`); `interpretMessage(message: Message, loaded, newCaseId?, mapping?: { version: string; unmapped: string[][] })` — when `mapping` is absent output uses `version: "identity"` and `[]` so existing tests stay green; `Interpretation` gains `mapping_version: string`; `CaseResult` gains `unmapped: string[]`.
- Behaviour: `ingest.ts` runs `validateMessage` → `mapMessage` (errors go through `replyValidationFailed`) → `interpretMessage`. The "message interpreted" log payload does not change. `server.ts` loads mappings before listening; failure logs the existing fixed message `rules failed to load` with `errInfo(err)` (the log-message list is closed; do not add one) and exits 1.

- [ ] **Step 1: Write failing tests** (`ingest-local.test.ts`, Fastify `inject`, rules from `knowledge/rules`, mappings from `knowledge/mappings`): a 1.1 qSOFA message with local codes `RR=24`, `SBP=13.3 kPa`, `GCS=15` → 200, class `crítico`, `mapping_version` matches `^map-[0-9a-f]{16}$`, `unmapped` `[]`; same with an extra code `XYZ` → 200 and `results[0].unmapped` equals `["XYZ"]`; unit `mg/dL` on `RR` → 422 `validation_failed` with details `[{path, code:"incompatible_unit"}]` and the body does not contain `mg/dL` or `RR`; a 1.1 message from a source with no table (allowlisted via `allowedSources`) → 200, all codes unmapped, no 500; a 1.0 qSOFA message → 200 with the same class as before and `mapping_version` present; the log stream (`logStream`) of the 1.1 request with an unmapped sentinel code (`ZZ-SENTINEL-1`) does not contain the sentinel. In the e2e file: a spawned server with the default `knowledge/mappings` answers a 1.1 message and a broken `MAPPINGS_DIR` makes the process exit non-zero with only the fixed log line.
- [ ] **Step 2: Run** `node --test apps/api/src/ingest-local.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Write ADR-011** (template `ADR-000-template.md`, Spanish): contract 1.1, source as code namespace, unmapped visible and never logged, no rounding with the open clinical question (qSOFA `sbp <= 100` on a converted 99,76), `mapping_version` now stamped (ADR-002), residual risk that `code` (32 chars) could carry text like `source` does, 1.0 deprecation not decided. Add the ADR-002 pointer, a PROGRESS session entry and `feature-list.json` status (F043 `passing`, `notes` updated) only after Step 5.
- [ ] **Step 5: Run** `npm run verify && npm run scan:phi` — Expected: exit 0 both; report the exact counts per package.
- [ ] **Step 6: Commit** `feat(api): interpret contract 1.1 messages through the mapper` (docs in a second commit: `docs(progress): mark F043 passing`).

### Task 6: F068 — rule-condition units against the catalog

**Files:**
- Modify: `apps/api/src/rules.ts` (`loadActiveRules`), or `packages/rules/src/load.ts` if the loader already receives what it needs
- Test: `apps/api/src/rules-units.test.ts` (new)

**Interfaces:**
- Consumes: `VARIABLE_CATALOG` (`variable`, `ucum`), the loaded rule set's conditions (read how `LoadedRuleSet.ruleSet` exposes `variable` and `unit`; do not add fields to the engine).
- Produces: `loadActiveRules` throws `Error` with `code: "unit_mismatch"` when a condition's `unit` differs from the catalog `ucum` of its variable. Fail closed at startup, fixed message, no value in it.

- [ ] **Step 1: Write failing tests**: the real `knowledge/rules` still loads; a temp copy of `sepsis.qsofa.v1.yaml` with `resp_rate` unit changed to `/h` throws with code `unit_mismatch`; the error message contains neither `/h` nor `resp_rate`.
- [ ] **Step 2: Run** `node --test apps/api/src/rules-units.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the check in `loadActiveRules` after `loadRuleSet`.
- [ ] **Step 4: Run** `npm run verify && npm run scan:phi` — Expected: exit 0.
- [ ] **Step 5: Commit** `fix(api): reject rule conditions whose unit differs from the catalog` and `docs(progress): mark F068 passing`.

---

## Self-review notes

- Spec coverage: F043 criteria 1-4 are Tasks 4/5 (translate+convert, unmapped visible, incompatible unit error, `mapping_version`); F068 criteria are Task 6; PROGRESS point 7 is decision 4.
- Open items to flag at execution, not decide here: the kPa factor verification (Task 3 step 1); whether widening `validateMessage`'s return type breaks typecheck between Tasks 1 and 5 (commit them together if so); `RuleLoadError` is reused for mapping files (name is rules-centric).
