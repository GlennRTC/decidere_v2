import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SeedCase, SeedClass } from "../seeds/build.ts";
import type { Observed } from "./runner/metrics.ts";
import {
  assessStability,
  STABILITY_MAX_DELTA,
  splitSeeds,
  summarizeTau,
  type TauRow,
} from "./runner/sweep.ts";

const mk = (id: string, expected_class: SeedClass = "watch"): SeedCase => ({
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

test("splitSeeds is deterministic, lossless, disjoint and order-preserving", () => {
  const cases = Array.from({ length: 60 }, (_, i) => mk(`syn-${i}`));
  const a = splitSeeds(cases);
  assert.deepEqual(splitSeeds(cases), a);
  assert.equal(a.calibration.length + a.held_out.length, cases.length);
  const ids = new Set(a.held_out.map((c) => c.id));
  assert.ok(a.calibration.every((c) => !ids.has(c.id)));
  const order = (xs: SeedCase[]) => xs.map((c) => cases.indexOf(c));
  for (const part of [a.calibration, a.held_out]) {
    const o = order(part);
    assert.deepEqual(
      o,
      [...o].sort((x, y) => x - y),
    );
  }
  assert.ok(a.held_out.length > 0 && a.calibration.length > 0);
});

test("splitSeeds holds out 8 to 20 of the real seeds", () => {
  const file = JSON.parse(
    readFileSync(new URL("../seeds/cases.json", import.meta.url), "utf8"),
  ) as { cases: SeedCase[] };
  const { held_out } = splitSeeds(file.cases);
  // measured 10 held out of 46 when written; the range tolerates seed edits
  assert.equal(file.cases.length, 46);
  assert.ok(
    held_out.length >= 8 && held_out.length <= 20,
    `${held_out.length}`,
  );
});

test("summarizeTau counts routed, criticals and uncovered", () => {
  const cases = [
    mk("a", "watch"),
    mk("b", "no_alert"),
    mk("c", "critical"),
    mk("d", "critical"),
    mk("e", "critical"),
    mk("f", "watch"),
    mk("g", "critical"),
  ];
  const observed = new Map<string, Observed>([
    ["a", obs("revisión clínica", { routed_from: "vigilancia" })],
    ["b", obs("sin alerta")],
    ["c", obs("crítico", { requires_confirmation: true })],
    ["d", obs("revisión clínica", { routed_from: "crítico" })],
    ["e", obs("vigilancia")],
    ["f", obs(null)],
  ]);
  const row = summarizeTau(cases, observed, 0.6);
  assert.equal(row.tau, 0.6);
  assert.equal(row.total, 7);
  assert.equal(row.routed, 2);
  assert.deepEqual(row.routed_ids, ["a", "d"]);
  assert.equal(row.routed_share, 2 / 7);
  assert.deepEqual(row.uncovered, ["f", "g"]);
  assert.deepEqual(row.criticals, {
    expected: 4,
    detected: 1,
    in_review: 1,
    missed: 2,
    requires_confirmation: 1,
  });
  assert.equal(summarizeTau([], new Map(), 0.5).routed_share, 0);
});

const row = (
  share: number,
  over: Partial<TauRow["criticals"]> = {},
): TauRow => ({
  tau: 0,
  total: 10,
  routed: share * 10,
  routed_share: share,
  routed_ids: [],
  criticals: {
    expected: 2,
    detected: 2,
    in_review: 0,
    missed: 0,
    requires_confirmation: 0,
    ...over,
  },
  uncovered: [],
});

test("STABILITY_MAX_DELTA is 0.1", () =>
  assert.equal(STABILITY_MAX_DELTA, 0.1));

test("assessStability: safe and small delta is stable", () => {
  const rows = new Map([
    [0.5, row(0.2)],
    [0.6, row(0.25)],
    [0.7, row(0.3)],
  ]);
  const s = assessStability(rows, 0.6, 0.1);
  assert.equal(s.safe, true);
  assert.equal(s.stable, true);
  assert.ok(Math.abs((s.max_delta ?? 0) - 0.05) < 1e-9);
  assert.deepEqual(
    s.neighbours.map((n) => n.tau),
    [0.5, 0.7],
  );
});

test("assessStability: unsafe neighbour is not stable (safety reason)", () => {
  const rows = new Map([
    [0.5, row(0.2, { in_review: 1, detected: 1 })],
    [0.6, row(0.2)],
  ]);
  const s = assessStability(rows, 0.6, 0.1);
  assert.equal(s.safe, false);
  assert.equal(s.stable, false);
  assert.match(s.reason, /crítico/);
});

test("assessStability: delta above max is not stable (delta reason)", () => {
  const rows = new Map([
    [0.6, row(0.2)],
    [0.7, row(0.5)],
  ]);
  const s = assessStability(rows, 0.6, 0.1);
  assert.equal(s.safe, true);
  assert.equal(s.stable, false);
  assert.match(s.reason, /variación/);
});

test("assessStability: edges give null neighbours without crashing", () => {
  const low = assessStability(
    new Map([
      [0.1, row(0.2)],
      [0.2, row(0.2)],
    ]),
    0.1,
    0.1,
  );
  assert.equal(low.neighbours[0]?.tau, 0);
  assert.equal(low.neighbours[0]?.row, null);
  assert.equal(low.stable, true);
  const high = assessStability(
    new Map([
      [0.9, row(0.2)],
      [1, row(0.2)],
    ]),
    1,
    0.1,
  );
  assert.equal(high.neighbours[1]?.tau, 1.1);
  assert.equal(high.neighbours[1]?.row, null);
  assert.equal(high.stable, true);
});

test("assessStability: no neighbour rows gives null delta and not stable", () => {
  const s = assessStability(new Map([[0.6, row(0.2)]]), 0.6, 0.1);
  assert.equal(s.max_delta, null);
  assert.equal(s.stable, false);
  assert.ok(s.reason.length > 0);
});

test("summarizeTau ignores requires_confirmation on non-critical cases", () => {
  const observed = new Map([
    ["a", obs("vigilancia", { requires_confirmation: true })],
  ]);
  const r = summarizeTau([mk("a", "watch")], observed, 0.5);
  assert.equal(r.criticals.requires_confirmation, 0);
});

test("assessStability: a neighbour with a missed critical is unsafe", () => {
  const rows = new Map([
    [0.5, row(0.2, { missed: 1, detected: 1 })],
    [0.6, row(0.2)],
  ]);
  const s = assessStability(rows, 0.6, 0.1);
  assert.equal(s.safe, false);
  assert.equal(s.stable, false);
});

test("assessStability: float noise at the boundary does not flip stability", () => {
  const at = assessStability(
    new Map([
      [0.4, row(0.4)],
      [0.5, row(0.3)],
    ]),
    0.4,
    0.1,
  );
  assert.equal(at.stable, true);
  const below = assessStability(
    new Map([
      [0.4, row(0.5)],
      [0.5, row(0.4)],
    ]),
    0.4,
    0.1,
  );
  assert.equal(below.stable, true);
  const above = assessStability(
    new Map([
      [0.4, row(0.42)],
      [0.5, row(0.3)],
    ]),
    0.4,
    0.1,
  );
  assert.equal(above.stable, false);
  assert.match(above.reason, /variación/);
});

test("assessStability: a missing candidate row has its own reason", () => {
  const s = assessStability(new Map([[0.5, row(0.2)]]), 0.6, 0.1);
  assert.equal(s.stable, false);
  assert.match(s.reason, /candidato/);
  assert.doesNotMatch(s.reason, /crítico/);
});
