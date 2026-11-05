import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleLoadError } from "./errors.ts";
import { checkRuleDoc } from "./schema.ts";

const cond = (id: string) => ({
  id,
  label: "L",
  variable: "v1",
  op: ">=",
  value: 1,
  unit: "u",
});
function doc(ids: string[], combine: unknown) {
  return {
    format_version: 1,
    id: "r1",
    title: "T",
    citation: { source: "S", version: "V", section: "X" },
    clinical_approval: {
      status: "pending",
      approver: null,
      guideline_version: null,
    },
    conditions: ids.map(cond),
    combine,
  };
}
function fails(d: unknown): RuleLoadError {
  try {
    checkRuleDoc(d);
  } catch (err) {
    assert.ok(err instanceof RuleLoadError, String(err));
    return err;
  }
  return assert.fail("expected a throw");
}

test("valid single-use trees are accepted", () => {
  checkRuleDoc(doc(["c1"], "c1"));
  checkRuleDoc(doc(["c1", "c2"], { all: ["c1", "c2"] }));
  checkRuleDoc(
    doc(["c1", "c2", "c3", "c4"], {
      any: [
        { all: ["c1", "c2"] },
        { not: "c3" },
        { atLeast: { n: 1, of: ["c4"] } },
      ],
    }),
  );
});

test("an unreferenced condition is invalid_value at its conditions path", () => {
  const err = fails(doc(["c1", "secretId"], "c1"));
  assert.equal(err.code, "invalid_value");
  assert.equal(err.path, "conditions.1");
  assert.ok(
    !JSON.stringify([err.message, err.path, err.detail]).includes("secretId"),
  );
});

test("a repeated reference is invalid_value at the second reference", () => {
  const e1 = fails(
    doc(["canaryId"], { any: ["canaryId", { not: "canaryId" }] }),
  );
  assert.equal(e1.code, "invalid_value");
  assert.equal(e1.path, "combine.any.1.not");
  const e2 = fails(doc(["c1"], { all: ["c1", "c1"] }));
  assert.equal(e2.code, "invalid_value");
  assert.equal(e2.path, "combine.all.1");
  const e3 = fails(doc(["c1"], { atLeast: { n: 1, of: ["c1", "c1"] } }));
  assert.equal(e3.path, "combine.atLeast.of.1");
  assert.ok(!JSON.stringify([e1.message, e1.path]).includes("canaryId"));
});

test("a reference to a missing id is left to the engine", () => {
  checkRuleDoc(doc(["c1"], { all: ["c1", "ghost"] }));
});
