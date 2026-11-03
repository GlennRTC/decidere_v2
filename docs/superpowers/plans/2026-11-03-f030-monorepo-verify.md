# F030 Monorepo and Single Verification Command: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript npm-workspaces monorepo with one command, `npm run verify` (lint + typecheck + tests + build), that exits 0 on a clean repo and non-zero when any step fails, registered in `AGENTS.md`.

**Architecture:** Root `package.json` declares the workspaces from `AGENTS.md`. Tests run on Node's built-in `node:test` (types stripped natively, no runner dependency). Biome lints and formats, `tsc --noEmit` typechecks. The only workspace that exists after this plan is `tests/`, which holds a structure test guarding the layout; `apps/*`, `packages/*` and `engine` are declared but created by later features (F032, F035, F005).

**Tech Stack:** Node (type stripping), npm workspaces, TypeScript, Biome. Fastify, Vite/React and json-logic are NOT part of this plan.

**Spec:** `docs/superpowers/specs/2026-11-03-mvp-decomposition-design.md` (order 1), feature F030 in `docs/progress/feature-list.json`, `AGENTS.md` ("Definición de terminado", "Comandos de proyecto").

## Global Constraints

- Backend is TypeScript/Node with Fastify, hosted on Vercel (decided; Fastify itself arrives in F032).
- No dependency is installed without the user's explicit approval (see "Proposed dependencies" below). Tasks 2 and 3 are blocked until then.
- The single verification command must be the one CI runs (F031 wraps it; do not duplicate the steps in CI).
- No invented commands: `AGENTS.md` "Comandos de proyecto" is only updated with commands that were run and passed.
- Never commit to `main`; work on `chore/init-harness` or a `feat/<slug>` branch. One logical change per commit, Conventional Commits, summary max 72 chars, imperative, no trailing period.
- Never edit or delete a test to make it pass. If a test looks wrong, stop and report.
- No secrets in the repo; `.env` is git-ignored. No real patient data anywhere.
- Code, identifiers, comments and docs in English.
- `feature-list.json`: F030 becomes `passing` only after the Task 5 evidence is captured by the implementer.

## Proposed dependencies (approval required, nothing installed yet)

Facts below come from the npm registry on 2026-11-03 (`npm view`). Only license, version, last-publish date and repository were checked; open issues, maintainer count and security advisories were NOT checked.

| Package | Role | License | Version / last publish | Why |
|---|---|---|---|---|
| `typescript` (dev) | Typecheck, later builds | Apache-2.0 | 7.0.2 / 2026-11-03, `microsoft/TypeScript` | Required by the stack. Version 7 is a new major: Task 2 verifies `tsc -p tsconfig.json --noEmit` works before relying on it. |
| `@types/node` (dev) | Node typings | MIT | 26.6.6 / 2026-10-28, DefinitelyTyped | Typechecks `node:test`, `node:fs`, `node:child_process`. Its major must match the Node baseline chosen below. |
| `@biomejs/biome` (dev) | Lint + format | MIT OR Apache-2.0 | 2.6.4 / 2026-10-28, `biomejs/biome` | One package replaces ESLint + typescript-eslint + @eslint/js and a formatter. |

Considered and not proposed: `vitest` (MIT, 5.1.0) because `node:test` covers F030; add it when a feature needs mocking or coverage. `eslint` + `typescript-eslint` (MIT) because they are three packages and heavier config for the same gate.

## Decisions needed from the user before Task 2

1. Approve or change the three dependencies above.
2. Node baseline: `engines.node` is set to `>=22.18` in this plan. I did NOT verify that Vercel's runtime supports a version with native type stripping, nor the exact Node release that enabled it. Task 1 verifies stripping locally (Node v26.3.0 here); confirm the Vercel-supported versions before F034.
3. Optional: allow `Bash(npm run verify*)` in `.claude/settings.json` (today only `npm run test*`, `lint*` and `build*` are allowed, so `verify` would prompt each time). This is a permissions change, so it needs your approval.

## Review Focus

1. `verify` swallowing a failure (steps chained with `;` instead of `&&`): the gate would pass when lint fails. Task 4 asserts the exact chain and demonstrates a failing lint turns `verify` red.
2. A vacuous test run (zero test files still exits 0): Task 1 makes the structure test the guard and Task 4 asserts `test` runs through the workspaces.
3. `node_modules`, `dist` or `.env` getting committed: `.gitignore` is asserted in Task 1.
4. `scripts/init.sh` breaking the moment `package.json` exists but `apps/api` does not (it would try `npm run dev -w apps/api`): Task 5 adds a guard and a test.
5. Undeclared/misspelled workspace globs silently installing nothing: Task 1 asserts the exact `workspaces` array and Task 1 Step 4 shows `npm ls --workspaces` output.

