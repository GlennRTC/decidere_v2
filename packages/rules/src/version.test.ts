import assert from "node:assert/strict";
import { test } from "node:test";
import { defineRuleSet } from "@decidere/engine";
import type { RuleMeta } from "./version.ts";
import { canonicalJson, computeRuleSetVersion } from "./version.ts";

test("canonicalJson sorts keys recursively, keeps array order, no whitespace", () => {
  assert.equal(
    canonicalJson({ b: 2, a: { z: [3, 1], y: "x" } }),
    '{"a":{"y":"x","z":[3,1]},"b":2}',
  );
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

type Spec = { rule: any; meta: RuleMeta };
const base = (id: string): Spec => ({
  rule: {
    id,
    conditions: [
      { id: "c1", label: "L1", variable: "v1", op: ">=", value: 7, unit: "u1" },
      { id: "c2", label: "L2", variable: "v2", op: "<", value: 3, unit: "u2" },
    ],
    combine: { all: ["c1", "c2"] },
  },
  meta: {
    id,
    title: "T",
    citation: { source: "S", version: "V", section: "X" },
    clinical_approval: {
      status: "approved",
      approver: "A",
      guideline_version: "G",
    },
  },
});
const vars = new Set(["v1", "v2", "v3"]);
function version(specs: Spec[]): string {
  const rs = defineRuleSet(
    specs.map((s) => structuredClone(s.rule)),
    { variables: vars },
  );
  return computeRuleSetVersion(
    rs,
    specs.map((s) => s.meta),
  );
}
function changed(mutate: (s: Spec) => void): void {
  const a = base("r1");
  const b = base("r1");
  mutate(b);
  assert.notEqual(version([a]), version([b]));
}

test("version format and stability", () => {
  const v = version([base("r1")]);
  assert.match(v, /^rs-[0-9a-f]{16}$/);
  assert.equal(v, version([base("r1")]));
});
test("condition value changes version", () =>
  changed((s) => {
    s.rule.conditions[0].value = 8;
  }));
test("op changes version", () =>
  changed((s) => {
    s.rule.conditions[0].op = ">";
  }));
test("variable changes version", () =>
  changed((s) => {
    s.rule.conditions[0].variable = "v3";
  }));
test("unit changes version", () =>
  changed((s) => {
    s.rule.conditions[0].unit = "u9";
  }));
test("label changes version", () =>
  changed((s) => {
    s.rule.conditions[0].label = "L9";
  }));
test("combine tree changes version", () =>
  changed((s) => {
    s.rule.combine = { any: ["c1", "c2"] };
  }));
test("title changes version", () =>
  changed((s) => {
    s.meta = { ...s.meta, title: "T2" };
  }));
for (const f of ["source", "version", "section"] as const)
  test(`citation.${f} changes version`, () =>
    changed((s) => {
      s.meta = { ...s.meta, citation: { ...s.meta.citation, [f]: "Z" } };
    }));
test("approval status changes version", () =>
  changed((s) => {
    s.meta = {
      ...s.meta,
      clinical_approval: {
        status: "pending",
        approver: "A",
        guideline_version: "G",
      },
    };
  }));
for (const f of ["approver", "guideline_version"] as const)
  test(`clinical_approval.${f} changes version`, () =>
    changed((s) => {
      s.meta = {
        ...s.meta,
        clinical_approval: { ...s.meta.clinical_approval, [f]: "Z" },
      };
    }));
test("adding a rule changes version", () => {
  assert.notEqual(version([base("r1")]), version([base("r1"), base("r2")]));
});
test("input order does not change version", () => {
  assert.equal(
    version([base("r1"), base("r2")]),
    version([base("r2"), base("r1")]),
  );
});
