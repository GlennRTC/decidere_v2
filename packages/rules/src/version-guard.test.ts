import assert from "node:assert/strict";
import { test } from "node:test";
import { defineRuleSet } from "@decidere/engine";
import { RuleLoadError } from "./errors.ts";
import { computeRuleSetVersion, type RuleMeta } from "./version.ts";

const rule = (id: string) => ({
  id,
  conditions: [
    { id: "c1", label: "L", variable: "v1", op: ">=", value: 7, unit: "u" },
  ],
  combine: "c1",
});
const metaOf = (id: string): RuleMeta => ({
  id,
  title: "T",
  citation: { source: "S", version: "V", section: "X" },
  clinical_approval: {
    status: "pending",
    approver: null,
    guideline_version: null,
  },
});
const rs = defineRuleSet([rule("r1"), rule("r2")], {
  variables: new Set(["v1"]),
});

function code(meta: RuleMeta[]): string {
  try {
    computeRuleSetVersion(rs, meta);
  } catch (err) {
    assert.ok(err instanceof RuleLoadError);
    return err.code;
  }
  return "accepted";
}

test("meta must align with the rule set", () => {
  assert.equal(code([metaOf("r1")]), "invalid_options");
  assert.equal(
    code([metaOf("r1"), metaOf("r2"), metaOf("r3")]),
    "invalid_options",
  );
  assert.equal(code([metaOf("r2"), metaOf("r1")]), "invalid_options");
  assert.equal(code([metaOf("r1"), metaOf("r2")]), "accepted");
});
