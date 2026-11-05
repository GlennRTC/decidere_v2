# F042 Canonical variable catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versioned catalog of the canonical variables needed by qSOFA and SIRS, each with a verified LOINC code, UCUM unit and cited source, replacing the provisional `CANONICAL_VARIABLES` set in `apps/api`.

**Architecture:** The catalog is plain typed data in `packages/schema` (which already owns variable names and units), exported with a version string. `CANONICAL_VARIABLES` becomes derived from it, so the rule loader and the API read one source. No change to the message contract (schema stays 1.0); the mapper that consumes the catalog is F043.

**Tech Stack:** TypeScript on Node, `node:test`. No new dependency.

**Spec:** `docs/progress/feature-list.json` F042 (criteria: "Cada variable con LOINC y UCUM y fuente citada"; "Ningún código escrito de memoria sin verificar"), F004 note, AGENTS.md "Reglas clínicas", ADR-008 (LOINC excluded from 1.0).

## Verification already done (2026-11-05, must be recorded in the catalog as `verified_on`)

LOINC display names confirmed through the NLM Clinical Tables LOINC API (`https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search?terms=<code>`); `loinc.org` itself returns 403 to automated fetch. 8480-6 also confirmed on the HL7 terminology server (`tx.fhir.org`, LOINC 2.83, ACTIVE, example unit `mm[Hg]`). UCUM codes `/min`, `10*3/uL`, `Cel` confirmed valid on `tx.fhir.org` (UCUM 2.2). `mm[Hg]` confirmed via the 8480-6 example unit. `{score}` is a UCUM annotation (curly-brace, unitless "1"), not a unit symbol; checked in Task 1.

