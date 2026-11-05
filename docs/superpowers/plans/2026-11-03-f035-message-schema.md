# F035 Message Schema v1.0 (qSOFA slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new workspace package `packages/schema` (`@decidere/schema`) that holds the strict JSON schema of the `POST /v1/messages` message for the first slice (qSOFA: respiratory rate, systolic BP, Glasgow), the TypeScript types derived from that same schema, and a `validateMessage()` function whose errors can never contain a received value or an unknown field name.

**Architecture:** One plain JSON-Schema object (`as const`) is the single source. `validateMessage` runs it through a private Ajv 8 instance (strict, no coercion, no stripping, one error at a time), then a small semantic check (duplicate measurements), and maps Ajv errors to `{ path, code }` through a closed table. Types come from `json-schema-to-ts` (`FromSchema`). The package has no build step (Node 22.18 type stripping, `.ts` exports). It does NOT touch `apps/api` in this feature: wiring the route is F040, structured HTTP errors are F036.

**Tech Stack:** Node >=22.18, TypeScript 7 (typecheck only), Ajv 8, json-schema-to-ts 3 (types only), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-mvp-decomposition-design.md` (order item 7); F035 acceptance in `docs/progress/feature-list.json` (parte de F003); ADR-001 (no PII/PHI), ADR-004, ADR-007 (tri-state: absent / null / invalid = unknown).

**Consultations incorporated (2026-11-03):** backend-architect (ran real Ajv/TypeBox/tsc experiments) and clinical-informatics-auditor. Items marked "verified" were run by the architect on Node 26.3.0 with Ajv 8.20.0; Node 22.18 is checked by CI.

## Items needing the user's explicit approval

1. **Contract change (F035 is a data-contract change).** The proposed v1.0 message is in "The contract" below. Please confirm or edit it.
2. **Decision A or B for the variable identifier** (the auditor found a design tension): AGENTS.md says Mirth "translates upstream without changing the contract", while F043 (mapper) translates local codes.
   - **B (recommended):** `variable` is required and is the project's canonical id (`resp_rate | sbp | gcs`); no `code`/`system` fields in v1.0. The seed simulator sets it; a future Mirth adapter translates upstream. F043 then covers unit conversion and unmapped-variable handling at the adapter boundary, and its scope must be revisited when we get there.
   - **A:** `variable` optional, `code` + `system` of the sender required when it is missing, mapper translates. Larger contract, more free-ish strings (the most likely leak channel for identifiers).
3. **Dependencies** (licence and maintenance checked on 2026-11-03 via `npm view`):
   - `ajv@^8.20.0` (MIT; modified 2026-04-24; 2 npm maintainers; 4 small dependencies; **already in the tree** through Fastify's `@fastify/ajv-compiler`, so npm dedupes it). Declared by `packages/schema` itself. We build our OWN Ajv instance; Fastify's defaults (`coerceTypes:'array'`, `removeAdditional:true`, `useDefaults:true`) would silently coerce `"5"` to `5` and strip unknown keys, which breaks the strict contract and ADR-007.
   - `json-schema-to-ts@^3.1.1` (MIT; devDependency, types only, erased at runtime; deps `@babel/runtime`, `ts-algebra`; last release 2024-08-29, one maintainer: stale but types-only). Fallback if you reject it: hand-written types plus an agreement test, which is not truly a single source (conflicts with the acceptance criterion).
   - Not chosen: TypeBox 1.x (rewrite, API churn, its unknown-key errors carry the key name in two places), Zod 4 (6 MB, schema is code not a document), hand-written validator (we own bounds/enum/nesting/error paths in a safety contract; Ajv fits, unlike the evaluator case in ADR-007).
4. **Config change:** add `packages/**/*.ts` to the `include` of the root `tsconfig.json`.
5. **Provisional numeric bounds** (structural, not clinical; the clinician must confirm; marked `// provisional` in the code): see the contract table.
6. **ADR-008** (Task 4) recording the contract decisions; its draft is shown to you in chat before saving.

## The contract (v1.0, as proposed)

