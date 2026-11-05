# F033 Condition Evaluator Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide, with evidence, how rule conditions are written in YAML and evaluated: `json-logic-engine` (plus whatever wrapper it needs) versus a small custom comparator (plan B). The deliverable is a decision record (ADR-007, status "propuesto") and a question for the user; no production code.

**Architecture:** A throwaway harness in a scratch directory OUTSIDE the repo runs one shared experiment matrix against both candidates, judged against a brute-force oracle for three-valued logic. Nothing is added to the repo's `package.json`, lockfile or workspaces. The only repo changes are docs: this plan, ADR-007, and the F033 tracker entries.

**Tech Stack:** Node >=22.18 (native TS stripping, `node:test`), TypeScript 7 for the type-quality check, `json-logic-engine@5.0.7` installed ONLY in the scratch directory.

**Spec:** `docs/superpowers/specs/2026-11-03-mvp-decomposition-design.md` (order item 4); F033 acceptance in `docs/progress/feature-list.json`; ADR-002 (rules as versioned YAML, json-logic "subject to the spike", plan B custom comparator), ADR-003 (certainty; best/worst case), ADR-004 (engine is pure, no I/O).

**Consultations incorporated (2026-11-03):** backend-architect (ran real experiments), clinical-informatics-auditor, clinical-ux-designer. Their claims marked "verified" below are from real runs by the backend-architect; everything else is re-checked by this spike.

## Items needing the user's explicit approval

1. **Scratch-only install** of `json-logic-engine@5.0.7` (MIT; sole npm maintainer; 9 open issues; releases every 2 to 3 months, last 2026-04-01; no runtime dependencies; compiles rules with global `eval`) into a throwaway directory outside the repo, with `--registry=https://registry.npmjs.org/`. This is NOT adding a project dependency. `json-logic-js` (2.0.5, MIT, last release 2024-07, 84 open issues) is NOT tested: it showed the same missing-data semantics as the engine in the architect's 17-case probe, so it is rejected in the record without further testing.
2. **The decision itself** (F033 criterion 5): at the end, the user chooses engine or custom comparator. F033 does not become `passing` until the user decides.
3. **ADR-007 draft** is shown in chat for your approval before it is saved (your standing rule for ADRs).

## Global Constraints

- The spike's code is throwaway: it lives under `/tmp/claude-1000/-home-glenn-Denv-decidere-v2/20e12d35-a708-44e3-96eb-7f063869434d/scratchpad/spike-f033/` and is never committed. Its result survives as the ADR appendix (experiment table and the runnable script text), not as a code directory. Keeping the code is a new request.
- Do not create `engine/`, `knowledge/` or any workspace; do not touch `package.json` or `package-lock.json`; do not add dependencies to the repo.
- Fixtures are synthetic and "mechanics only": clinical-shaped variable names (`resp_rate`, `sbp`, `gcs`, `temp_c`, `heart_rate`, `wbc`, `paco2`) with illustrative numbers. They are NOT a transcription of qSOFA/SIRS (that is F038/F045, from the cited sources, with clinical approval pending). The ADR must say so. Do not present any threshold as clinically validated.
- Time-box: 3 hours of work. Stop rule: if the engine fails rows 1 to 4 and the wrapper it needs is not smaller than the custom comparator, stop testing the engine (Task 3 then covers the custom comparator only) and say so in the record.
- Result vocabulary in the spike: `true | false | unknown` (internal). UI labels `met / not_met / not_evaluable` ("Sin dato") are F062/F024's concern; record the mapping in the ADR.
- No `eval`/`Function` in the custom comparator; no I/O; no `Date`, `Math.random` or locale dependence; closed operator table.
- Conventional Commits; docs only; no push without the user's approval; do not stage `.claude/settings.json` or `.gitignore`.

## Review Focus

- A missing datum must never become `false` or `true` by coercion (`undefined`, `null`, `""`, `"abc"`, `NaN`, `Infinity`, numeric strings, `0` is a real value). Row 1.
- "At least k of N" with unknowns: T>=k true; T+U<k false; else unknown; and the invariant "best case reaches k ⇒ never `sin alerta`" holds as a property (fuzz against brute force). Rows 2 and 4.
- Every condition appears in the trace, including ones short-circuited away (`not_evaluated`), in declaration order, with stable ids. Row 3.
- Same input ⇒ byte-identical output, also after YAML key reordering and in a second process. Row 5.
- Boundary pairs (v-1, v, v+1) for every operator; unit conversion is the mapper's job, evaluator sees canonical numbers only. Row 6.
- The `eval` trust boundary: rules must be PR-reviewed YAML; if rules ever arrive at runtime (rule upload, expert UI, DB content), eval becomes an injection vector. Row 7.

