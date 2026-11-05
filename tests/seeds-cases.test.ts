import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateMessage } from "@decidere/schema";
import {
  buildMessage,
  type SeedCase,
  type SeedClass,
  type SeedFile,
  type SeedVital,
} from "../seeds/build.ts";

const file: SeedFile = JSON.parse(
  readFileSync(new URL("../seeds/cases.json", import.meta.url), "utf8"),
);
const { cases } = file;
const categories = [
  "clear_positive",
  "clear_negative",
  "boundary",
  "missing_data",
  "contradictory",
] as const;

const currentOf = (c: SeedCase) => {
  const current = c.instances.filter((i) => i.kind === "current");
  assert.equal(current.length, 1, `${c.id}: exactly one current instance`);
  return current[0];
};

// Independent qSOFA oracle (Singer 2016, Box 4; ADR-010 table). No engine import.
function oracle(vitals: SeedVital[]): SeedClass {
  const latest = new Map<string, SeedVital>();
  for (const v of vitals) {
    if (v.value === null) continue;
    const prev = latest.get(v.code);
    if (!prev || (v.t_offset_min ?? 0) >= (prev.t_offset_min ?? 0)) {
      latest.set(v.code, v);
    }
  }
  let t = 0;
  let u = 0;
  const criteria: [string, (x: number) => boolean][] = [
    ["RR", (x) => x >= 22],
    ["SBP", (x) => x <= 100],
    ["GCS", (x) => x < 15],
  ];
  for (const [code, isTrue] of criteria) {
    const v = latest.get(code);
    if (!v || v.value === null) {
      u += 1;
      continue;
    }
    const x =
      code === "SBP" && v.unit === "kPa"
        ? v.value * 7.500637554192106
        : v.value;
    if (isTrue(x)) t += 1;
  }
  if (t >= 2) return "critical";
  if (u === 0) return t === 1 ? "watch" : "no_alert";
  return "review";
}

test("file declares provisional labeling and pending clinical approval", () => {
  assert.equal(file.labeling, "provisional");
  assert.ok(file.labelers.a.startsWith("placeholder-"));
  assert.ok(file.labelers.b.startsWith("placeholder-"));
  assert.equal(file.labelers.adjudicator, null);
  assert.equal(file.clinical_approval.status, "pending");
  assert.equal(file.clinical_approval.approver, null);
});

test("composition: at least 36 cases and at least 5 per category", () => {
  assert.ok(cases.length >= 36);
  for (const cat of categories) {
    assert.ok(cases.filter((c) => c.category === cat).length >= 5, cat);
  }
});

test("all four classes appear", () => {
  const seen = new Set(cases.map((c) => c.expected_class));
  for (const k of ["critical", "watch", "no_alert", "review"]) {
    assert.ok(seen.has(k as SeedClass), k);
  }
});

test("at least 3 boundary cases per class that occurs there", () => {
  const counts = new Map<string, number>();
  for (const c of cases.filter((x) => x.category === "boundary")) {
    counts.set(c.expected_class, (counts.get(c.expected_class) ?? 0) + 1);
  }
  assert.ok(counts.size > 0);
  for (const [cls, n] of counts) assert.ok(n >= 3, `${cls}: ${n}`);
});

test("case ids are unique, kebab-case and at most 40 characters", () => {
  const ids = cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
    assert.ok(id.length <= 40, id);
  }
});

test("every case builds a valid message", () => {
  for (const c of cases) {
    assert.ok(validateMessage(buildMessage(c)).ok, c.id);
  }
});

test("opaque ids are unique across all cases", () => {
  const ids: string[] = [];
  for (const c of cases) {
    const m = buildMessage(c);
    ids.push(m.message_id, ...m.instances.map((i) => i.instance_id));
  }
  assert.equal(new Set(ids).size, ids.length);
});

test("every case has exactly one current instance, t_offset_min <= 0 integers, and a non-empty criterion that cites Singer 2016 and the ADR-010 table", () => {
  for (const c of cases) {
    currentOf(c);
    for (const i of c.instances) {
      for (const v of i.vitals) {
        const t = v.t_offset_min ?? 0;
        assert.ok(Number.isInteger(t) && t <= 0, `${c.id}: t_offset_min`);
      }
    }
    assert.ok(c.criterion.length > 0, c.id);
    assert.ok(c.criterion.includes("Singer 2016"), c.id);
    assert.ok(c.criterion.includes("ADR-010"), c.id);
  }
});

const currentValues = (code: string) =>
  new Set(
    cases.flatMap((c) =>
      currentOf(c)
        .vitals.filter((v) => v.code === code)
        .map((v) => v.value),
    ),
  );

test("boundary values are covered on both sides", () => {
  for (const [code, values] of [
    ["RR", [21, 22]],
    ["SBP", [100, 101]],
    ["GCS", [14, 15]],
  ] as const) {
    for (const x of values) {
      assert.ok(currentValues(code).has(x), `${code} ${x}`);
    }
  }
});

test("a null value and an absent variable both occur", () => {
  const current = cases.map(currentOf);
  assert.ok(current.some((i) => i.vitals.some((v) => v.value === null)));
  assert.ok(
    current.some((i) =>
      ["RR", "SBP", "GCS"].some((k) => !i.vitals.some((v) => v.code === k)),
    ),
  );
});

test("a case with a historical instance exists and its label follows the current instance only", () => {
  const withHistory = cases.filter((c) =>
    c.instances.some((i) => i.kind === "historical"),
  );
  assert.ok(withHistory.length >= 2);
  for (const c of withHistory) {
    assert.equal(c.expected_class, oracle(currentOf(c).vitals), c.id);
  }
});

test("expected_class matches the independent qSOFA oracle for every case", () => {
  for (const c of cases) {
    assert.equal(
      c.expected_class,
      oracle(currentOf(c).vitals),
      `label mismatch in case ${c.id}`,
    );
  }
});