| Field | Rule |
|---|---|
| root | `additionalProperties:false`; required: `schema_version`, `message_id`, `source`, `instances` |
| `schema_version` | const `"1.0"`; checked first so a wrong version gets its own code |
| `message_id` | UUID **v4** pattern (v7/ULID carry a timestamp = hidden absolute date) |
| `source` | pattern `^[a-z0-9-]{1,32}$` (opaque emitter id, never free text) |
| `instances` | array, `minItems:1`, `maxItems:20` (current + historical together) |
| instance | required: `instance_id` (UUID v4), `kind` (enum `current` \| `historical`), `variables`; `variables` `maxItems:50` (empty allowed = all unknown) |
| variable | discriminated by `variable` enum; `value`: integer or `null` (`null` = not measured; never 0/−1 as "unknown"); `unit`: one closed value per variable; `t_offset_min`: integer |
| `resp_rate` | unit `"/min"`; `0 <= value <= 200` provisional |
| `sbp` | unit `"mm[Hg]"`; `0 <= value <= 400` provisional |
| `gcs` | unit `"{score}"`; total only; `3 <= value <= 15` (scale definition; verify against the primary source) |
| `t_offset_min` | `-10080 <= t <= 0` provisional (0 = message reference time, negative = past, no future), same for both kinds |
| semantic | within one instance, two variables with the same `variable` and the same `t_offset_min` are rejected (`duplicate_measurement`) |
| excluded | `diagnoses_icd10` (re-identification risk; F044), `loinc`/`code`/`system` (F042/F043), `label`/`note`/`description`, any date, age/sex |

Rationale notes: 0 stays allowed for `resp_rate` and `sbp` so a critical (apnea, cardiac arrest) is not rejected at the door; the schema rejects only the physically impossible, plausibility belongs to the mapper/clinician (ADR-007). Unit strings come from the illustrative ADR-007 appendix and are NOT verified against UCUM (F042 verifies). Historical instances get the same strict shape and caps (no unvalidated side channel); they are accepted and ignored by the engine, never persisted or logged beyond a count.

## Global Constraints

- The single verification command is `npm run verify`; the same runs in CI. Do not change its definition.
- Source files use `.ts` import extensions and `import type`; no enums/namespaces/parameter properties (verbatimModuleSyntax + erasableSyntaxOnly are on). `apps/api` is NOT modified.
- Ajv options exactly: `{ strict: true, allErrors: false, coerceTypes: false, removeAdditional: false, useDefaults: false }`. No `ajv-formats`, no `format:` keyword, no `$data`, no remote `$ref`. Compile once at module load.
- The schema contains `additionalProperties:false` on every object node and none of `patternProperties`, `additionalProperties:<schema>`, `propertyNames`, `dependentRequired` (so no received key name can reach `instancePath`). A test walks the schema and enforces this.
- Every string field is an enum, const, or a fully anchored fixed-charset pattern with `minLength` and `maxLength`; every number has `minimum` and `maximum`.
- The package never exports the raw Ajv instance, `validate.errors`, `message` or `params` of an Ajv error. Output errors are `{ path, code }` only, `path` being the JSON pointer of a KNOWN field.
- Never copy the input with spread/`Object.assign`; return the validated input object itself.
- Synthetic data only; UUIDs in fixtures are made up (random-looking, no meaning); a canary string such as `CANARY-7f3a` is used to prove nothing is reflected.
- Do not edit existing tests; do not touch `.claude/settings.json` or `.gitignore`; no push without approval; Conventional Commits, one logical change per commit.

## Review Focus

- A canary placed in an unknown key name, a wrong-typed value, an enum value, a pattern field and an id never appears anywhere in `JSON.stringify(result)` (ADR-001 verification). Task 2.
- No coercion: `"22"`, `true`, `22.5`, `1e999` (Infinity), `""` and `null` where not allowed are rejected; `value: null` is accepted; `-0` and `22.0` behave as documented. Tasks 1 and 2.
- `__proto__` / `constructor` as keys are rejected, not pollution. Task 2.
- Boundary pairs for every bound (offset 0 / +1 / −10080 / −10081; gcs 2/3/15/16; instances 20/21; variables 50/51; string lengths). Task 2.
- Unit not allowed for its variable (`kPa` for `sbp`), unit valid for another variable, wrong-case unit. Task 1.
- Duplicate (variable, offset) rejected; same variable with different offsets accepted. Task 3.
- Message with and without historical instances: same current instances after `currentInstances`. Task 3.

