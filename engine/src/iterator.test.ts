import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineRuleSet, evaluateRuleSet, RuleError } from "./index.ts";

const cond = {
  id: "a",
  label: "l",
  variable: "v1",
  op: ">=",
  value: 1,
  unit: "u",
};
const withIterator = <T extends unknown[]>(arr: T, items: unknown[]): T => {
  Object.defineProperty(arr, Symbol.iterator, {
    value: () => items[Symbol.iterator](),
  });
  return arr;
};
const outcomes = [
  ["empty", () => []],
  ["extra items", () => [cond, cond]],
] as const;

describe("own Symbol.iterator on raw arrays is ignored", () => {
  for (const [name, items] of outcomes) {
    it(`combinator children (${name})`, () => {
      const children = withIterator(["a"], items());
      const rule = { id: "r", conditions: [cond], combine: { all: children } };
      const rs = defineRuleSet([rule]);
      // Index view: all[a]; no data -> unknown, never a definite true.
      assert.deepEqual(evaluateRuleSet(rs, {}).fired, []);
      assert.equal(evaluateRuleSet(rs, {}).rules[0]?.result, "unknown");
    });
    it(`conditions array (${name})`, () => {
      const conditions = withIterator([cond], items());
      const rs = defineRuleSet([{ id: "r", conditions, combine: "a" }]);
      assert.equal(evaluateRuleSet(rs, {}).rules[0]?.trace.length, 1);
    });
    it(`rules array (${name})`, () => {
      const rules = withIterator(
        [{ id: "r", conditions: [cond], combine: "a" }],
        items(),
      );
      assert.equal(defineRuleSet(rules).length, 1);
    });
  }
  it("an empty iterator on an empty children list still fails", () => {
    const rule = {
      id: "r",
      conditions: [cond],
      combine: { all: withIterator([], [cond]) },
    };
    assert.throws(() => defineRuleSet([rule]), RuleError);
  });
});
