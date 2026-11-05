# F044 Contract 1.1 for SIRS and the infection proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contract 1.1 can carry the five SIRS variables (`heart_rate`, `temperature`, `wbc`, `paco2`, `bands_pct`) through the existing mapper, plus per-instance culture/antibiotic orders and ICD-10 diagnoses; rules can reference the new variables; the PaCO2/bands decision and its effect on completeness are documented.

**Architecture:** The new variables reach the engine only through 1.1 (code + mapping table), never through 1.0, which stays frozen at qSOFA (1.0 values are integers; temperature needs decimals). One bounds map (`CANONICAL_BOUNDS`) is the single source for structural limits; a new `DELIVERABLE_VARIABLES` set (its keys) says which variables rules and mapping tables may reference. Orders and ICD-10 are validated, never echoed, logged or classified: they have no consumer until F046.

**Tech Stack:** TypeScript on Node, `node:test`, Ajv. No new dependency.

**Spec:** `docs/progress/feature-list.json` F044 (criteria: valid/invalid tests for the new variables; documented decision on PaCO2 and bands and their effect on completeness; `requires_compliance_review: true`, `requires_clinical_data_contract: true`), ADR-008, ADR-011, AGENTS.md ("Reglas no negociables de dominio": no PII/PHI, relative offsets only, no free text), `docs/progress/PROGRESS.md` session 14 handoff to F044.

## Decisions taken with the user (2026-11-05)

1. **Version:** new variables enter **1.1 only**; 1.0 is untouched.
2. **PaCO2 and bands:** included, **optional**. SIRS needs two of four criteria; its RR criterion is met by `resp_rate` or `paco2`, its WBC criterion by `wbc` or `bands_pct`. Decision recorded for F047: completeness counts **criteria**, not variables, so a missing `paco2` or `bands_pct` does not lower completeness while `resp_rate`/`wbc` are present. Needs clinical confirmation (F045/F047).
3. **Orders and ICD-10:** included now (per-instance, 1.1 only), as a deliberate choice over deferring to F046.
4. **Existing test edit approved:** `apps/api/src/rules-variables.test.ts` is re-targeted (Task 3) because its premise (`heart_rate` is not deliverable) ends with this feature. Declare it in the PR body. No other existing test may change.

## Global Constraints

- Structural bounds (provisional, not clinical; clinician must confirm): `heart_rate` 0..350 `/min`, `temperature` 25..45 `Cel`, `wbc` 0..1000 `10*3/uL`, `paco2` 0..300 `mm[Hg]`, `bands_pct` 0..100 `%`. Units are the catalog's `ucum` (F042).
- 1.1 additions are per instance and optional: `orders` (max 20; items `{type: "blood_culture" | "antibiotic", t_offset_min}`, `t_offset_min` integer -10080..0, no other keys) and `diagnoses_icd10` (max 20, unique strings matching the ICD-10 code pattern in Task 2). No free text, no dates, no results.
- 1.0 rejects every new field and variable (`orders`, `diagnoses_icd10`, `heart_rate`, ...) with the existing codes.
- `orders` and `diagnoses_icd10` never appear in responses or logs; the closed log-message/field list and `log-audit.ts` do not change.
- `rule_set_version` of the real `knowledge/rules` must be byte-identical before and after this feature (record it in Task 1, assert it in Task 4).
- Existing tests unedited except the one approved in Decision 4. Synthetic data only. No new dependency. Branch `feat/f044-sirs-contract` from `main`; no push without approval. `npm run verify` and `npm run scan:phi` exit 0 before marking `passing`. Code/commits/plan in English; ADR/PROGRESS in Spanish.

## Review Focus

