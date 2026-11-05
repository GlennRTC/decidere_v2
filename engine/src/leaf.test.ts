import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Input, Op, Tri } from "./index.ts";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";

const leafRule = (op: Op = ">=", value = 10, variable = "v1") =>
  defineRuleSet([
    {
      id: "r1",
      conditions: [
        { id: "a", label: "label a", variable, op, value, unit: "u" },
      ],
      combine: "a",
    },
  ]);
const run = (ruleSet: ReturnType<typeof leafRule>, input: Input) => {
  const out = evaluateRuleSet(ruleSet, input);
  const rule = out.rules[0];
  assert.ok(rule);
  return rule;
};

describe("exact boundary", () => {
  // inputs: 9, 10, 11 (integers) and 9.9, 10, 10.1 (decimals)
  const table: Record<Op, [Tri, Tri, Tri]> = {
    ">": [false, false, true],
    ">=": [false, true, true],
    "<": [true, false, false],
    "<=": [true, true, false],
    "==": [false, true, false],
  };
  for (const op of Object.keys(table) as Op[]) {
    it(`op ${op}`, () => {
      const rs = leafRule(op);
      const expected = table[op];
      for (const inputs of [
        [9, 10, 11],
        [9.9, 10, 10.1],
      ]) {
        inputs.forEach((v1, i) => {
          assert.equal(run(rs, { v1 }).result, expected[i], `${op} ${v1}`);
        });
      }
    });
  }
});

describe("0 is a value", () => {
  it("0 and -0 are values", () => {
    const rs = leafRule("<", 1);
    assert.equal(run(rs, { v1: 0 }).result, true);
    assert.equal(run(rs, { v1: -0 }).result, true);
    assert.equal(run(leafRule("==", 0), { v1: -0 }).result, true);
  });
});

describe("unknown with reason", () => {
  const rs = leafRule();
  const leafOf = (input: Input) => {
    const entry = run(rs, input).trace[0];
    assert.ok(entry && entry.kind === "leaf");
    return entry;
  };
  const cases: [string, Input, "missing" | "invalid"][] = [
    ["absent", {}, "missing"],
    ["undefined", { v1: undefined }, "missing"],
    ["null", { v1: null }, "missing"],
    ["empty string", { v1: "" }, "invalid"],
    ["string", { v1: "abc" }, "invalid"],
    ["numeric string", { v1: "3" }, "invalid"],
    ["true", { v1: true }, "invalid"],
    ["NaN", { v1: Number.NaN }, "invalid"],
    ["Infinity", { v1: Number.POSITIVE_INFINITY }, "invalid"],
    ["-Infinity", { v1: Number.NEGATIVE_INFINITY }, "invalid"],
    ["array", { v1: [] }, "invalid"],
    ["object", { v1: {} }, "invalid"],
  ];
  for (const [name, input, reason] of cases) {
    it(name, () => {
      const r = run(rs, input);
      const leaf = leafOf(input);
      assert.equal(r.result, "unknown");
      assert.equal(leaf.result, "unknown");
      assert.equal(leaf.reason, reason);
      assert.equal(leaf.observed, null);
      assert.ok(!JSON.stringify(r).includes("abc"));
    });
  }
});

describe("trace", () => {
  it("leaf carries id, label, op, threshold, unit, observed, result", () => {
    const r = run(leafRule(">=", 10), { v1: 12 });
    assert.deepEqual(r.trace, [
      {
        id: "a",
        kind: "leaf",
        result: true,
        observed: 12,
        op: ">=",
        threshold: 10,
        unit: "u",
        label: "label a",
      },
    ]);
    assert.equal(r.rule_id, "r1");
  });

  it("every condition is traced in declaration order; fired lists true rules", () => {
    const c = (id: string, variable: string, value: number) => ({
      id,
      label: id,
      variable,
      op: ">",
      value,
      unit: "u",
    });
    const rs = defineRuleSet([
      {
        id: "r1",
        conditions: [c("b", "v2", 1), c("a", "v1", 1)],
        combine: "a",
      },
      { id: "r2", conditions: [c("a", "v1", 100)], combine: "a" },
    ]);
    const out = evaluateRuleSet(rs, { v1: 5 });
    assert.deepEqual(
      out.rules[0]?.trace.map((t) => t.id),
      ["b", "a"],
    );
    assert.equal(out.rules[0]?.result, true);
    assert.equal(out.rules[1]?.result, false);
    assert.deepEqual(out.fired, ["r1"]);
  });
});

describe("inherited and special names are ignored", () => {
  it("prototype value is not read", () => {
    const input = Object.create({ v1: 99 }) as Input;
    assert.equal(run(leafRule(), input).result, "unknown");
    assert.equal(
      (run(leafRule(), input).trace[0] as { reason?: string }).reason,
      "missing",
    );
  });
  it("prototype constructor is not read", () => {
    const input = Object.create({ constructor: 5 }) as Input;
    assert.equal(
      run(leafRule(">=", 1, "constructor"), input).result,
      "unknown",
    );
  });
  for (const variable of ["__proto__", "constructor", "toString"]) {
    it(`variable ${variable}`, () => {
      const r = run(leafRule(">=", 1, variable), {});
      const leaf = r.trace[0];
      assert.ok(leaf && leaf.kind === "leaf");
      assert.equal(r.result, "unknown");
      assert.equal(leaf.reason, "missing");
    });
  }
});

describe("input is not mutated", () => {
  it("deep-frozen input passes and is unchanged", () => {
    const input = Object.freeze({ v1: 12, v2: Object.freeze({ x: 1 }) });
    const snapshot = JSON.stringify(input);
    run(leafRule(), input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});
