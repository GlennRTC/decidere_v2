# F050 Seeds Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`npm run seeds:run`) that starts the API, POSTs every seed from `seeds/cases.json` to `/v1/messages`, and prints a report (coverage, critical sensitivity, conformity with published criteria, certainty divergences), exiting non-zero when a critical is not detected.

**Architecture:** A pure core (`tests/runner/metrics.ts`: observe responses, classify each seed, compute the report) and a pure renderer (`tests/runner/render.ts`), both unit-tested with fabricated responses. A thin CLI (`tests/runner/run.ts`) spawns the real server (or targets `SEED_API_URL`), sends `buildMessage(case)` for each seed, and wires the core to stdout and the exit code. An e2e test runs the CLI against the real engine. No new dependencies (Node `fetch`, `node:test`).

**Tech Stack:** TypeScript on Node >= 22.18 (type stripping, same as the repo), `node --test`, Biome.

**Spec:** `docs/progress/feature-list.json` F050 (absorbs F020 and F021), `AGENTS.md` ("Métricas de éxito", "Qué NO hacer"), `docs/adr/ADR-010-politica-de-clase-provisional.md`, `docs/adr/ADR-015-enrutamiento-por-certeza.md`, `docs/adr/ADR-016-seeds-sinteticos-provisionales.md`, `seeds/README.md`.

