import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Node, Tri } from "./index.ts";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";

// Leaves a,b,c read v1,v2,v3 with ">= 1": input 1 -> true, 0 -> false, absent -> unknown.
const conditions = ["a", "b", "c"].map((id, i) => ({
  id,
  label: `label ${id}`,
  variable: `v${i + 1}`,
  op: ">=" as const,
  value: 1,
  unit: "u",
}));
const VALUES: Tri[] = [true, false, "unknown"];
const toInput = (vals: Tri[]) => {
  const input: Record<string, number> = {};
  vals.forEach((v, i) => {
    if (v !== "unknown") input[`v${i + 1}`] = v ? 1 : 0;
  });
  return input;
};
const run = (combine: Node, vals: Tri[]) => {
  const rs = defineRuleSet([{ id: "r1", conditions, combine }]);
  const rule = evaluateRuleSet(rs, toInput(vals)).rules[0];
  assert.ok(rule);
  return rule;
};
const T = true;
const F = false;
const U = "unknown";

describe("all / any truth tables over a,b", () => {
  // order of pairs: rows a in [T,F,U], columns b in [T,F,U]
  const all: Tri[][] = [
    [T, F, U],
    [F, F, F],
    [U, F, U],
  ];
  const any: Tri[][] = [
    [T, T, T],
    [T, F, U],
    [T, U, U],
  ];
  VALUES.forEach((a, i) => {
    VALUES.forEach((b, j) => {
      it(`a=${a} b=${b}`, () => {
        assert.equal(run({ all: ["a", "b"] }, [a, b, T]).result, all[i]?.[j]);
        assert.equal(run({ any: ["a", "b"] }, [a, b, T]).result, any[i]?.[j]);
      });
    });
  });
});

describe("not", () => {
  it("true -> false, false -> true, unknown -> unknown", () => {
    assert.equal(run({ not: "a" }, [T, T, T]).result, false);
    assert.equal(run({ not: "a" }, [F, T, T]).result, true);
    assert.equal(run({ not: "a" }, [U, T, T]).result, "unknown");
  });
});

describe("atLeast 2 of 3", () => {
  const node: Node = { atLeast: { n: 2, of: ["a", "b", "c"] } };
  const cases: [Tri[], Tri][] = [
    [[T, T, U], true],
    [[T, F, F], false],
    [[T, U, F], "unknown"],
    [[F, F, U], false],
    [[U, U, U], "unknown"],
    [[T, T, T], true],
  ];
  for (const [vals, expected] of cases) {
    it(`${vals.join(",")} -> ${expected}`, () => {
      assert.equal(run(node, vals).result, expected);
    });
  }
  it("entry carries t,u,f,min,max", () => {
    const entry = run(node, [T, U, F]).trace.at(-1);
    assert.deepEqual(entry, {
      id: "combine",
      kind: "atLeast",
      result: "unknown",
      t: 1,
      u: 1,
      f: 1,
      min: 1,
      max: 2,
    });
  });
});

describe("trace", () => {
  it("lists leaves first, then combinators in post-order with positional ids", () => {
    const combine: Node = { all: [{ any: ["a", { not: "b" }] }, "c"] };
    const ids = run(combine, [T, T, T]).trace.map((t) => [t.id, t.kind]);
    assert.deepEqual(ids, [
      ["a", "leaf"],
      ["b", "leaf"],
      ["c", "leaf"],
      ["combine.0.1", "not"],
      ["combine.0", "any"],
      ["combine", "all"],
    ]);
  });
  it("atLeast children are path.i and `of` is skipped", () => {
    const combine: Node = {
      atLeast: { n: 1, of: [{ not: "a" }, "b"] },
    };
    const ids = run(combine, [T, T, T]).trace.map((t) => t.id);
    assert.deepEqual(ids, ["a", "b", "c", "combine.0", "combine"]);
  });
  it("does not short-circuit: every leaf is traced when the first sibling decides", () => {
    const rule = run({ all: ["a", "b", "c"] }, [F, T, T]);
    assert.equal(rule.result, false);
    assert.deepEqual(
      rule.trace.filter((t) => t.kind === "leaf").map((t) => t.id),
      ["a", "b", "c"],
    );
    const any = run({ any: ["a", "b", "c"] }, [T, U, F]);
    assert.equal(any.result, true);
    assert.equal(any.trace.find((t) => t.id === "b")?.result, "unknown");
  });
  it("a lone condition id has no combinator entry", () => {
    assert.equal(run("a", [T, T, T]).trace.length, 3);
  });
  it("a rule fires only on true, never on unknown", () => {
    const rs = defineRuleSet([
      { id: "r1", conditions, combine: { all: ["a", "b"] } },
    ]);
    assert.deepEqual(evaluateRuleSet(rs, { v1: 1 }).fired, []);
    assert.deepEqual(evaluateRuleSet(rs, { v1: 1, v2: 1 }).fired, ["r1"]);
  });
});
