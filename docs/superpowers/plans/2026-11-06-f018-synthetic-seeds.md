# F018 Synthetic seeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `seeds/` holds at least 36 synthetic cases, each with an expected class and a cited criterion, covering the five minimum categories, plus a pure builder that turns a case into a valid contract 1.1 message with opaque ids. F050 (the e2e runner) will consume the builder; F018 does not POST anything.

**Architecture:** Cases live in one clinician-editable file `seeds/cases.json` (vitals and expected class, no ids). `seeds/build.ts` is a pure module: `buildMessage(case)` derives deterministic opaque UUIDs from the case id and emits a 1.1 message. Expected classes are written by hand from the published qSOFA criteria and the ADR-010 class table, and a small independent oracle inside the tests re-derives each label from the vitals, so a typo in a label fails a test without ever consulting the engine.

**Tech Stack:** TypeScript, `node:test`, `node:crypto`, Python 3 (existing PHI hook). No new dependency, no new workspace.

**Spec:** `docs/progress/feature-list.json` F018 (five categories; per-seed expected class, cited criterion and clinical approval record; synthetic, opaque ids, relative times; PHI hook not evaded; no MIMIC/PhysioNet data), AGENTS.md ("Gold standard", "Qué NO hacer"), ADR-010 (class table), ADR-011/012 (contract 1.1), ADR-001.

## Global Constraints