---

### Task 1: Package scaffold, schema, derived types, happy-path validation

**Files:**
- Create: `packages/schema/package.json`, `packages/schema/src/message.schema.ts`, `packages/schema/src/types.ts`, `packages/schema/src/validate.ts`, `packages/schema/src/index.ts`, `packages/schema/src/fixtures.ts`, `packages/schema/src/message.test.ts`
- Modify: root `tsconfig.json` (include `packages/**/*.ts`), `package-lock.json`

**Interfaces:**
- Produces: `SCHEMA_VERSION = "1.0"`; `messageSchema` (as const); `type Message = FromSchema<typeof messageSchema>`; `type ValidationCode = "unsupported_version" | "required" | "unknown_field" | "invalid_type" | "invalid_value" | "invalid_format" | "out_of_range" | "duplicate_measurement" | "invalid"`; `type ValidationError = { path: string; code: ValidationCode }`; `validateMessage(input: unknown): { ok: true; value: Message } | { ok: false; errors: ValidationError[] }`. Task 2 and 3 extend `validate.ts`.
- `package.json`: name `@decidere/schema`, private, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, `scripts.test = "node --test"`, `dependencies.ajv`, `devDependencies.json-schema-to-ts`.

- [ ] **Step 1: Scaffold with stubs.** `package.json`, a `validateMessage` stub that throws `"not implemented"`, `fixtures.ts` with synthetic builders (`validMinimal()`, `validQsofa()`, `withHistorical()`): plain objects with made-up UUID v4 values.
- [ ] **Step 2: Write failing tests** in `message.test.ts`: `valid minimal message passes`; `valid full qSOFA message passes (three variables, offsets 0, -5, -30)`; `value null is accepted`; `an instance with no variables is accepted`; `several instances (current + historical) pass`; `each unit is allowed only for its variable` (table: `/min` for `resp_rate` ok, `mm[Hg]` for `resp_rate` rejected, `kPa` for `sbp` rejected, `{score}` for `gcs` ok); `types: a valid Message literal typechecks` (a compile-time check run by `npm run typecheck`, plus a `// @ts-expect-error` line for an extra property and for a bad `kind`).
- [ ] **Step 3: Run** `node --test packages/schema/src/message.test.ts`. Expected: FAIL with `not implemented`.
- [ ] **Step 4: Install (after approval)** `ajv` as a dependency and `json-schema-to-ts` as a devDependency of the new workspace, using `--registry=https://registry.npmjs.org/` (the PHI hook blocks `name@version`-looking commands: write the ranges into `package.json` and run `npm install --registry=https://registry.npmjs.org/` instead). Check the lockfile has only registry.npmjs.org URLs (workspace links excepted), that `npm ls ajv` shows one deduped 8.x copy, and that only these two packages (plus their transitive dependencies) were added.
- [ ] **Step 5: Implement** the schema per the contract table (discriminated `oneOf` over three variable shapes; evaluate Ajv's `discriminator: true` option for cleaner errors and keep it only if it works with strict mode), `types.ts`, and `validateMessage` (check `schema_version` first, then Ajv; no error mapping beyond a placeholder code `invalid` yet). Add `packages/**/*.ts` to the root tsconfig `include`.
- [ ] **Step 6: Run** the package tests → pass; `npm run verify` → exit 0 (record counts).
- [ ] **Step 7: Commit** `feat(schema): add strict message schema v1.0 with derived types`.

### Task 2: Safe error mapping and hardening

**Files:**
- Modify: `packages/schema/src/validate.ts`
- Create: `packages/schema/src/errors.test.ts`

**Interfaces:** Consumes Task 1's `validateMessage`, `ValidationCode`, `ValidationError`. Produces the final error mapping: `required` → `path + "/" + params.missingProperty`, code `required`; `additionalProperties` → the KNOWN parent `instancePath`, code `unknown_field`, never reading `params.additionalProperty`; `type` → `invalid_type`; `enum`/`const` → `invalid_value` (the `schema_version` mismatch → `unsupported_version`); `pattern` → `invalid_format`; `minimum`/`maximum`/`minItems`/`maxItems`/`minLength`/`maxLength` → `out_of_range`; anything else → `invalid`. Never forwards `message`, `params` (other than `missingProperty`) or `schemaPath`. At most one error.

- [ ] **Step 1: Write failing tests** (`errors.test.ts`): `canary never appears in the result` (a canary in an unknown key at root, instance and variable levels; in a wrong-typed value; in an enum field; in the `source` pattern field; in `message_id`; assert `JSON.stringify(result)` does not include it and the code is the expected one); `missing required field names a known path` (each required field removed); `unknown field is reported at its known parent`; `string and boolean numbers are not coerced` (`"22"`, `true`, `22.5`, `""`); `1e999 parses to Infinity and is rejected`; `-0 and 22.0` are accepted and documented in the test name; `__proto__ and constructor as keys are rejected, Object.prototype is untouched`; `boundary pairs` for offsets (0, +1, -10080, -10081), gcs (2, 3, 15, 16), instances (20, 21), variables (50, 51), `source` length (32, 33), `message_id` not v4 (v7-shaped string rejected); `wrong schema_version has its own code`; `result contains no Ajv internals` (keys of every error are exactly `path` and `code`); `schema walk` (every object node has `additionalProperties:false`; none of the forbidden keywords anywhere; every string node has an enum/const or pattern+minLength+maxLength; every number node has minimum and maximum); `ReDoS guard` (a 1 MB string in `source` is rejected in under 100 ms).
- [ ] **Step 2: Run** → expected FAIL on mapping/leak tests (placeholder `invalid` code, possible leaks).
- [ ] **Step 3: Implement** the mapping table and the schema-walk-friendly schema fixes the tests expose.
- [ ] **Step 4: Run** the package tests → pass; mutation check: temporarily make the mapper read `params.additionalProperty` and confirm the canary test fails (revert after).
- [ ] **Step 5: `npm run verify`** → exit 0. **Commit** `feat(schema): map validation errors without values or unknown field names`.

### Task 3: Semantic check, historical handling and the fixture matrix

**Files:**
- Modify: `packages/schema/src/validate.ts`, `packages/schema/src/index.ts`
- Create: `packages/schema/src/semantic.test.ts`

**Interfaces:** Consumes Tasks 1-2. Produces `currentInstances(message: Message): Message["instances"]` (those with `kind === "current"`, declaration order) exported from the package; `duplicate_measurement` errors with path `/instances/<i>/variables/<j>` (the later duplicate).

- [ ] **Step 1: Write failing tests:** `same variable and same offset in one instance is rejected` (code `duplicate_measurement`, path of the second one); `same variable with different offsets is accepted`; `same variable and offset in different instances is accepted`; `variable order does not matter` (shuffled array validates identically); `historical instances are validated with the full strict shape` (an invalid historical instance rejects the whole message); `currentInstances ignores historical` (message with and without historical gives the same list); `a message with only historical instances is valid and yields no current instances` (document: the evaluator/F040 decides what that means); `diagnoses_icd10 is rejected as unknown_field` (deliberate deferral to F044); `no date-like or free-text field is accepted anywhere` (`note`, `label`, `created_at` each rejected).
- [ ] **Step 2: Run** → expected FAIL (no semantic check, helper missing).
- [ ] **Step 3: Implement** the post-schema duplicate scan (linear, using a `Set` of `variable|offset`; no mutation of the input) and `currentInstances`; export from `index.ts`.
- [ ] **Step 4: Run** the package tests → pass; `npm run verify` → exit 0 and `npm run scan:phi` → 0 hits.
- [ ] **Step 5: Commit** `feat(schema): reject duplicate measurements and expose current instances`.

### Task 4: ADR-008 draft and trackers

**Files:**
- Create: `docs/adr/ADR-008-contrato-de-mensaje-v1.md` (status "propuesto", `/adr` format, Spanish)
- Modify: `docs/progress/feature-list.json` (F035 `status` and `notes` only; F003 `notes` only), `docs/progress/PROGRESS.md` (append Sesión 5)

- [ ] **Step 1: Draft ADR-008 in chat (do NOT save yet).** It records: the contract table; decision A/B and why; no `loinc`/`code`/`system`/`diagnoses_icd10` in v1.0 and the bump path to 1.1; UUID v4 only; offset convention; the provisional bounds; Ajv usage rules (own instance, no coercion, no Fastify body schema: the route will call `validateMessage` explicitly, with a lower `bodyLimit`, F040); error mapping rules; known limitations (duplicate JSON keys are not detectable; Vercel deployment of a workspace package whose source is `.ts` is unverified; unit strings unverified against UCUM; Node 22.18 verified by CI only); open questions for the clinician and the lawyer (list below).
- [ ] **Step 2: After the user's approval/edits**, save the ADR; set F035 to `passing` ONLY with the evidence from `npm run verify` (and the CI run once pushed); append the PROGRESS entry (what was done, test counts, pending: F036 maps these codes to HTTP errors; F040 wires the route; F042/F043 revisit `variable`/unit handling; clinician confirmations).
- [ ] **Step 3:** `npm run verify` → exit 0. Commit `docs(adr): add ADR-008 message contract v1.0` and `docs(progress): mark F035 passing` separately.

## Open questions to carry into ADR-008 (not answered here)

Clinician: exact qSOFA criteria and thresholds (ADR-007 numbers are illustrative); the `t_offset_min` window for a current datum and the look-back for historical; which measurement counts when there are several of the same variable; plausibility ranges (is 0 possible; upper bounds; implausible to review or rejected); is an instance an episode or a snapshot (this plan assumes an episode with an offset per variable); is the GCS total enough; distinguish "not measured" from "measured but unreadable"; GCS canonical unit (`{score}` or `1`); adults only?; ICD-10 full code or category (for F044). Lawyer/compliance: whether relative offsets plus clinical values remain personal/health data under Ley 1581 and equivalents; whether accepting and discarding historical instances is "processing"; whether `source` (institution) identifies patients indirectly in a real deployment; data residency.

---

## Self-review

- **Acceptance coverage:** additionalProperties false and codes/units/labels as enums or patterns (Tasks 1-2, schema walk); bounded offsets, no absolute dates (contract table, Task 2 boundaries, Task 3 rejected date-like fields); TS types from the same schema (Task 1, `FromSchema`, compile-time check); tests: valid, missing fields, wrong types, several instances, historical ignored (Tasks 1-3).
- **Consultation findings:** architect (own Ajv instance, options, error table, no Fastify body schema, caps, ReDoS, proto keys, package layout, `exports` map verified) → Global Constraints, Tasks 1-2, approval items 3-4. Auditor (canonical enum, closed units per variable, signed offsets, null vs absent, privacy exclusions, UUID v4, vectors, open questions) → contract table, Tasks 2-3, open questions.
- **Names:** `validateMessage`, `ValidationCode`, `ValidationError`, `Message`, `currentInstances`, `messageSchema`, `SCHEMA_VERSION` are consistent across tasks.
- **Unverified until executed:** Ajv `discriminator` option with strict mode and our oneOf; json-schema-to-ts type-instantiation depth with the full schema under tsc 7; behaviour on Node 22.18 (CI); Vercel body limit and deploying a workspace package whose source is `.ts`; whether `22.0` is accepted as integer in the final Ajv config (documented by a test).
- **Not covered:** the HTTP route and structured HTTP errors (F040/F036), LOINC/UCUM verification (F042), mapper (F043), ICD-10 and infection proxy (F044), SIRS variables (F044/F045), certainty (F047).