---

### Task 1: Root package, workspace layout and structure test

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tests/package.json`
- Create: `tests/structure.test.ts`

**Interfaces:**
- Produces: root package `decidere-mvp` (private); workspace `@decidere/tests` whose `test` script is `node --test`; `tests/structure.test.ts` is extended by Tasks 4 and 5 (they append tests, never edit existing assertions).

- [ ] **Step 1: Write the failing test** in `tests/structure.test.ts` using `node:test` and `node:assert/strict`. Tests, with exact assertions:
  - `root declares the agreed workspaces`: `pkg.workspaces` deep-equals `["apps/*", "packages/*", "engine", "tests"]`.
  - `root is private and pins the node engine`: `pkg.private === true` and `pkg.engines.node === ">=22.18"`.
  - `gitignore excludes node_modules, dist and .env`: `.gitignore` contains the lines `node_modules/`, `dist/`, `.env` (and not `.env.example`).
  - `tests workspace has a test script`: `tests/package.json` `scripts.test === "node --test"`.
  Read files via `new URL("../package.json", import.meta.url)`.
- [ ] **Step 2: Run `node --test tests/structure.test.ts`**. Expected: FAIL (ENOENT on `package.json`). This also proves native type stripping works on this Node; if it errors on `.ts`, stop and report.
- [ ] **Step 3: Create** root `package.json` (`name: "decidere-mvp"`, `private: true`, `type: "module"`, `engines.node: ">=22.18"`, `workspaces` as above, no scripts yet), `tests/package.json` (`name: "@decidere/tests"`, `private: true`, `type: "module"`, `scripts.test: "node --test"`), and `.gitignore` (`node_modules/`, `dist/`, `.env`, `*.log`).
- [ ] **Step 4: Verify.** Run `node --test tests/structure.test.ts` (Expected: 4 passing) and `npm ls --workspaces` (Expected: lists `@decidere/tests`; no error for the not-yet-existing `apps/*`, `packages/*`, `engine`. If npm errors on missing globs, report and drop them from this task, adding each when its feature creates it).
- [ ] **Step 5: Commit** `chore(repo): add npm workspaces layout and structure test`.

### Task 2: Typecheck with TypeScript (blocked on dependency approval)

**Files:**
- Create: `tsconfig.base.json`, `tsconfig.json`
- Modify: `package.json` (devDependencies, `typecheck` script)
- Modify: `tests/structure.test.ts` (append one test)

**Interfaces:**
- Consumes: workspace layout from Task 1.
- Produces: root script `typecheck` = `tsc -p tsconfig.json --noEmit`. `tsconfig.json` extends `tsconfig.base.json` (strict, `module`/`moduleResolution` `NodeNext`, `target` `ES2023`, `allowImportingTsExtensions`, `noEmit`) and `include`s `tests/**/*.ts`.

- [ ] **Step 1: Append failing test** `root defines typecheck`: `pkg.scripts.typecheck === "tsc -p tsconfig.json --noEmit"`.
- [ ] **Step 2: Run `node --test tests/structure.test.ts`**. Expected: FAIL on that test only.
- [ ] **Step 3: After approval,** run `npm install --save-dev typescript @types/node` (pin the `@types/node` major to the Node baseline), add the two tsconfig files and the script.
- [ ] **Step 4: Verify.** `npm run typecheck` Expected: exit 0, no output. Then temporarily add `const x: number = "a";` to a scratch file under `tests/`, run again, Expected: non-zero exit with a `TS2322` error; remove the scratch file. If TypeScript 7 rejects `-p`/`--noEmit`, report; do not fall back to another version without asking.
- [ ] **Step 5: Commit** `build(repo): add TypeScript typecheck`.

### Task 3: Lint and format with Biome (blocked on dependency approval)

**Files:**
- Create: `biome.json`
- Modify: `package.json` (devDependency, `lint` script)
- Modify: `tests/structure.test.ts` (append one test)

**Interfaces:**
- Produces: root script `lint` = `biome check .`. `biome.json` ignores `node_modules`, `dist`, `docs`, `.claude`.

- [ ] **Step 1: Append failing test** `root defines lint`: `pkg.scripts.lint === "biome check ."`.
- [ ] **Step 2: Run `node --test tests/structure.test.ts`**. Expected: FAIL on that test only.
- [ ] **Step 3: After approval,** run `npm install --save-dev --save-exact @biomejs/biome`, run `npx biome init` is NOT used; write `biome.json` by hand with the ignores above and recommended rules. Fix reported formatting on existing files with `npx biome check --write .`.
- [ ] **Step 4: Verify.** `npm run lint` Expected: exit 0. Add a scratch file `tests/bad.ts` containing an unused variable, run again, Expected: non-zero exit naming the rule; delete the scratch file.
- [ ] **Step 5: Commit** `build(repo): add Biome lint and format`.

### Task 4: The single verification command

**Files:**
- Modify: `package.json` (scripts `test`, `build`, `verify`)
- Modify: `tests/structure.test.ts` (append tests)

**Interfaces:**
- Consumes: `lint` (Task 3), `typecheck` (Task 2).
- Produces: `npm test` = `npm run test --workspaces --if-present`; `npm run build` = `npm run build --workspaces --if-present && npm run typecheck`; `npm run verify` = `npm run lint && npm run typecheck && npm test && npm run build`. F031 (CI) runs exactly `npm run verify`.

- [ ] **Step 1: Append failing tests:** `verify chains lint, typecheck, test and build with &&` (exact string above, no `;`, no `||`); `test runs through the workspaces` (`pkg.scripts.test` includes `--workspaces`).
- [ ] **Step 2: Run `node --test tests/structure.test.ts`**. Expected: FAIL on those two.
- [ ] **Step 3: Add the three scripts** exactly as in Interfaces.
- [ ] **Step 4: Verify with evidence.** `npm run verify; echo "exit=$?"` Expected: exit=0 and the test summary shows all structure tests passing. Then add the scratch `tests/bad.ts` from Task 3, run `npm run verify; echo "exit=$?"` Expected: exit non-zero and no `test` output after the lint failure (proves the chain stops). Remove the scratch file and rerun, Expected exit=0.
- [ ] **Step 5: Commit** `build(repo): add single verify command`.

### Task 5: Make init.sh safe, register the command, update the trackers

**Files:**
- Modify: `scripts/init.sh` (guard before `npm install`)
- Modify: `tests/structure.test.ts` (append one test)
- Modify: `AGENTS.md` ("Comandos de proyecto" code block)
- Modify: `docs/progress/PROGRESS.md` (append entry)
- Modify: `docs/progress/feature-list.json` (F030 status/notes only)

**Interfaces:**
- Consumes: `npm run verify` (Task 4).

- [ ] **Step 1: Append failing test** `init.sh exits 0 and says so when apps/api is not scaffolded`: skipped (`{ skip: existsSync(apps/api) }`) once F032 creates `apps/api`; otherwise spawns `scripts/init.sh` and asserts status 0 and stdout containing `apps/api`.
- [ ] **Step 2: Run `node --test tests/structure.test.ts`**. Expected: FAIL (today the script runs `npm install` and then `npm run dev -w apps/api`, which fails).
- [ ] **Step 3: In `scripts/init.sh`,** right after the existing `package.json` check, exit 0 with a message naming `apps/api` and feature F032 when `apps/api/package.json` is missing.
- [ ] **Step 4: Verify.** `node --test tests/structure.test.ts` Expected: all passing; `./scripts/init.sh; echo "exit=$?"` Expected: message and exit=0; `npm run verify; echo "exit=$?"` Expected: exit=0. Paste these outputs into the PROGRESS entry.
- [ ] **Step 5: Register in `AGENTS.md`** replacing the placeholder block under "Comandos de proyecto" with the commands that were just run: `npm test`, `npm run lint`, `npm run build`, `npm run verify`; remove the sentence saying no code exists yet. Do not list any command that was not run.
- [ ] **Step 6: Update trackers.** Append a PROGRESS.md entry (what was done and why, the verification outputs, pending: F031 CI, F032 API skeleton). Set F030 `status` to `passing` and add a note with the commit hash, only if Step 4 evidence was captured.
- [ ] **Step 7: Commit** `chore(repo): register verify command and guard init script`.

---

## Self-review

- **Spec coverage:** F030 criteria are covered: single verify command exit 0 (Task 4), AGENTS.md commands (Task 5), dependencies approved first (Tasks 2 and 3 blocked). CI, `/health` and the API are F031/F032 and excluded.
- **Step scan:** each step names its file, command and expected output; no bodies are written for config files beyond the values the spec pins.
- **Type/name consistency:** script names `lint`, `typecheck`, `test`, `build`, `verify` and the workspace names `decidere-mvp`, `@decidere/tests` are used identically across tasks.
- **Review Focus:** each of the five items has a test or a demonstrated failing run in a named task.
- **Proportion:** the plan is longer than the spec's one-line F030 entry because it carries the dependency proposal and decisions the user asked for; task bodies stay at signatures, assertions and commands.
- **Known unverified items:** Vercel's supported Node versions, the Node release that introduced native type stripping, TypeScript 7 CLI compatibility, and dependency maintenance beyond the last-publish date.
