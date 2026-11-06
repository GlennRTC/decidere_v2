import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeedCase, SeedClass } from "../seeds/build.ts";
import { evaluateSeeds, type Observed, observe } from "./runner/metrics.ts";

const mk = (id: string, expected_class: SeedClass): SeedCase => ({
  id,
  category: "boundary",
  expected_class,
  criterion: "synthetic",
  instances: [],
});
const obs = (cls: string | null, over: Partial<Observed> = {}): Observed => ({
  status: cls === null ? 422 : 200,
  class: cls,
  routed_from: null,
  reason_code: null,
  requires_confirmation: null,
  ...over,
});
const run = (pairs: [SeedCase, Observed | undefined][]) =>
  evaluateSeeds(
    pairs.map(([c]) => c),
    new Map(
      pairs.flatMap(([c, o]) => (o ? [[c.id, o] as [string, Observed]] : [])),
    ),
  );

test("all matching", () => {
  const r = run([
    [mk("s1", "critical"), obs("crítico")],
    [mk("s2", "watch"), obs("vigilancia")],
    [mk("s3", "no_alert"), obs("sin alerta")],
  ]);
  assert.equal(r.failed, false);
  assert.deepEqual(r.coverage, { covered: 3, total: 3 });
  assert.deepEqual(r.conformity, { matches: 3, total: 3 });
  assert.deepEqual(r.sensitivity, { detected: 1, expected: 1 });
});

test("critical in review and missed fail the run", () => {
  const a = run([[mk("s1", "critical"), obs("revisión clínica")]]);
  assert.equal(a.outcomes[0]?.critical, "in_review");
  assert.equal(a.criticals_in_review.length, 1);
  assert.deepEqual(a.sensitivity, { detected: 0, expected: 1 });
  assert.equal(a.failed, true);
  const b = run([[mk("s1", "critical"), obs("sin alerta")]]);
  assert.equal(b.outcomes[0]?.critical, "missed");
  assert.equal(b.criticals_missed.length, 1);
  assert.equal(b.failed, true);
  const c = run([[mk("s1", "critical"), obs("crítico")]]);
  assert.equal(c.outcomes[0]?.critical, "detected");
});

test("certainty divergence is not a discrepancy", () => {
  const low = { routed_from: "vigilancia", reason_code: "low_certainty" };
  const r = run([[mk("s1", "watch"), obs("revisión clínica", low)]]);
  assert.equal(r.outcomes[0]?.verdict, "certainty_divergence");
  assert.equal(r.divergences.length, 1);
  assert.equal(r.discrepancies.length, 0);
  assert.equal(r.failed, false);
  const bad = run([
    [
      mk("s1", "watch"),
      obs("revisión clínica", { ...low, routed_from: "sin alerta" }),
    ],
  ]);
  assert.equal(bad.outcomes[0]?.verdict, "discrepancy");
});

test("wrong class is a discrepancy; review matches review", () => {
  const r = run([[mk("s1", "no_alert"), obs("crítico")]]);
  assert.equal(r.outcomes[0]?.verdict, "discrepancy");
  assert.equal(r.failed, true);
  const m = run([[mk("s1", "review"), obs("revisión clínica")]]);
  assert.equal(m.outcomes[0]?.verdict, "match");
});

test("422 and absent cases are not covered", () => {
  const r = run([
    [mk("s1", "watch"), obs("vigilancia")],
    [mk("s2", "watch"), obs("vigilancia")],
    [mk("s3", "watch"), obs(null)],
  ]);
  assert.deepEqual(r.coverage, { covered: 2, total: 3 });
  assert.equal(r.failed, true);
  const absent = run([[mk("s1", "watch"), undefined]]);
  assert.equal(absent.outcomes[0]?.verdict, "not_covered");
  assert.equal(absent.not_covered.length, 1);
});

test("no expected criticals gives null sensitivity", () => {
  assert.equal(run([[mk("s1", "watch"), obs("vigilancia")]]).sensitivity, null);
});

test("observe is total", () => {
  assert.deepEqual(
    observe(200, {
      results: [
        {
          class: "crítico",
          routed_from: null,
          reason_code: "rule_true",
          requires_confirmation: true,
        },
      ],
    }),
    {
      status: 200,
      class: "crítico",
      routed_from: null,
      reason_code: "rule_true",
      requires_confirmation: true,
    },
  );
  assert.equal(observe(200, "x").class, null);
  assert.equal(observe(500, {}).class, null);
  assert.equal(observe(200, { results: [] }).class, null);
});