## Experiment matrix (shared by both candidates)

| Row | What | Discriminates |
|---|---|---|
| 1 | Tri-state on missing/garbage: `x > t`, `x < t`, `x == t` with `{}`, `null`, `undefined`, `""`, `"abc"`, `"3"`, `NaN`, `Infinity`, `0`, valid number | Missing/invalid ⇒ `unknown` (never false/true); `0` evaluated; numeric string rejected. Bare engine returns `true` for `lactate < 2` on `{}` (verified): a wrapper is mandatory |
| 2 | Kleene `and`/`or`/`not` over A=true, B=unknown, C=false | `A∧B=unknown`, `B∧C=false`, `A∨B=true`, `B∨C=unknown`, `¬B=unknown` |
| 3 | Trace of `and[a, or[b, c]]` for `{a:0}` and `{a:5,b:5,c:9}` | All leaves appear; skipped ones as `not_evaluated`; declaration order; ids stable. Engine short-circuits and returns a bare operand (verified) |
| 4 | `atLeast k of N` (k=2,N=3 and N=4) incl. the key pair [1 true + 2 unknown] vs [1 true + 1 false + 1 unknown] (both `unknown`), all-unknown, and a fuzz over all 3^N assignments vs brute force; trace carries T, U, F, min=T, max=T+U | Engine has no such primitive; boolean `+` differs across libraries (verified) |
| 5 | Determinism: 1000 repeated runs, 2 processes, rule key reordering, cold vs cached compile; hash of serialized output | Byte-identical |
| 6 | Boundaries (v-1, v, v+1) for `>`, `>=`, `<`, `<=`, `==`; temperatures with decimals (38.0 / 38.1 / 36.0 / 35.9); a float-derived value (e.g. 100.4 converted) documented, not used with `==` | No off-by-one; floats |
| 7 | Security (engine only if still alive): rule keys/literals with quotes, backticks, `${}`, newlines; `var: "__proto__"`, `constructor.prototype`; deeply nested rule; can operators (`map`, `reduce`, `method`, `log`) be removed/allow-listed; context passed as a null-prototype object. Custom comparator: closed operator table, unknown op/variable rejected at load | Eval injection surface; `var` reads inherited properties (verified: `constructor.name` → `"Object"`) |
| 8 | Types and size: 10 lines of strict TS against the engine's `.d.ts` under `tsc` 7 (`run()` return type, rule typing); package size, cold-start of compiling about 50 rules; README check for any trace/introspection feature; wrapper LOC vs comparator LOC | Maintainability, "is the adapter bigger than the comparator" |

Fixtures for rows 2 to 4 use: `rr: resp_rate >= 22`, `sbp: sbp <= 100`, `gcs: gcs < 15` (and a 4-condition SIRS-shaped set with an `or` inside one criterion, e.g. `resp_rate > 20 or paco2 < 32`), all labelled "mechanics only".

---

### Task 1: Harness, oracle and the custom comparator (plan B)

**Files (scratch only):**
- Create: `spike-f033/oracle.ts`, `spike-f033/vectors.ts`, `spike-f033/custom.ts`, `spike-f033/custom.test.ts`, `spike-f033/package.json` (`"type": "module"`)

**Interfaces:**
- Produces (shared by Task 2/3): `type Tri = true | false | "unknown"`; `type TraceEntry = { id: string; kind: "leaf" | "all" | "any" | "not" | "atLeast"; result: Tri | "not_evaluated"; observed?: number | null; op?: string; threshold?: number; reason?: "missing" | "invalid"; t?: number; u?: number; f?: number; min?: number; max?: number }`; `type Evaluator = (rule: Rule, input: Record<string, unknown>) => { result: Tri; trace: TraceEntry[] }`; `oracle(kind, k, children: Tri[]): Tri` (brute force over every true/false assignment of the unknowns: unknown iff both outcomes are reachable); `vectors` = the row 1 to 6 cases as data (input, rule, expected result and expected trace ids).
- Rule shape under test (style B from the clinical-ux review, YAML-parsed object): `conditions: [{id, label, variable, op, value, unit}]` and `combine: {all|any|not|atLeast:{n, of:[ids...]}}`; the same logical rule is also expressed as json-logic for Task 2.