- Branch `feat/f018-seeds` from `main`; no push without approval. `npm run verify` and `npm run scan:phi` exit 0 (check with `echo $?`, no pipes). Code, commits, plan in English; ADR/README/PROGRESS in Spanish.
- Seeds are synthetic: ids are opaque UUIDs derived from the case id; times are integer minutes `t_offset_min <= 0`; no dates, no free text inside the generated message; the only text in `cases.json` is the case id, a closed `category`, the `criterion` citation and `note` fields written by the team (no patient data, no names, no emails, no phone numbers). The PHI hook is not evaded: no data/code seed path (`seeds/cases.json`, `seeds/build.ts`; the README is docs and may be allowlisted) contains `test`, `fixture`, `mock`, `example` (hook allowlist) and nothing is written with a shell trick.
- Labels are provisional: `labeling: "provisional"`, labelers `placeholder-A`, `placeholder-B`, adjudicator `null`, `clinical_approval: {status: "pending", approver: null}` at file level. Never claim kappa or zero discrepancies as evidence (F050 criterion).
- Contract: `schema_version: "1.1"`, `source: "sim-1"`, variable `code` values from `knowledge/mappings/sim-1.yaml` (`RR`, `SBP`, `GCS`; units `/min`, `mm[Hg]` or `kPa`, `{score}`). Values must pass `validateMessage` from `@decidere/schema`.
- Expected classes use the closed ids `critical | watch | no_alert | review` (the Spanish names are F050's mapping). They follow qSOFA (Singer et al., JAMA 2016;315(8):801-810, Box 4): RR >= 22, SBP <= 100, GCS < 15; T = true criteria, U = unknown (missing or null): T >= 2 -> `critical`; T = 1 and U = 0 -> `watch`; T = 0 and U = 0 -> `no_alert`; every other combination -> `review` (ADR-010 table). Never change an expected class so a run passes; if a label looks wrong, report it.
- Do not edit any existing test. Do not add MIMIC/PhysioNet data. No new dependency.

## Review Focus

1. A label typo (for example RR 22 labeled `watch` with SBP 95) must fail a test without the engine: the oracle test (Task 2).
2. Boundary values on both sides of every threshold (RR 21/22, SBP 100/101, GCS 14/15) are present and labeled strictly (Task 2 composition test).
3. A seed with `value: null` and a seed with the variable absent are both `unknown` (Task 2).
4. A message with a `historical` instance next to a `current` one: the label is for the current instance only (Task 2).
5. Ids are deterministic and unique: building the same case twice gives the same ids; two cases never share one; ids look like UUID v4 strings (Task 1).

## File Structure

- Create `seeds/build.ts` (types, `opaqueId`, `buildMessage`), `seeds/cases.json`, `seeds/README.md`.
- Create `tests/seeds-build.test.ts` (Task 1), `tests/seeds-cases.test.ts` (composition, oracle, validation), `tests/seeds-phi.test.ts` (hook not evaded).
- Modify `tsconfig.json` (add `"seeds/**/*.ts"` to `include`), `.github/CODEOWNERS` (add `/seeds/ @GlennRTC`, same interim comment style).
- Create `docs/adr/ADR-016-seeds-sinteticos-provisionales.md`; update `docs/progress/PROGRESS.md` and `docs/progress/feature-list.json` (F018 `status`/`notes`; F050, F019 `notes` only).

---

### Task 1: Seed format and builder

**Files:**
- Create: `seeds/build.ts`
- Modify: `tsconfig.json`
- Test: `tests/seeds-build.test.ts`

**Interfaces:**
- Consumes: `MessageV11`, `validateMessage` from `@decidere/schema`.
- Produces (exported from `seeds/build.ts`):
  - `type SeedClass = "critical" | "watch" | "no_alert" | "review"`
  - `type SeedCategory = "clear_positive" | "clear_negative" | "boundary" | "missing_data" | "contradictory"`
  - `type SeedVital = { code: "RR" | "SBP" | "GCS"; value: number | null; unit: string; t_offset_min?: number }` (`t_offset_min` defaults to `0`)
  - `type SeedInstance = { kind: "current" | "historical"; vitals: SeedVital[] }`
  - `type SeedCase = { id: string; category: SeedCategory; expected_class: SeedClass; criterion: string; note?: string; instances: SeedInstance[] }` (`expected_class` is for the first `current` instance; a case has exactly one `current` instance)
  - `type SeedFile = { labeling: "provisional"; labelers: { a: string; b: string; adjudicator: string | null }; clinical_approval: { status: "pending" | "approved"; approver: string | null }; cases: SeedCase[] }`
  - `function opaqueId(kind: "message" | "instance", caseId: string, index?: number): string` (UUID v4-shaped, deterministic)
  - `function buildMessage(c: SeedCase): MessageV11`

- [ ] **Step 1: Write the failing tests** in `tests/seeds-build.test.ts` (use a two-instance inline case):
  - `opaqueId is deterministic, v4-shaped and distinct per input` (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`; same inputs equal; different `kind`, `caseId` or `index` differ).
  - `buildMessage emits a valid 1.1 message for the sim-1 source` (`validateMessage(...)` is `ok`; `schema_version === "1.1"`, `source === "sim-1"`).
  - `buildMessage keeps null values and defaults t_offset_min to 0`.
  - `buildMessage gives each instance its own id and the message its own id`.
  - `buildMessage contains no text from the case beyond codes, units and numbers` (`JSON.stringify` of the message does not include the case `id`, `criterion` or `note`).
- [ ] **Step 2: Run to verify failure**

Run: `npm test -w tests -- --test-name-pattern="opaqueId|buildMessage"`
Expected: FAIL (module `../seeds/build.ts` not found).

- [ ] **Step 3: Implement `opaqueId` and `buildMessage` in `seeds/build.ts`** with the types above. `opaqueId`: SHA-256 of `` `${kind}:${caseId}:${index ?? 0}` `` from `node:crypto`, first 16 bytes, set version nibble to 4 and variant bits to `10`, format as UUID. Add `"seeds/**/*.ts"` to the root `tsconfig.json` `include`.
- [ ] **Step 4: Run to verify pass**

Run: `npm test -w tests && npm run typecheck`
Expected: PASS, typecheck clean.
- [ ] **Step 5: Commit**

```bash
git add seeds/build.ts tests/seeds-build.test.ts tsconfig.json
git commit -m "feat(seeds): build opaque-id contract 1.1 messages from seed cases (F018)"
```

### Task 2: The cases, composition checks and the PHI hook test

**Files:**
- Create: `seeds/cases.json`, `tests/seeds-cases.test.ts`, `tests/seeds-phi.test.ts`
- Modify: `.github/CODEOWNERS`

**Interfaces:**
- Consumes: `SeedFile`, `SeedCase`, `buildMessage` (Task 1).
- Produces: `seeds/cases.json` shaped as `SeedFile` (F050 reads it).

- [ ] **Step 1: Write the failing tests** in `tests/seeds-cases.test.ts` (load `seeds/cases.json` with `JSON.parse(readFileSync(...))`):
  - `file declares provisional labeling and pending clinical approval` (`labeling === "provisional"`, `labelers.a` and `.b` start with `placeholder-`, `adjudicator === null`, `clinical_approval.status === "pending"`, `approver === null`).
  - `composition: at least 36 cases and at least 5 per category` for all five categories; `all four classes appear`; `at least 3 boundary cases per class that occurs there`.
  - `case ids are unique, kebab-case and at most 40 characters`.
  - `every case builds a valid message` (`validateMessage(buildMessage(c)).ok`) and `opaque ids are unique across all cases` (all message and instance ids).
  - `every case has exactly one current instance, t_offset_min <= 0 integers, and a non-empty criterion that cites Singer 2016 and the ADR-010 table`.
  - `boundary values are covered on both sides`: some case has RR 21 and some RR 22; SBP 100 and 101; GCS 14 and 15 (read from the vitals of current instances).
  - `a null value and an absent variable both occur` (some current instance with a `null` vital, some with a variable missing entirely).
  - `a case with a historical instance exists and its label follows the current instance only`.
  - `expected_class matches the independent qSOFA oracle for every case`: a local function `oracle(vitals)` in the test converts kPa to mm[Hg] only for `SBP` (value * 7.500637554192106), picks the latest non-null value per variable (largest `t_offset_min`), computes T and U with the Global Constraints rules and returns the class; assert equality for each case with a message naming the case id. The oracle must not import anything from `engine/` or `packages/rules`.
  And in `tests/seeds-phi.test.ts`:
  - `seed files are not under a hook-allowlisted path` (paths `seeds/cases.json`, `seeds/build.ts` contain none of `test`, `fixture`, `mock`, `example`, `.md`; read the allowlist from `.claude/hooks/check_phi_patterns.py` by regex so the test follows the hook).
  - `the PHI hook lets seeds/cases.json through` (spawn `python3 .claude/hooks/check_phi_patterns.py` with stdin JSON `{tool_name: "Write", tool_input: {file_path: "seeds/cases.json", content: <file text>}}`; expect exit 0).
  - `the same hook blocks an email written to a seed path` (content with a synthetic `a@b.co`-style email; expect exit 2), proving the hook is active for `seeds/`.
- [ ] **Step 2: Run to verify failure**

Run: `npm test -w tests -- --test-name-pattern="seed|oracle|PHI hook"`
Expected: FAIL (`seeds/cases.json` not found).

- [ ] **Step 3: Author `seeds/cases.json`** (>= 36 cases; values and labels by hand from the qSOFA rule in Global Constraints; the oracle test is the check). Required scenarios per category (choose realistic adult vitals; vary ids like `pos-rr-sbp-01`):
  - `clear_positive` (>= 8, all `critical`): RR+SBP, RR+GCS, SBP+GCS, all three, an extreme case (RR 34, SBP 70, GCS 9), one with SBP in `kPa` (for example 9.5), one with `RR` measured at `-5` min, one whose three criteria are measured at different offsets.
  - `clear_negative` (>= 8, all `no_alert`): normal vitals with variation, one with SBP in `kPa` (for example 16), GCS 15 always.
  - `boundary` (>= 12): RR 21 / 22 alone; SBP 101 / 100 alone; GCS 15 / 14 alone; RR 22 + SBP 100 (`critical`); RR 21 + SBP 101 + GCS 15 (`no_alert`); RR 22 + SBP 101 + GCS 15 (`watch`); RR 21 + SBP 100 + GCS 14 (`critical`); RR 21 + SBP 101 + GCS 14 (`watch`); labels follow strict thresholds. Do not use SBP in `kPa` here (conversion rounding is an open clinical question).
  - `missing_data` (>= 8): GCS absent with RR and SBP true (`critical`); GCS absent with RR true and SBP normal (`review`); all three absent (`review`); RR `null` with the rest normal (`review`); SBP absent with RR normal and GCS 15 (`review`); two variables absent with one normal (`review`); GCS `null` with RR and SBP both normal (`review`); one absent with the other two true (`critical`).
  - `contradictory` (>= 6): RR high, SBP normal, GCS 15 (`watch`); SBP low, the rest normal (`watch`); RR high and SBP low with GCS 15 (`critical`); a message with a `historical` instance showing severe vitals and a `current` instance normal (`no_alert`); a `historical` normal and a `current` critical (`critical`); two measurements of one variable at different offsets where the latest wins (the `current` label follows the latest non-null value; add `note: "latest measurement wins (provisional, ADR-010 question 8)"`).
  Every `criterion` reads like "qSOFA >= 2 (Singer 2016, Box 4); class per ADR-010 table: <short reason>". Add the file-level `labeling`, `labelers`, `clinical_approval` per Global Constraints. Add `/seeds/ @GlennRTC` to `.github/CODEOWNERS`.
- [ ] **Step 4: Run to verify pass**

Run: `npm test -w tests && npm run lint`
Expected: PASS. If the oracle disagrees with a hand label, re-check the arithmetic; if the oracle itself looks wrong, stop and report (do not edit the oracle to fit).
- [ ] **Step 5: Commit**

```bash
git add seeds/cases.json tests/seeds-cases.test.ts tests/seeds-phi.test.ts .github/CODEOWNERS
git commit -m "feat(seeds): add 36 provisional synthetic cases with cited criteria (F018)"
```

### Task 3: README, ADR, compliance review and closing verification

**Files:**
- Create: `seeds/README.md`, `docs/adr/ADR-016-seeds-sinteticos-provisionales.md` (`/adr`, Spanish, status `propuesto`)
- Modify: `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json`

- [ ] **Step 1: Run `clinical-safety-compliance-reviewer` (read-only) on the branch diff**: synthetic-data guarantees (ADR-001), hook not evaded, no MIMIC/PhysioNet material, wording of labels as provisional, whether any case could pass as real patient data. Save findings under the SDD workspace and summarize them in the ADR.
- [ ] **Step 2: Write `seeds/README.md`** (Spanish): file format, how to add a case, the label rule (qSOFA + ADR-010 table), that labels are provisional, the placeholder labelers, that the engine must not be consulted when labeling, and that near-threshold cases (RR 21, SBP 101-104) are labeled by criteria and may be routed to review by the certainty layer (ADR-015): F050 reports those divergences separately, it must not relabel them.
- [ ] **Step 3: Write ADR-016**: the format, deterministic opaque ids (and the limitation that they are derived, not random), the oracle-based label check, provisional labels and placeholders, the known divergence class for boundary cases versus certainty routing, what F050 must do, out of scope (SIRS seeds while SIRS is inactive, temporal "worst vs latest" seeds pending ADR-010 question 8, the real double labeling and kappa of F019/F051).
- [ ] **Step 4: Update `feature-list.json`** (only `status`/`notes`): F018 `passing` after Step 5 passes, notes say passing means provisional labels, placeholder labelers and pending clinical approval; F050 notes: consume `seeds/build.ts` and `seeds/cases.json`, report boundary divergences separately, keep labels untouched; F019 notes: the file already carries the placeholder labelers to replace.
- [ ] **Step 5: Verify**

Run: `npm run verify; echo $?` then `npm run scan:phi; echo $?`
Expected: both `0`; record the exact test counts in PROGRESS.md (session 22).
- [ ] **Step 6: Commit**

```bash
git add seeds/README.md docs/adr/ADR-016-seeds-sinteticos-provisionales.md docs/progress/PROGRESS.md docs/progress/feature-list.json
git commit -m "docs(progress): mark F018 passing and record ADR-016"
```

## Self-review notes

- Spec coverage: five categories and >= 36 cases (Task 2), expected class + cited criterion + clinical approval record (Task 2 file-level pending), synthetic ids and relative times (Tasks 1-2), hook not evaded (Task 2), no MIMIC/PhysioNet (Global Constraints, compliance review).
- Out of scope, on purpose: the runner and the POSTs (F050), kappa and real labelers (F019/F051), SIRS seeds (rule inactive), a seeds workspace in `package.json` (avoids a lockfile change).
- Decision to confirm: boundary seeds are labeled by the published criteria; the engine will send some to `revisión clínica` through the certainty layer (ADR-015). The plan keeps both facts visible instead of bending the label or the engine.
