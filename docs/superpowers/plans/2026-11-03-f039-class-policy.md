# F039 Provisional Class Policy Implementation Plan

Nota: el "experto" es un subagente de IA, no un clínico humano.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `classify` function that turns the engine's per-rule results into exactly one of four classes with a cited criterion, a conflict flag and the highest reachable class, plus the optional `severity` key in the rule file so clinicians review the mapping with the thresholds.

**Architecture:** `engine/src/policy.ts` (pure, no I/O, no deps) reads `rules[].result` and the trace (never `fired`) together with a `severities` map. `packages/rules` gains an optional `severity` key (format v1, additive), carries it in `RuleMeta` (so it is part of `rule_set_version`) and exposes `LoadedRuleSet.severities`. The mapping is PROVISIONAL, team-defined, and out of the metrics until a clinician approves it.

**Tech Stack:** TypeScript on Node (native type stripping), `node:test`, `@decidere/engine`, `@decidere/rules`.

**Spec:** `docs/progress/feature-list.json` F039 (+ F007 criteria), ADR-003 (critical never degrades; `revisión clínica` only replaces vigilancia/sin alerta), ADR-007 (Kleene; invariant: best case reaches threshold => never "sin alerta"), ADR-002 (rule_set_version changes when anything that changes the classification changes). Clinical advice: independent consult by `clinical-informatics-auditor` (2026-11-03), reproduced in the decision table below.

## Global Constraints

- Classes: `crítico`, `vigilancia`, `sin alerta`, `revisión clínica`. Code identifiers (ASCII, closed): `ClassId = "critical" | "watch" | "no_alert" | "review"`. Mapping to the Spanish names is the response/UI contract (F040/F062), not decided here.
- Rank for "maximum severity" (team-defined, provisional): `no_alert` 0 < `watch` 1 < `review` 2 < `critical` 3. Reason: a possible critical sitting in review must never look less prominent than a vigilancia; a definite critical wins over review.
- The policy never reads `RuleSetResult.fired` (it merges unknown with false). It reads `rules[].result` and `rules[].trace`.
- `sin alerta` requires: the rule is `false` AND no leaf of that rule is `unknown` AND (for `critical` rules with an `atLeast` root) `t == 0`. Missing and invalid inputs behave identically (both are `unknown` leaves).
- A `critical` result is never lowered by anything in this policy. `requires_confirmation` belongs to certainty (F047), not here.
- Fail closed: empty `rules`, a rule without severity, or malformed input throws `PolicyError` (closed codes); never returns `no_alert` by default.
- Output carries `provisional: true` and `policy_version: "policy-provisional-1"` (a constant; F040 stores it with every interpretation). Changing the table requires bumping the constant.
- Criterion wording must say "high-risk screen (qSOFA >= 2)" style, never "sepsis" (no infection precondition exists yet).
- Rule file format stays `format_version: 1`; `severity` is an OPTIONAL additive key (`critical` | `watch`). Reason: bumping the version would break the existing test that asserts `format_version: 2` is rejected (`schema.test.ts:448`), and tests must not be edited.
- Do not edit existing tests. Synthetic data only. Code/comments/commits in English; docs in Spanish. Commits `feat(engine): ...`, `feat(rules): ...`, `docs(...)`; trailer `Claude-Session: https://claude.ai/code/session_01K6u7pzMzhTtvsfx2pJ72CY`. No push without approval. Branch `feat/f039-class-policy`, stacked on `feat/f038-qsofa-rule`. No new external dependency.

## Decision table (qSOFA only, `severity: critical`) — the provisional policy

| T / U (of 3 criteria) | rule result | class | reason_code | reachable |
|---|---|---|---|---|
| T>=2 (any U) | true | critical | `rule_true` | critical |
| T=1, U=0 | false | watch | `partial_criteria` (team-defined) | watch |
| T=1, U>=1 | unknown | review | `could_escalate` | critical |
| T=0, U>=2 | unknown | review | `could_escalate` | critical |
| T=0, U=1 | false | review | `incomplete_for_no_alert` | watch |
| T=0, U=0 | false | no_alert | `all_criteria_clear` | no_alert |
| all unknown | unknown | review | `could_escalate` | critical |