**Branch:** `feat/f050-seeds-runner`, stacked on `feat/f018-seeds` (PR #23 not merged yet; rebase on `main` after its squash merge).

## Global Constraints

- Code, identifiers, comments, commits: English. Report text printed to the user, ADR/README/PROGRESS: Spanish (product convention).
- Required label, verbatim: `conformidad con criterios publicados; validación clínica pendiente`. Never "concordancia" or "validación clínica" as the metric name.
- The report text must never contain the word `IA` or `precisión` (test it with `/\bIA\b|precisi[oó]n/i`).
- Report must say that fewer than 100 seeds is not a statistical figure and that 99% equals zero discrepancies at that size; must say it is not compared with PhysioNet/CinC 2019; must not present kappa or "zero discrepancies" as evidence while labelers are placeholders (kappa line: `no disponible (etiquetadores placeholder)`).
- Do not change any seed label or any existing test. If a seed diverges, report it; never relabel.
- Never log or print payloads, only seed ids (synthetic), classes, counts, versions and tau.
- Secrets by variable name only: `SEED_API_KEY` is read from the environment and never printed.
- No new dependency. Never evade the PHI hook (use synthetic values; if it blocks, rephrase).
- Final check: `npm run verify` and `npm run scan:phi` both exit 0.

## Exit codes (contract of the CLI)

| Code | Meaning |
|---|---|
| 0 | every seed covered, every expected `critical` returned `crítico`, no unexplained discrepancy |
| 1 | an expected `critical` returned another class (including `revisión clínica`), or coverage < 100%, or an unexplained discrepancy |
| 2 | the runner could not run (server did not start or is unreachable, seeds file unreadable) |

## Review Focus

1. A seed answered with a non-200 status (e.g. 422) counts as not covered, is listed by id, exit 1.
2. An expected `critical` that comes back `vigilancia` or `sin alerta` is a miss: exit 1.
3. An expected `critical` that falls in `revisión clínica` is NOT a hit: reported apart, exit 1 (ADR-010).
4. Server fails to start or the URL is unreachable: exit 2 with a fixed message, no hang (startup and per-request timeouts).
5. A run with zero expected criticals prints sensitivity `n/a`, never `NaN` or `100%`.

## File Structure

- Create `tests/runner/metrics.ts` — pure: `observe`, `evaluateSeeds`.
- Create `tests/runner/render.ts` — pure: `renderReport`.
- Create `tests/runner/run.ts` — CLI (I/O only).
- Create `tests/runner-metrics.test.ts`, `tests/runner-render.test.ts`, `tests/runner.e2e.test.ts` — flat, like the other tests.
- Modify `package.json` (root script `seeds:run`), `AGENTS.md` (command table), `seeds/README.md`, `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json` (F050 `status`/`notes` only).

### Task 1: Metrics core

**Files:**
- Create: `tests/runner/metrics.ts`
- Test: `tests/runner-metrics.test.ts`

**Interfaces:**
- Consumes: `SeedCase`, `SeedClass` from `seeds/build.ts`.
- Produces:
  - `type Observed = { status: number; class: string | null; routed_from: string | null; reason_code: string | null; requires_confirmation: boolean | null }`
  - `type Verdict = "match" | "certainty_divergence" | "discrepancy" | "not_covered"`
  - `type CriticalStatus = "detected" | "in_review" | "missed"`
  - `type Outcome = { id: string; category: string; expected: SeedClass; observed: Observed; verdict: Verdict; critical?: CriticalStatus }`
  - `type Report = { total: number; outcomes: Outcome[]; coverage: { covered: number; total: number }; sensitivity: { detected: number; expected: number } | null; conformity: { matches: number; total: number }; divergences: Outcome[]; discrepancies: Outcome[]; not_covered: Outcome[]; criticals_in_review: Outcome[]; criticals_missed: Outcome[]; failed: boolean }`
  - `observe(status: number, body: unknown): Observed` — never throws; anything that is not a 200 with `results[0].class` a string gives `class: null`.
  - `evaluateSeeds(cases: SeedCase[], observed: ReadonlyMap<string, Observed>): Report` — a case missing from the map is `not_covered`. `failed` is true when any of `not_covered`, `criticals_in_review`, `criticals_missed`, `discrepancies` is non-empty.

- [ ] **Step 1: Write the failing tests** in `tests/runner-metrics.test.ts`, with fabricated `Observed` values (synthetic ids). Cases:
  - all matching → `failed === false`, `coverage` 3/3, `conformity` 3/3.
  - expected `critical` observed `crítico` → `critical: "detected"`; observed `revisión clínica` → `in_review`, listed in `criticals_in_review`, `sensitivity.detected` does not count it, `failed`; observed `sin alerta` → `missed`, `failed`.
  - expected `watch` observed `revisión clínica` with `routed_from: "vigilancia"` and `reason_code: "low_certainty"` → `certainty_divergence`, in `divergences`, NOT in `discrepancies`, `failed === false`; same with `routed_from: "sin alerta"` against expected `watch` → `discrepancy` (routed_from must equal the expected class name).
  - expected `no_alert` observed `crítico` → `discrepancy`, `failed`.
  - expected `review` observed `revisión clínica` → `match`.
  - status 422 → `not_covered`, `coverage` 2/3, `failed`; case absent from the map → `not_covered`.
  - zero expected criticals → `sensitivity === null`.
  - `observe(200, {results:[{class:"crítico", routed_from:null, reason_code:"rule_true", requires_confirmation:true}]})` gives those fields; `observe(200, "x")`, `observe(500, {})`, `observe(200, {results:[]})` give `class: null` without throwing.
- [ ] **Step 2:** Run `node --test tests/runner-metrics.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `tests/runner/metrics.ts`. Keep a local `CLASS_NAMES: Record<SeedClass, string>` (`critical→crítico`, `watch→vigilancia`, `no_alert→sin alerta`, `review→revisión clínica`). Verdict order: no class → `not_covered`; class equals expected name → `match`; expected `watch`/`no_alert` and class is `revisión clínica` and `routed_from` equals the expected name and `reason_code === "low_certainty"` → `certainty_divergence`; else `discrepancy`. `critical` status only for expected `critical`.
- [ ] **Step 4:** Run the test file → PASS.
- [ ] **Step 5:** `npm run lint && npm run typecheck`, then commit `feat(tests): add the seed metrics core (F050)`.

### Task 2: Report renderer

**Files:**
- Create: `tests/runner/render.ts`
- Test: `tests/runner-render.test.ts`

**Interfaces:**
- Consumes: `Report` from Task 1.
- Produces:
  - `type ReportHeader = { tau: string; policy_version: string; rule_set_version: string; rule_set_approval: string; certainty_version: string; labeling: string; labelers: string; clinical_approval: string; seed_count: number }` (all strings, already formatted by the CLI; unknown values are the literal `desconocido`).
  - `renderReport(report: Report, header: ReportHeader): string` — multi-line Spanish text.

- [ ] **Step 1: Write the failing tests** with a fabricated passing report and a fabricated failing report (one in-review critical, one divergence, one discrepancy):
  - output contains, verbatim: `conformidad con criterios publicados; validación clínica pendiente`, `τ = <header.tau>`, `PROVISIONAL`, `placeholder`, `menos de 100`, `PhysioNet`, `kappa: no disponible (etiquetadores placeholder)`.
  - output never matches `/\bIA\b|precisi[oó]n|concordancia/i` and never contains the string `validación clínica` except inside the required label.
  - sections in this order: header, `Cobertura`, `Sensibilidad de crítico`, `Conformidad`, `Divergencias por certeza` (ids listed), `Críticos esperados en revisión clínica` (ids listed, text states they do NOT count as hits), `Discrepancias sin explicar`, `Resultado`.
  - zero expected criticals → `Sensibilidad de crítico: n/a`.
  - failing report ends with `Resultado: FALLA` and passing report with `Resultado: OK`; the conformity line never says "cero discrepancias" as evidence (it may state the count).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `renderReport(report, header)` as plain string building, no template engine.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** lint + typecheck, commit `feat(tests): render the seed report (F050)`.

### Task 3: CLI, e2e test, docs

**Files:**
- Create: `tests/runner/run.ts`, `tests/runner.e2e.test.ts`
- Modify: `package.json`, `AGENTS.md`, `seeds/README.md`, `docs/progress/PROGRESS.md`, `docs/progress/feature-list.json`

**Interfaces:**
- Consumes: `buildMessage`, `SeedFile` from `seeds/build.ts`; `observe`, `evaluateSeeds` (Task 1); `renderReport`, `ReportHeader` (Task 2).
- Produces: CLI `node tests/runner/run.ts [seedsFile]` (default `seeds/cases.json`) with env `SEED_API_URL` (if set, no server is spawned and tau prints `desconocido (servidor externo)`), `SEED_API_KEY` (if set, sent as header `x-api-key`; the API does not check it until F052, header name provisional), `CERTAINTY_TAU` (passed to the spawned server and printed; default `0.5`). Root script `"seeds:run": "node tests/runner/run.ts"`.

- [ ] **Step 1: Write the failing e2e test** `tests/runner.e2e.test.ts` (spawn the CLI with `spawnSync`/`spawn`, free port not needed: the CLI picks its own port by `PORT=0`-style probe like `post-messages.e2e.test.ts`):
  - default seeds: exit 0; stdout contains the required label, `τ = 0.5`, `9` divergences listed by the 9 ids in `seeds/README.md`, `Resultado: OK`; no output line contains `x-api-key` or a seed payload value.
  - `CERTAINTY_TAU=0.6`: exit 0 (criticals still `crítico`), stdout shows `τ = 0.6` and 23 divergences (ADR-015 structural jump); asserts the figure only as a regression baseline, in a comment.
  - a temp seeds file (written under `os.tmpdir()`, synthetic) with one case labeled `critical` whose vitals are normal (RR 14, SBP 120, GCS 15): exit 1, stdout lists it under discrepancies/missed and `Resultado: FALLA`.
  - (the "expected critical in review" path is not reachable with the real engine, since a critical is never routed to review; it is covered by Task 1 and Task 2 unit tests only.)
  - `SEED_API_URL=http://127.0.0.1:1` (nothing listens): exit 2, fixed message, finishes in < 10 s.
  - nonexistent seeds file: exit 2.
- [ ] **Step 2:** Run `node --test tests/runner.e2e.test.ts` → FAIL.
- [ ] **Step 3: Implement `tests/runner/run.ts`.** Flow: read and `JSON.parse` the seeds file; spawn `apps/api/src/server.ts` with `PORT`, `CERTAINTY_TAU`, `ALLOWED_SOURCES=sim-1`, default `RULES_DIR`/`MAPPINGS_DIR` stripped from the inherited env (same hygiene as `post-messages.e2e.test.ts`), poll `/health` up to 10 s, POST sequentially with `AbortSignal.timeout(5000)`, kill the child in `finally`. Build `ReportHeader` from the seeds file (`labeling`, `labelers`, `clinical_approval`) and from the first 200 response (`policy.version`, `rule_set.version`/`approval`, `results[0].certainty.version`). Print `renderReport`, set the exit code from `report.failed` (1) or a runner error (2). The server's stdout/stderr are not forwarded.
- [ ] **Step 4:** Add the root script `seeds:run`; run `npm run seeds:run` by hand and paste the first 25 lines of the report into the implementer's report file.
- [ ] **Step 5:** Run the e2e test → PASS, then `npm run verify` and `npm run scan:phi` → both exit 0.
- [ ] **Step 6: Docs (Spanish).** `AGENTS.md` command block gets `npm run seeds:run  # ejecuta los seeds contra la API y reporta métricas (provisional)`. `seeds/README.md` gets a short "Cómo correr el runner" section (command, env vars, exit codes) and drops the "F050 debe" wording that is now done. `PROGRESS.md` gets a session entry; `feature-list.json`: F050 `status` to `passing` only after Step 5 evidence, `notes` appended with the exit-code contract and the `x-api-key` provisional header; F020 and F021 stay `ABSORBIDA` (their "modo continuo" criterion is out of scope, say so in the F050 notes).
- [ ] **Step 7:** Commit code and docs as two commits: `feat(tests): run the seeds against the API and report metrics (F050)` and `docs(progress): mark F050 passing`.

## Decisions to confirm (defaults chosen, change on request)

1. An unexplained discrepancy (non-critical, not a certainty divergence) also exits 1. Baseline today is 0, so any new one is a regression signal; AC only requires failing on criticals.
2. Coverage below 100% exits 1 (AGENTS.md: "ningún caso se pierde").
3. `SEED_API_KEY` is sent as `x-api-key`; F052 may rename it.
4. "Modo continuo" (F021) is not built (YAGNI, not in F050's criteria).
