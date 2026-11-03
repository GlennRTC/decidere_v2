# MVP decomposition: design

**Date:** 2026-11-03 · **Status:** approved by the user in chat (decisions below); not yet reviewed by a clinician.

## Intent

Break the Decidere MVP (sepsis/infection alerts in the ED, public demo with synthetic data; first deployment and reference market: Colombia, but the design does not depend on any one jurisdiction) into small, verifiable features ordered by dependency, starting with a vertical slice of the central flow: `POST /v1/messages` → mapper → rules engine → certainty → response. WebApp, rule-evaluation viewer and analytics come after.

## Decisions (user)

- TS/Fastify on Vercel; Supabase Postgres + Auth; rules as YAML + json-logic **subject to a spike (F033)**; plan B is YAML with a minimal custom comparator.
- Polling every 2-3 s (ADR-005). Three roles: superadministrator, expert, user.
- First slice: qSOFA, then SIRS. SOFA and NEWS2 are post-MVP (they extend the data contract).
- Thresholds: the developer transcribes published thresholds with citation; a clinician reviews and approves later (`clinical_approval: pending` until then).
- Certainty = min(completeness, margin, conflict), provisional; a critical case is never downgraded, it gets a "requires confirmation" flag. τ and margin bands are calibrated later with the clinician; target conformity is zero discrepancies.
- First feature: monorepo scaffold + single verification command (F030).
- Mapping edit is read-only in the MVP; editing moves to v1.1.
- A critical case can be marked seen/attended (persisted). If the clinician's criterion differs, a checkbox enables decision and justification fields. The class does not change.
- Labelers/arbiter are placeholders; recruiting is the user's parallel task. The demo stays "in development" (banner).
- Free text from the sender stays out of the MVP (F029, blocked until a new ADR).

## Non-goals

Everything in AGENTS.md "Fuera del alcance". Also: no rule editor in the app, no LLM, no PII/PHI.

## Anti-goals

- A UI or report that suggests AI, clinical validation, or "precision".
- A critical case lost to missing data or low certainty.
- Rules in use without the pending-approval status visible.

## Order (feature ids in `docs/progress/feature-list.json`)

| # | Feature |
|---|---|
| 1-3 | F030 monorepo + verify · F031 CI (+ secret scanning, PHI check) · F032 Fastify `/health` |
| 4 | F033 json-logic spike (parallel with 1) |
| 5 | F002 ADR-001..004 (+ADR-006) before merging F035, F005, F040 |
| 6 | F034 Vercel skeleton with `/health` and region decision |
| 7-8 | F035 reduced strict schema · F036 errors that never echo values or unknown field names |
| 9-12 | F005 evaluator + trace · F037 rule schema/loader/`rule_set_version`/`clinical_approval` · F038 qSOFA · F039 provisional class policy |
| 13-15 | F040 POST happy path (**tracer bullet**: a `curl` with a seed returns class and trace) · F041 invalid message · F011 logging without PHI + canary test |
| 16-17 | F042 canonical catalog (LOINC/UCUM verified) · F043 mapper + `mapping_version` |
| 18-22 | F044 schema for SIRS · F045 SIRS · F046 infection proxy (provisional) · F047 certainty · F048 review routing (provisional τ) |
| 23-26 | F018 seeds · F050 runner + simulator + metrics · F051 kappa script · F049 τ calibration |
| 27-28 | F052 API key + size limit · F053 CORS/headers/secrets |
| 29-35 | F054 Supabase schema · F055 persistence + tenant isolation test · F056 GET by class · F057 JWT · F058 3-role matrix · F059 audit log · F060 user management |
| 36-42 | F022 web scaffold + login + banner · F023/F015 critical dashboard · F061 seen/attended + differing-criterion note · F062 trace detail · F024 viewer · F016 review queue · F063 read-only mapping list |
| 43-47 | F026 demo reset + hardening · F064 distributed rate limit · F025 analytics · F065 intended-use doc · F027 public deployment |
| Post | F066 SOFA · F067 NEWS2 · F028 regulatory classification · F029 free text · F017 mapping edit (v1.1) |

## Role matrix (base for F058)

- **User:** dashboard, case detail, viewer, aggregate analytics, mark seen/attended, annotate differing criterion. *(Assumption to confirm: the user role can annotate.)*
- **Expert:** all of the above + review queue and resolving cases, active rules and `rule_set_version`, mapping list (read-only).
- **Superadministrator:** all of the above + users/roles + demo reset.
- No role edits rules from the app (changes go by PR) and none sees patient data (none is stored).

## Constraints from the reviews

- Audit log (F059) exists before the review queue (F016) and annotations (F061).
- Public deployment (F027) requires F052, F053, F026, F065, and approved rules or an explicit banner.
- Annotation text (F061) is bounded free text: needs ADR-006 and a compliance review **before** implementation; never logged; stored with tenant scope; survives demo reset in the audit log only.
- Persisted trace holds only the values that support the rule. `case_id` is random, never derived from an identifier.
- API runs with service role (bypasses RLS): every query carries `tenant_id`; role comes from `app_metadata`.

## Open (clinician or lawyer)

- Operational definition of "suspected infection"; whether qSOFA ≥ 2 alone is critical; τ and margin bands; PaCO2/bands in SIRS; excluded populations.
- Data residency and international transfer under the legal framework of each deployment (first one: Colombia, Law 1581); email of staff as personal data; whether a demo with clinical alerts is already SaMD.
- Whether to downgrade is out: resolved. Remaining: what "confirm" means for the "requires confirmation" flag and who may act on it.

## Left to the builder

Library choices within the stack (subject to the user's approval of each dependency), UI layout, naming within the project conventions.

## Mine (not the user's)

Splitting and numbering; merging simulator and runner; moving the intended-use document before the public deployment; `limit`+`since` instead of an opaque cursor.
