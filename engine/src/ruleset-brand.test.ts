import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuleSet } from "./index.ts";
import { defineRuleSet, evaluateRuleSet, RuleError } from "./index.ts";

const raw = [
  {
    id: "r",
    conditions: [
      { id: "a", label: "l", variable: "v1", op: ">=", value: 1, unit: "u" },
    ],
    combine: "a",
  },
];
const refused = (e: unknown) =>
  e instanceof RuleError && e.code === "invalid_rule_set" && e.path === "rules";

describe("evaluateRuleSet only accepts sets from defineRuleSet", () => {
  it("rejects an inline literal cast to RuleSet", () => {
    const fake = [
      { id: "r", conditions: [], combine: { all: [] } },
    ] as unknown as RuleSet;
    assert.throws(() => evaluateRuleSet(fake, {}), refused);
  });
  it("evaluates a defined set", () => {
    assert.deepEqual(evaluateRuleSet(defineRuleSet(raw), { v1: 1 }).fired, [
      "r",
    ]);
  });
  it("rejects a structuredClone of a defined set", () => {
    const clone = structuredClone(defineRuleSet(raw)) as RuleSet;
    assert.throws(() => evaluateRuleSet(clone, { v1: 1 }), refused);
  });
});