- [ ] **Step 1: Write the oracle and vectors** (`oracle.ts`, `vectors.ts`) with expected values from the matrix and the auditor's vectors (qSOFA-shaped Q1 to Q9, SIRS-shaped S1 to S10 as mechanics fixtures). Write `custom.test.ts` (node:test) asserting every vector and the 3^N fuzz against the oracle.
- [ ] **Step 2: Run** `node --test custom.test.ts` in the scratch dir. Expected: FAIL (module `custom.ts` missing). Then add a stub that throws and rerun to see failures for the intended reason.
- [ ] **Step 3: Implement `custom.ts`**: `evaluate: Evaluator` with the closed operator table (`>`, `>=`, `<`, `<=`, `==`), a leaf reading only `typeof value === "number" && Number.isFinite(value)` (everything else `unknown` with a `reason`), combinators `all`, `any`, `not`, `atLeast` evaluating every child (no short-circuit), trace entries in declaration order with `not_evaluated` never needed because nothing is skipped, and load-time validation that rejects unknown operators, unknown variables and duplicate ids with an error that does not echo the offending value. Keep it dependency-free.
- [ ] **Step 4: Run** `node --test custom.test.ts` → all pass. Record the file's line count (the number the engine's wrapper is compared against).
- [ ] **Step 5: Save the log** of the pass run in `spike-f033/results-custom-1.txt` (scratch).

### Task 2: json-logic-engine candidate, rows 1 to 4 (stop rule)

**Files (scratch only):** `spike-f033/engine.ts`, `spike-f033/engine.test.ts`; install `json-logic-engine@5.0.7` into `spike-f033/` with `--registry=https://registry.npmjs.org/` (after approval 1).

**Interfaces:**
- Consumes: Task 1's `Evaluator`, `TraceEntry`, `oracle`, `vectors`.
- Produces: `evaluateWithEngine: Evaluator`, built with the synchronous `LogicEngine` only, no custom methods, context passed as a null-prototype copy of the input.

- [ ] **Step 1: Bare engine probes first** (no wrapper): run rows 1 to 4 inputs through `engine.run(rule, input)` and print the raw outputs into `results-engine-bare.txt`. Expected: missing ⇒ coerced (`lactate < 2` on `{}` is `true`), short-circuit returns a bare operand, no `atLeast`. Confirm these on this machine; if any differs from the architect's findings, say so.
- [ ] **Step 2: Write `engine.test.ts`** reusing Task 1's vectors/oracle against `evaluateWithEngine`; run it against a stub. Expected: FAIL.
- [ ] **Step 3: Implement the minimum wrapper** that makes rows 1 to 4 pass: pre-check each leaf variable (finite number, else `unknown` with reason), evaluate each leaf with `engine.run` on a single-comparison rule, then combine results in your own Kleene code (so the library supplies only the five comparisons). Record the wrapper's line count.
- [ ] **Step 4: Run** the engine tests. Apply the stop rule: if rows 1 to 4 pass only because the wrapper does all the work, state "library used only for leaf comparison" and compare line counts with Task 1. Write the verdict for rows 1 to 4 into `results-engine-1-4.txt`.

### Task 3: Remaining rows for the survivors, plus README/types/size

**Files (scratch only):** `spike-f033/rows5to8.test.ts`, result logs.

**Interfaces:** Consumes both evaluators from Tasks 1 and 2 (only the custom one if the stop rule fired).

- [ ] **Step 1: Row 5 (determinism)** for each surviving candidate: 1000 runs, a second process via `node` child, key-reordered rule, cold vs cached; hash serialized `{result, trace}` and assert one distinct hash.
- [ ] **Step 2: Row 6 (boundaries/floats)**: the boundary triples for all five operators; the float documentation case.
- [ ] **Step 3: Row 7 (security)**: for the engine, the injection fuzz, prototype access, nested depth, operator allow-listing; for the custom comparator, unknown op/variable/duplicate id rejection and no echo of values in errors. Record what could not be verified.
- [ ] **Step 4: Row 8 (types/size)**: the 10-line strict TS check under `tsc` 7 against the engine's `.d.ts`; `npm pack`/unpacked size; compile-time for about 50 rules once; README check for trace support; wrapper vs comparator line counts.
- [ ] **Step 5:** Collate all `results-*.txt` into one table (row × candidate × pass/fail × evidence). State plainly whether F033 actually discriminated or whether the first test decided it.

### Task 4: ADR-007 draft, shown before saving; trackers

**Files:**
- Create: `docs/adr/ADR-007-evaluador-de-condiciones.md` (status "propuesto", format of the `/adr` command: Fecha, Estado, Contexto, Decisión, Alternativas consideradas, Consecuencias), in Spanish like the other ADRs
- Modify: `docs/progress/feature-list.json` (F033 `notes` only; `status` stays `failing` until the user decides), `docs/progress/PROGRESS.md` (append Sesión 4)