1. Free text smuggled through the new strings: an ICD-10 entry like `A41.9 patient`, lowercase `a41.9`, 21 entries, duplicates, an `orders` item with an extra key, a future offset (`1`) or an unknown `type` (Task 2).
2. New variables out of structural bounds after unit conversion (`temperature` 100 Cel, `bands_pct` 101, `wbc` with a converted unit) and a `null` value with a wrong unit (Task 3).
3. A catalog variable without bounds, or bounds for a non-catalog variable: the invariant `MESSAGE_VARIABLES ⊆ DELIVERABLE_VARIABLES = keys(CANONICAL_BOUNDS) = catalog variables` must be tested so F045 cannot add a variable half-wired (Task 1).
4. Contract separation: 1.0 with `orders`, with `diagnoses_icd10`, or with `heart_rate` must still be rejected; 1.1 with only unmapped new codes still returns 200 `revisión clínica`, never `sin alerta` (Tasks 2, 4).
5. The rules path: qSOFA must load with an unchanged `rule_set_version`, a rule on `heart_rate` must now load, a rule on a non-catalog variable must still fail (Tasks 3, 4).

## File Structure

- Modify `packages/schema/src/message.schema.ts`, `validate.ts`, `index.ts`: bounds, `DELIVERABLE_VARIABLES`, 1.1 instance fields, `uniqueItems` error mapping.
- Modify `apps/api/src/rules.ts` (variable sets), `knowledge/mappings/sim-1.yaml` (5 codes), `apps/api/src/rules-variables.test.ts` (approved re-target).
- Create tests: `packages/schema/src/bounds.test.ts`, `packages/schema/src/context11.test.ts`, `apps/api/src/ingest-sirs.test.ts`.
- Create `docs/adr/ADR-012-variables-sirs-y-contexto-clinico.md`; update `PROGRESS.md`, `feature-list.json`.

---

### Task 1: Bounds for the five variables and `DELIVERABLE_VARIABLES`

**Files:**
- Modify: `packages/schema/src/message.schema.ts`, `packages/schema/src/index.ts`
- Test: `packages/schema/src/bounds.test.ts` (new)

**Interfaces:**
- Produces: `CANONICAL_BOUNDS` gains the five entries above (same `{min, max}` constants pattern as the existing three; no second copy); `DELIVERABLE_VARIABLES: ReadonlySet<string>` = keys of `CANONICAL_BOUNDS`, exported from `index.ts`. `MESSAGE_VARIABLES` is unchanged (still the three 1.0 variables; `catalog-schema.test.ts` depends on that).
- Consumes: `VARIABLE_CATALOG`.

- [ ] **Step 1: Record the baseline.** Run `loadActiveRules(DEFAULT_RULES_DIR).rule_set_version` and write the value into the PR notes/Task 4's test constant `QSOFA_RULE_SET_VERSION` (do not change any rule).
- [ ] **Step 2: Write failing tests in `bounds.test.ts`:** `CANONICAL_BOUNDS.get(v)` deep-equals the table above for the five new variables and the old three are unchanged; `[...DELIVERABLE_VARIABLES].sort()` equals the eight catalog variables sorted; every `MESSAGE_VARIABLES` member is in `DELIVERABLE_VARIABLES`; every `VARIABLE_CATALOG` variable has bounds.
- [ ] **Step 3: Run** `npm test -w packages/schema` — Expected: new tests FAIL.
- [ ] **Step 4: Implement** the five constants next to `RESP_RATE`/`SBP`/`GCS`, add them to the `CANONICAL_BOUNDS` map, and export `DELIVERABLE_VARIABLES`. Do not touch the 1.0 `oneOf`.
- [ ] **Step 5: Run** `npm test -w packages/schema && npm run typecheck` — Expected: PASS (existing 1.0/1.1 tests untouched).
- [ ] **Step 6: Commit** `feat(schema): add structural bounds for the SIRS variables`

### Task 2: Per-instance `orders` and `diagnoses_icd10` in 1.1

**Files:**
- Modify: `packages/schema/src/message.schema.ts`, `validate.ts` (`mapError`), `fixtures.ts` (append a `validLocalWithContext()`)
- Test: `packages/schema/src/context11.test.ts` (new)

**Interfaces:**
- Produces: `messageSchema11` instance properties `orders` and `diagnoses_icd10` (optional, per Global Constraints); `MessageV11` types follow automatically. `mapError` maps Ajv `uniqueItems` to `{path, code: "invalid_value"}`. `diagnoses_icd10` items use `^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$`, `maxLength` 8 — **proposed**: Step 1 verifies the ICD-10 code format against WHO ICD-10 or CMS ICD-10-CM documentation (WebFetch) and records the source and date in ADR-012; if the verified format differs, use the verified one and say so.