| variable | LOINC | LOINC long common name | UCUM |
|---|---|---|---|
| `resp_rate` | 9279-1 | Respiratory rate | `/min` |
| `sbp` | 8480-6 | Systolic blood pressure | `mm[Hg]` |
| `gcs` | 9269-2 | Glasgow coma score total | `{score}` |
| `heart_rate` | 8867-4 | Heart rate | `/min` |
| `temperature` | 8310-5 | Body temperature | `Cel` |
| `wbc` | 6690-2 | Leukocytes [#/volume] in Blood by Automated count | `10*3/uL` |
| `paco2` | 2019-8 | Carbon dioxide [Partial pressure] in Arterial blood | `mm[Hg]` |
| `bands_pct` | 764-1 | Band form neutrophils/Leukocytes in Blood by Manual count | `%` |

## Decisions that need the user's approval

1. **Scope of SIRS variables (decided by the user 2026-11-05).** PaCO2 (`paco2`) and immature bands (`bands_pct`) are included in F042, not a separate feature. `%` and `{score}` validated on tx.fhir.org.
2. **Location.** `packages/schema/src/catalog.ts` (recommended: no new package, schema already owns names/units) vs a YAML under `knowledge/` for clinician review by PR.
3. **Clinical contract flag.** F042 is `requires_clinical_data_contract: true`. The catalog adds names and units but does not change the message contract; the schema keeps accepting only `resp_rate`, `sbp`, `gcs` until F044. Confirm this reading.

## Global Constraints

- No LOINC or UCUM code enters the catalog without an entry in its `source` field naming where it was checked (Spec: "Ningún código escrito de memoria sin verificar").
- Synthetic data only; no secrets; no new dependency. Code and commits in English; docs in Spanish.
- Do not edit existing tests. Branch `feat/f042-variable-catalog`, from `main`; no push without approval.
- Run `npm run verify` and `npm run scan:phi` before marking `passing`.

## Review Focus

1. A catalog entry whose `unit` differs from the unit the schema accepts for the same variable (`resp_rate`, `sbp`, `gcs`) must fail a test (Task 2).
2. A duplicated variable name or duplicated LOINC code in the catalog must fail a test (Task 1).
3. A variable the qSOFA rule uses that is missing from the catalog must make rule loading fail, not pass silently (Task 3).
4. A LOINC code in the wrong format (for example `92791`) must be rejected by a catalog test (Task 1).
5. Catalog entries without `source` or `verified_on` must fail a test (Task 1).

---

### Task 1: Catalog data and shape tests

**Files:**
- Create: `packages/schema/src/catalog.ts`
- Test: `packages/schema/src/catalog.test.ts`
- Modify: `packages/schema/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `CATALOG_VERSION: "catalog-1"`
  - `type CatalogEntry = { variable: string; loinc: string; loinc_name: string; ucum: string; source: string; verified_on: string }`
  - `VARIABLE_CATALOG: readonly CatalogEntry[]` (the eight rows above; `source` names the NLM Clinical Tables API and `tx.fhir.org`; `verified_on: "2026-11-05"`)
  - `CANONICAL_VARIABLES: ReadonlySet<string>` (derived from `VARIABLE_CATALOG`)

- [ ] **Step 1: Write failing tests** in `catalog.test.ts`: `catalog has the eight variables`; `every loinc matches ^\d{1,7}-\d$`; `variable names and loinc codes are unique`; `every entry has non-empty source and a YYYY-MM-DD verified_on`; `CANONICAL_VARIABLES equals the catalog variable names`; `gcs unit is the UCUM annotation {score}` (assert `ucum === "{score}"`).
- [ ] **Step 2: Run** `node --test packages/schema/src/catalog.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `catalog.ts` with the table above; export from `index.ts`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(schema): add the canonical variable catalog`.

### Task 2: Catalog agrees with the message schema

**Files:**
- Test: `packages/schema/src/catalog-schema.test.ts`

**Interfaces:**
- Consumes: `VARIABLE_CATALOG`, `validateMessage` and the fixtures in `packages/schema/src/fixtures.ts`.

- [ ] **Step 1: Write the test** `schema units match the catalog`: for `resp_rate`, `sbp`, `gcs`, build a valid message using the catalog `ucum` as `unit` and assert `validateMessage` accepts it; with any other unit assert it is rejected. Also `schema variables are a subset of the catalog`.
- [ ] **Step 2: Run** `node --test packages/schema/src/catalog-schema.test.ts` → PASS (it pins existing behaviour; if it fails, the catalog or the schema is wrong: report it, do not edit the schema silently).
- [ ] **Step 3: Commit** `test(schema): pin catalog units to the message schema`.

### Task 3: Replace the provisional set in the API

**Files:**
- Modify: `apps/api/src/interpret.ts:12-17` (remove the local `CANONICAL_VARIABLES`, re-export the one from `@decidere/schema` so the existing test imports keep working)
- Test: `packages/rules/src/catalog-rules.test.ts`

**Interfaces:**
- Consumes: `CANONICAL_VARIABLES` from `@decidere/schema`; `loadRuleSet(dir, { variables })`.

- [ ] **Step 1: Write failing test** `qsofa loads against the catalog` (loads the real `knowledge/rules` with the catalog set and expects success) and `a rule using a variable absent from the catalog fails to load` (use a temp copy of the qSOFA YAML with `variable: lactate` and expect `RuleLoadError`).
- [ ] **Step 2: Run** `node --test packages/rules/src/catalog-rules.test.ts` → first test FAILS until the export exists, second must already PASS.
- [ ] **Step 3: Implement** the re-export in `interpret.ts`.
- [ ] **Step 4: Run** `npm run verify` → exit 0 (existing counts: api 142, rules 94, schema 34, engine 144 plus the new tests).
- [ ] **Step 5: Commit** `refactor(api): use the schema catalog as canonical variables`.

### Task 4: Documentation and feature status

**Files:**
- Modify: `docs/adr/ADR-008-contrato-de-mensaje-v1.md` (one line: "Catálogo `catalog-1` en `packages/schema`; el contrato 1.0 no cambia; `loinc` entra al mensaje en 1.1 con F043")
- Modify: `docs/progress/feature-list.json` (F042 `status` and `notes` only), `docs/progress/PROGRESS.md` (session entry in the existing format)

- [ ] **Step 1: Run** `npm run verify` and `npm run scan:phi`; record exact counts.
- [ ] **Step 2: Set F042 `passing`** only if both pass; PROGRESS.md lists open questions: PaCO2/bands (decision 1), temperature thresholds and units for SIRS (°C), whether `wbc` uses band percent, UCUM annotation `{score}` policy.
- [ ] **Step 3: Commit** `docs(progress): mark F042 passing`.

## Self-review

- Spec coverage: both F042 criteria map to Task 1 (shape, source, verified_on) plus the verification table. Handoff to F043: the catalog gives the mapper `variable`, `ucum`, `loinc`.
- Open uncertainty: LOINC names were verified through NLM's API, not loinc.org (403). The `{score}` unit and SIRS band/PaCO2 inclusion await the clinician.