General per-rule rules (severity S in {critical, watch}; `ul` = count of `unknown` leaves in the rule's trace; root = trace entry with id `combine`; "atLeast root" = that entry has `kind: "atLeast"` with `t,u,f,min,max`):
- result `true` -> class S, `rule_true`, reachable S.
- result `unknown` -> `review`, `could_escalate`, reachable S.
- result `false` and `ul > 0` -> `review`, `incomplete_for_no_alert`, reachable `watch` if (S is critical and atLeast root and `max >= 1`) else `no_alert`.
- result `false`, `ul == 0`, S critical, atLeast root, `t >= 1` -> `watch`, `partial_criteria`, reachable `watch`.
- otherwise (`false`, `ul == 0`) -> `no_alert`, `all_criteria_clear`, reachable `no_alert`.
Final decision: highest class by rank across rules (ties: first rule in `rules` order, which is id order); its `reason_code`. `highest_reachable_class` = max over rules by rank among `critical > watch > no_alert`. `conflict` = per-rule classes are not all equal.

## Review Focus

1. `unknown` must never become `no_alert`: property over all 27 three-valued combinations of the qSOFA conditions (Task 1 and Task 2).
2. Tampered `fired` (empty or full) must not change the decision (Task 1).
3. Fail closed: empty result, rule without severity, malformed input -> `PolicyError`, never `no_alert` (Task 1).
4. Monotonicity of `highest_reachable_class`: turning an unknown input into "met" never lowers it; into "not met" never raises it (Task 1 property test).
5. A severity edit alone must change `rule_set_version`, and an invalid severity value must be rejected by the loader (Task 2).

---

### Task 1: `classify` in the engine

**Files:**
- Create: `engine/src/policy.ts`, `engine/src/policy.test.ts`
- Modify: `engine/src/index.ts` (export `classify`, `PolicyError`, `POLICY_VERSION` and the types)

**Interfaces:**
- Consumes: `RuleSetResult`, `RuleResult`, `TraceEntry`, `Tri` from `./types.ts`; `defineRuleSet`, `evaluateRuleSet` (tests only).
- Produces (exact):

```ts
export type Severity = "critical" | "watch";
export type ClassId = "critical" | "watch" | "no_alert" | "review";
export type ReasonCode =
  | "rule_true" | "partial_criteria" | "could_escalate"
  | "incomplete_for_no_alert" | "all_criteria_clear";
export type RuleBasis = {
  rule_id: string; result: Tri; severity: Severity;
  class: ClassId; reason_code: ReasonCode; reachable: Exclude<ClassId, "review">;
  unknown_leaves: number;
  counts: { t: number; u: number; f: number; min: number; max: number } | null; // null unless atLeast root
};
export type ClassDecision = {
  class: ClassId; reason_code: ReasonCode;
  provisional: true; policy_version: string;
  highest_reachable_class: Exclude<ClassId, "review">;
  conflict: boolean; basis: RuleBasis[];
};
export const POLICY_VERSION = "policy-provisional-1";
export type PolicyErrorCode = "empty_result" | "missing_severity" | "invalid_input";
export class PolicyError extends Error { code: PolicyErrorCode; /* fixed message per code, never a value */ }
export function classify(result: RuleSetResult, severities: ReadonlyMap<string, Severity>): ClassDecision;
```

- [ ] **Step 1: Write the failing tests** in `engine/src/policy.test.ts`, building real results with `defineRuleSet` + `evaluateRuleSet` from a qSOFA-shaped synthetic rule (id `t.qsofa`, conditions `a`: `x >= 22`, `b`: `y <= 100`, `c`: `z < 15`, combine `atLeast {n:2, of:[a,b,c]}`, severities map `t.qsofa -> critical`; thresholds are synthetic mechanics, not the clinical rule). Tests by name:
  - `decision table`: one assertion block per row of the table above (inputs chosen to produce each T/U state; absent key = unknown, plus one row with a non-numeric string as invalid); assert `class`, `reason_code`, `highest_reachable_class`, `provisional === true`, `policy_version === POLICY_VERSION`.
  - `27 combinations`: each of the three inputs in {met, not met, missing}; assert `class === "no_alert"` iff no input is missing and none met; assert `class === "critical"` iff the rule result is true.
  - `reachable monotonicity`: for every one of the 27 combinations and every missing input, replacing it by "met" never lowers `highest_reachable_class` and by "not met" never raises it (rank `no_alert` < `watch` < `critical`).
  - `ignores fired`: same result object with `fired` replaced by `[]` and by all rule ids gives a deep-equal decision.
  - `max severity across rules`: two synthetic rules (one `critical`, one `watch` with a single condition) covering: critical true + watch false -> critical, `conflict: true`; watch true + critical false-complete -> watch; critical unknown + watch true -> review (rank above watch), reachable critical; both false-complete -> no_alert, `conflict: false`; basis lists rules in result order.
  - `single-leaf and non-atLeast roots`: a rule whose `combine` is a string or `all` yields `counts: null` and never `partial_criteria`.
  - `fail closed`: `rules: []` -> `PolicyError` code `empty_result`; rule id absent from `severities` -> `missing_severity`; `result` not an object / `rules` not an array / a severity value outside the two literals -> `invalid_input`. Messages are fixed strings: assert the thrown message does not contain the rule id used.
  - `no mutation`: the input result is deep-frozen before the call and the call does not throw.
  - Purity: the existing purity scan test in `engine/src/purity.test.ts` must still pass with `policy.ts` present (no I/O imports).
- [ ] **Step 2: Run to verify it fails.** `node --test engine/src/policy.test.ts`. Expected: FAIL (module `./policy.ts` missing). Report the output.
- [ ] **Step 3: Implement `classify` in `engine/src/policy.ts`** per the per-rule rules and rank above; read own properties only; validate input shape first; build `basis` in `result.rules` order; error messages from a fixed table.
- [ ] **Step 4: Export from `engine/src/index.ts`; run** `node --test engine/src/policy.test.ts` then `npm test -w engine`. Expected: all pass, existing 108 engine tests untouched.
- [ ] **Step 5: Mutation check (report, do not commit):** flip `ul > 0` to `ul >= 0`; drop the `t >= 1` condition; change the rank so `review` < `watch`; read `fired` instead of `rules[].result`; default to `no_alert` on empty. Each must turn at least one test red.
- [ ] **Step 6: Commit** `git add engine/src/policy.ts engine/src/policy.test.ts engine/src/index.ts && git commit -m "feat(engine): add provisional class policy classify"`.

### Task 2: `severity` in the rule file, in `rule_set_version`, and the real qSOFA end to end

**Files:**
- Modify: `packages/rules/src/schema.ts` (optional `severity`), `packages/rules/src/version.ts` (`RuleMeta.severity`, hash includes it when present), `packages/rules/src/load.ts` (`LoadedRuleSet.severities`), `packages/rules/src/index.ts` (export `Severity` re-use from engine), `knowledge/rules/sepsis.qsofa.v1.yaml` (add `severity: critical`)
- Create: `packages/rules/src/severity.test.ts`, `packages/rules/src/qsofa-policy.test.ts`

**Interfaces:**
- Consumes: `classify`, `Severity`, `ClassDecision` from `@decidere/engine`; `loadRuleSet`, `LoadedRuleSet`, `RuleMeta`, `checkRuleDoc`, `computeRuleSetVersion`.
- Produces: `RuleDoc.severity?: Severity`; `RuleMeta.severity?: Severity`; `LoadedRuleSet.severities: ReadonlyMap<string, Severity>` (only rules that declare it); the real rule `sepsis.qsofa.v1` classifiable via `classify(evaluateRuleSet(loaded.ruleSet, input), loaded.severities)`.

- [ ] **Step 1: Write the failing tests.**
  - `severity.test.ts`, using temp directories like `load.test.ts` (helpers are not exported: write a local copy): `accepts severity critical and watch`; `rejects other severity values with invalid_value at the key path and without echoing the value`; `severity is optional`: a v1 rule without it still loads and `severities` lacks its id; `severity-only change changes rule_set_version` (same rule, `critical` vs `watch` vs absent -> three distinct versions); `rule without severity keeps the previous canonical hash shape` (meta omits the key when absent: assert `canonicalJson(meta)` has no `severity`); `disabled rules` do not appear in `severities`.
  - `qsofa-policy.test.ts`: load the real `knowledge/rules` (same URL approach and provisional variable set as `qsofa.test.ts`); assert `severities.get("sepsis.qsofa.v1") === "critical"`; then run the clinician-review cases through `classify(evaluateRuleSet(...), severities)`. Inputs -> expected `class` (and `reason_code`): (1) RR 24, SBP 95, GCS 15 -> critical `rule_true`; (2) RR 22, SBP 100, GCS 14 -> critical; (3) RR 21, SBP 101, GCS 15 -> no_alert; (4) RR 26, SBP 120, GCS 15 -> watch `partial_criteria`; (5) RR 26, SBP missing, GCS 15 -> review `could_escalate`, reachable critical; (6) all missing -> review, never no_alert; (7) RR 18, SBP 120, GCS missing -> review `incomplete_for_no_alert`; (8) RR 28, SBP 88, GCS missing -> critical; (9) GCS non-numeric string, RR 18, SBP 120 -> same decision as case 7; (10) `provisional === true`, `policy_version === "policy-provisional-1"`; and the 27-combination check: `no_alert` only when no input missing and none met.
- [ ] **Step 2: Run to verify it fails.** `node --test packages/rules/src/severity.test.ts packages/rules/src/qsofa-policy.test.ts`. Expected: FAIL (unknown key `severity`, missing `severities`). Report the output.
- [ ] **Step 3: Implement.** In `schema.ts` accept `severity` as an optional top-level key (closed set of two literals; any other value `invalid_value` at path `severity`, no value echoed; unknown-key behavior for everything else unchanged). In `load.ts` build `severities` from active rules. In `version.ts` add `severity` to `RuleMeta` and put it into the hashed `meta` only when defined. Add `severity: critical` to `knowledge/rules/sepsis.qsofa.v1.yaml` (placement after `title`).
- [ ] **Step 4: Run** `npm test -w packages/rules` (all previous 83 tests still pass, including the existing `qsofa.test.ts` thresholds test) and `npm run typecheck`. Report counts.
- [ ] **Step 5: Mutation check (report, do not commit):** make `severity` ignored in the hash; accept any string as severity; build `severities` from disabled rules too; change the YAML severity to `watch`. Each must turn a test red.
- [ ] **Step 6: Commit** `git add packages/rules knowledge/rules/sepsis.qsofa.v1.yaml && git commit -m "feat(rules): add optional severity and wire the qSOFA class policy"`.

### Task 3: ADR-010, trackers, verification

**Files:**
- Create: `docs/adr/ADR-010-politica-de-clase-provisional.md` (format of `ADR-000-template.md`, status `propuesto`; the user accepts it)
- Modify: `docs/adr/ADR-002-reglas-como-datos-versionados.md` (one bullet in "Formato de archivo v1": optional `severity`, part of `rule_set_version`), `docs/progress/feature-list.json` (F039 `status`/`notes`; append notes to F007, F040, F047, F050, F062), `docs/progress/PROGRESS.md` (Sesión 10), `AGENTS.md` only if a line is now false

**Interfaces:** Consumes Tasks 1-2. Produces handoff notes: F040 (call `classify(result, loaded.severities)` after `evaluateRuleSet`; store `policy_version` with each interpretation; map ClassId to the response names; `PolicyError` is an `internal_error`), F047 (consumes `conflict`, `basis[].counts`, `unknown_leaves`; owns `requires_confirmation`; uses `highest_reachable_class`), F050 (runner must report separately the seeds expected `crítico` that land in `revisión clínica`; they must not count as hits, otherwise the 100% critical sensitivity metric is satisfied silently), F062 (wording: "high-risk screen", not diagnosis; show Singer's caveat that a negative qSOFA must not delay workup), F007 (closes only when a clinician approves).

- [ ] **Step 1: Write ADR-010** (Spanish): decision table, rank, reason codes, `policy_version`, fail-closed rules, why `severity` is additive in v1 (not `format_version` 2), alternatives (separate policy file; constants in code; `vigilancia` as a second duplicated rule — rejected because thresholds would exist twice), consequences (qSOFA is a single-rule policy; `vigilancia` = qSOFA 1 with complete inputs is the main alert-fatigue driver and the first thing to argue with the clinician; the `could_escalate -> review` choice versus `critical` + confirmation flag is open).
- [ ] **Step 2: PROGRESS Sesión 10** with the open clinical questions for the policy (none decided): (a) `crítico` for qSOFA >= 2 without an infection proxy (SSC 2021 Rec 2 warns about low sensitivity, not false alarms); (b) `vigilancia` = qSOFA 1 with all inputs known; (c) `could_escalate` as `revisión clínica` versus `crítico` with the confirmation flag; (d) review ranks above vigilancia; (e) minimum completeness for `sin alerta` = all three inputs known; (f) Seymour imputed normal values for missing data while this policy treats them as unknown, so published performance figures do not transfer; (g) the metric loophole above.
- [ ] **Step 3: Update `feature-list.json`.** F039 `passing` only if verified, described as "provisional policy implemented, NOT clinically approved, outside the metrics". Edit only `status`/`notes`; keep prior notes. Validate JSON.
- [ ] **Step 4: Run `npm run verify` and `npm run scan:phi`.** Expected: exit 0, 0 hits; report per-package counts.
- [ ] **Step 5: Commit** `docs(adr): add ADR-010 provisional class policy and record F039`.

## Approval items (needs the user before implementation)

1. **The provisional policy table** above (team-defined; `crítico` at qSOFA >= 2, `vigilancia` at qSOFA = 1 with complete inputs, `revisión clínica` for unknown/incomplete). Advised by the clinical-informatics expert; a clinician must still decide the open questions in Task 3.
2. **Contract change in the rule file:** additive optional `severity` key in format v1 and `severity` in `RuleMeta` (changes `rule_set_version`); `knowledge/rules/sepsis.qsofa.v1.yaml` gains `severity: critical`. Chosen over `format_version: 2` because that would force editing an existing test.
3. **New ADR-010** (status `propuesto`) and a one-bullet addition to ADR-002.
4. **ASCII class identifiers** (`critical`/`watch`/`no_alert`/`review`) in code; the response names are decided in F040.
5. **Branch** `feat/f039-class-policy` stacked on `feat/f038-qsofa-rule` (PR #10 not yet merged).