- [ ] **Step 1: Verify the ICD-10 code format** from a primary source and note the URL/date (never from memory).
- [ ] **Step 2: Write failing tests in `context11.test.ts`** (fixtures with synthetic codes, e.g. `A41.9`, `J18.9`): a 1.1 instance with `orders: [{type:"blood_culture", t_offset_min:-30}, {type:"antibiotic", t_offset_min:0}]` and `diagnoses_icd10: ["A41.9","J18.9"]` is valid; empty arrays are valid; each of these fails with the code shown: `A41.9 patient` `invalid_format`; `a41.9` `invalid_format`; 21 entries `out_of_range`; duplicate `["A41.9","A41.9"]` `invalid_value`; order with `type:"x"` `invalid_value`; order with an extra key `unknown_field`; order `t_offset_min: 1` `out_of_range`; order missing `type` `required`; paths carry indices only and never the received string; the same fields in a 1.0 message are `unknown_field`.
- [ ] **Step 3: Run** `npm test -w packages/schema` — Expected: FAIL.
- [ ] **Step 4: Implement** the two properties in `messageSchema11` (reuse the existing `offset` constant) and the `uniqueItems` case in `mapError`.
- [ ] **Step 5: Run** `npm test -w packages/schema && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(schema): accept culture/antibiotic orders and ICD-10 codes in 1.1`

### Task 3: Mapping entries, rule/mapping variable sets, approved test re-target

**Files:**
- Modify: `apps/api/src/rules.ts`, `knowledge/mappings/sim-1.yaml`, `apps/api/src/rules-variables.test.ts` (approved edit)
- Test: `apps/api/src/sirs-mapping.test.ts` (new)

**Interfaces:**
- Consumes: `DELIVERABLE_VARIABLES` (Task 1), `mapMessage`, `loadMappingSet`, `loadActiveRules`.
- Produces: `loadActiveRules` and `loadActiveMappings` take `DELIVERABLE_VARIABLES` instead of `MESSAGE_VARIABLES` (the F068 unit check keeps comparing against the catalog). `sim-1.yaml` gains `HR`→`heart_rate`, `TEMP`→`temperature`, `WBC`→`wbc`, `PACO2`→`paco2`, `BANDS`→`bands_pct` with canonical units only; a non-canonical conversion (e.g. `10*9/L`→`10*3/uL`, factor 1) is added **only if verified against UCUM** in the same way as the kPa factor, with the source in `source_note`; otherwise omit it and say so.

