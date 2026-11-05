import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";

const conditions = ["a", "b", "c"].map((id, i) => ({
  id,
  label: id,
  variable: `v${i + 1}`,
  op: ">=" as const,
  value: 1,
  unit: "u",
}));
const trace = (combine: unknown, input: Record<string, number>) =>
  evaluateRuleSet(
    defineRuleSet([{ id: "r", conditions, combine }]),
    input,
  ).rules[0]?.trace.slice(3);

describe("combinators evaluate every child (no short-circuit)", () => {
  it("all: a false first child does not hide later entries", () => {
    // not a = false (a=1), not b = false (b=1)
    assert.deepEqual(
      trace({ all: [{ not: "a" }, { not: "b" }] }, { v1: 1, v2: 1 }),
      [
        { id: "combine.0", kind: "not", result: false },
        { id: "combine.1", kind: "not", result: false },
        { id: "combine", kind: "all", result: false },
      ],
    );
  });
  it("atLeast: counts include children after the threshold is reached", () => {
    // a=T, not b=T (b=0), c=T -> t=3 although n=1 is met by the first child
    assert.deepEqual(
      trace(
        { atLeast: { n: 1, of: ["a", { not: "b" }, "c"] } },
        { v1: 1, v2: 0, v3: 1 },
      ),
      [
        { id: "combine.1", kind: "not", result: true },
        {
          id: "combine",
          kind: "atLeast",
          result: true,
          t: 3,
          u: 0,
          f: 0,
          min: 3,
          max: 3,
        },
      ],
    );
  });
});