**Interfaces:** Consumes the Task 3 table.

- [ ] **Step 1: Draft ADR-007 in chat** (do NOT save yet). Content: the experiment table with exact inputs/outputs; licence and maintenance numbers with the date checked (2026-11-03) and their caveats (single maintainer, last release 2026-04-01, `eval`); the trust-boundary conditional (rules must stay PR-reviewed YAML; rule upload, expert editing UI or DB-stored rule content would make `eval` an injection vector, which matters because the role "experto" audits rules); the recommended condition format (flat style B with infix operators, one condition per block, explicit unit, Spanish label, explicit stable `id`, `combine` section) with the qSOFA-shaped snippet in both json-logic and style B; the tri-state semantics (Kleene, `atLeast` best/worst case with min/max in the trace) and the vocabulary mapping (`true/false/unknown` internal ⇒ UI "cumple / no cumple / sin dato"); the recommendation; plan B description; what is NOT decided (thresholds, plausibility limits, completeness floor, staleness: F038/F045/F047 with the clinician); appendix with the runnable script text.
- [ ] **Step 2: Present to the user**: the draft, the recommendation, and the single question "approve `json-logic-engine@5.0.7` as a project dependency, or build the custom comparator?" plus the open clinical questions below. Wait for the answer.
- [ ] **Step 3: After approval/edits**, save ADR-007; update F033 `notes` (decision, pointer to ADR-007) and set `status` to `passing` ONLY if the user has decided; append the PROGRESS entry (what was done, evidence, pending). If the decision changes ADR-002's wording ("sujeto al spike"), propose the edit to ADR-002 as a separate change and ask first (ADRs are accepted by the user).
- [ ] **Step 4: Verify** `npm run verify` → exit 0 and `npm run scan:phi` → 0 hits (docs only; confirm the working tree has no scratch files). Commit `docs(adr): add ADR-007 condition evaluator decision` and `docs(progress): mark F033 passing` (separate commits).

## Open clinical questions to carry into the ADR (for the clinician, not answered here)

1. SIRS respiratory criterion when PaCO2 is absent and RR is not elevated: `unknown` (strict) or `false`? (Workload cost: many cases to review.)
2. Class when only unknowns can reach the threshold (e.g. 1 true + 2 unknown): `vigilancia` or `revisión clínica`; and when `sin alerta` is allowed with some unknowns (ADR-003 completeness floor).
3. Plausibility limits per variable and whether an implausible value is flagged, evaluated, or both (a critical-direction implausible value must not be suppressed).
4. Is GCS < 15 the operationalisation of altered mentation, or may the rule accept an AVPU/"altered" flag?
5. Staleness window for a value to count as current.
6. Inclusive vs strict at each boundary, confirmed against the primary texts; whether qSOFA >= 2 alone is `crítico`; whether SIRS >= 2 is accepted as an alert criterion.
7. Does the clinician read the flat style B (Spanish labels inside the YAML, UCUM vs everyday units) without explanation? Pending-approval badge per rule or per condition (proposed: per rule)?
8. Summary wording with unknowns ("2 cumplidos, 1 sin dato" vs "2 de 3 evaluables"), and whether "sin dato" pushes a case to review or only shows a warning.

---

## Self-review

- **Acceptance coverage:** (1) missing ⇒ unknown: rows 1, 2, Tasks 1 to 2; (2) per-condition trace: row 3; (3) determinism: row 5; (4) licence/maintenance verified and plan B documented: Approval 1 data + Task 3 row 8 + ADR; (5) decision presented to the user: Task 4 Steps 2 to 3, `passing` gated on the decision.
- **Consultation findings:** architect (skip json-logic-js, verified coercion/short-circuit/eval facts, scratch location, timebox, ADR as artifact) → Global Constraints, rows 1 to 8, Task 4. Auditor (Kleene, atLeast bounds, invariant, boundary/garbage/float, trace content, open questions) → rows 1 to 6, Review Focus, open questions. UX (trace fields, tri-state labels, style B, order/ids, no short-circuit) → TraceEntry, Task 1 rule shape, ADR content.
- **Names:** `Tri`, `TraceEntry`, `Evaluator`, `oracle`, `vectors`, `evaluate`, `evaluateWithEngine` are consistent across tasks.
- **Unverified until executed:** whether the engine has any introspection/trace feature (README), operator allow-listing, TS type quality, escaping safety of the compiler, performance, Vercel Node runtime allowing global eval, GitHub issue contents and advisories.
- **Not covered:** thresholds/transcription (F038/F045), certainty formula (F047), mapper and unit conversion (F042/F043), rule schema/loader/`rule_set_version` (F037).