- [ ] **Step 1: Write failing tests in `sirs-mapping.test.ts`:** `mapMessage` over a 1.1 message with `HR=95 /min`, `TEMP=38.4 Cel`, `WBC=13.2 10*3/uL`, `PACO2=30 mm[Hg]`, `BANDS=12 %` maps all five to canonical variables with unchanged values and `unmapped` `[]`; `TEMP=100 Cel` is `out_of_range`; `BANDS=101 %` is `out_of_range`; `HR` with unit `/h` is `incompatible_unit`; `TEMP=null` with unit `mg/dL` is `incompatible_unit`; unmapped new codes (`XHR`) land in `unmapped`. Rule loading: a temp copy of qSOFA with `variable: resp_rate` replaced by `heart_rate` now loads (`loadActiveRules` does not throw), and one replaced by `not_a_variable` throws.
- [ ] **Step 2: Run** `node --test apps/api/src/sirs-mapping.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the variable-set swap and the `sim-1.yaml` entries. Re-target `rules-variables.test.ts` (approved): same structure and intent (fail closed on a variable the contract cannot deliver), replacement variable `not_a_variable`, test name updated accordingly. Edit nothing else in that file.
- [ ] **Step 4: Run** `npm test -w apps/api && npm test -w packages/rules && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): let rules and mappings use the SIRS variables`

### Task 4: POST integration, ADR-012, progress

**Files:**
- Test: `apps/api/src/ingest-sirs.test.ts` (new)
- Create: `docs/adr/ADR-012-variables-sirs-y-contexto-clinico.md`
- Modify: `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json` (F044 `status`/`notes` only; add to F046 `notes` that its data shape is already in the contract)

**Interfaces:**
- Consumes: everything above; `buildApp` with `rules`, `mappings`, `allowedSources`, `logStream`.
- Produces: no new code interface.

- [ ] **Step 1: Write failing tests in `ingest-sirs.test.ts`** (Fastify `inject`, real `knowledge/rules` and `knowledge/mappings`): a 1.1 qSOFA-positive message that also carries `HR`, `TEMP`, `WBC`, `PACO2`, `BANDS`, `orders` and `diagnoses_icd10` → 200, same class and `rules_fired` as the same message without the extras, `mapping_version` present; the response body contains neither `A41.9` (use a unique sentinel code like `Z99.9` in the message) nor `blood_culture`; the captured log stream contains neither the ICD sentinel nor any order type; the same message as 1.0 with `orders` → 422 `unknown_field`, with `heart_rate` as a 1.0 variable → 422 `invalid_value`; a 1.1 message whose only variables are the five new codes unmapped (source without a table) → 200 `revisión clínica`, `highest_reachable_class: "critical"`; `loadActiveRules(DEFAULT_RULES_DIR).rule_set_version` equals the constant recorded in Task 1.
- [ ] **Step 2: Run** `node --test apps/api/src/ingest-sirs.test.ts` — Expected: FAIL only where behaviour is missing (most pass once Tasks 1-3 exist; record which failed and why).
- [ ] **Step 3: Write ADR-012** (template `ADR-000-template.md`, Spanish, status `propuesto`): the five variables 1.1-only and why (1.0 integers vs temperature), bounds provisional table, PaCO2/bands optional and the completeness-by-criteria decision with the F047 handoff, orders/ICD-10 shape, the verified ICD-10 format with source and date, no-consumer/never-echoed/never-logged, ICD-10 as health data (ADR-001: persisted without identifiers only in F012, F055), open clinical questions (bounds, bands manual vs automated count, whether orders need results), `10*9/L` handling as decided in Task 3.
- [ ] **Step 4: Run** `npm run verify && npm run scan:phi` — Expected: exit 0 both; report exact counts.
- [ ] **Step 5: Update** PROGRESS (Spanish), F044 `passing` only after Step 4 and Task 5 below; ADR-008 note pointing to ADR-012.
- [ ] **Step 6: Commit** `feat(api): carry SIRS variables and clinical context through the POST` and `docs(progress): mark F044 passing`.

### Task 5: Compliance review (`requires_compliance_review: true`)

**Files:** none planned; findings fixes go in the files they name.

**Interfaces:**
- Consumes: the branch diff against `main`.
- Produces: a findings list recorded in PROGRESS and in the PR body.

- [ ] **Step 1: Run the `clinical-safety-compliance-reviewer` agent** (or `/clinical-review`) on the branch diff with this focus: ICD-10 and order data as health data under ADR-001; free-text surface of the new strings; no echo/log; jurisdiction questions stay open (do not assume a framework).
- [ ] **Step 2: Fix every Critical/Important finding** in the owning task's files with a test; record Minor ones in PROGRESS.
- [ ] **Step 3: Re-run** `npm run verify && npm run scan:phi` — Expected: exit 0.
- [ ] **Step 4: Commit** `docs(progress): record F044 compliance review` (plus fix commits as needed). Set F044 `passing` only now.

---

## Self-review notes

- Spec coverage: criterion 1 (valid/invalid tests for new variables) is Tasks 1-3 (+ orders/ICD in 2); criterion 2 (PaCO2/bands decision and completeness effect) is Decision 2 and Task 4's ADR-012; compliance flag is Task 5.
- Type consistency: `DELIVERABLE_VARIABLES` is defined in Task 1 and consumed in Task 3; `MESSAGE_VARIABLES` is deliberately untouched so `catalog-schema.test.ts` stays valid.
- Open at execution: the ICD-10 pattern (verified in Task 2 Step 1), whether `10*9/L` is verified (Task 3), and the F047 completeness handoff needs clinical confirmation.
