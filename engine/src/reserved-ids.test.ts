import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineRuleSet, RuleError } from "./index.ts";

const ruleWith = (id: string) => ({
  id: "r1",
  conditions: [
    { id, label: "l", variable: "v1", op: ">", value: 1, unit: "u" },
  ],
  combine: id,
});

describe("condition ids reserved for combinator trace entries", () => {
  for (const id of ["combine", "combine.0", "combine.1.2"]) {
    it(`rejects ${id}`, () => {
      assert.throws(
        () => defineRuleSet([ruleWith(id)]),
        (e: unknown) => {
          assert.ok(e instanceof RuleError);
          assert.equal(e.code, "invalid_condition");
          assert.equal(e.path, "rules.0.conditions.0");
          assert.ok(!e.message.includes(id) && !e.path.includes(id));
          return true;
        },
      );
    });
  }
  for (const id of ["combiner", "combined", "combine_0"]) {
    it(`accepts ${id}`, () => {
      assert.equal(defineRuleSet([ruleWith(id)]).length, 1);
    });
  }
});
