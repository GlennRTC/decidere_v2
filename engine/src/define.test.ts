import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineRuleSet, RuleError } from "./index.ts";

const cond = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: `label ${id}`,
  variable: "v1",
  op: ">",
  value: 10,
  unit: "u",
  ...extra,
});
const rule = (extra: Record<string, unknown> = {}) => ({
  id: "r1",
  conditions: [cond("a"), cond("b"), cond("c")],
  combine: { all: ["a", { any: ["b", "c"] }] },
  ...extra,
});

function fails(
  input: unknown,
  code: string,
  path?: string,
  options?: { variables?: ReadonlySet<string> },
) {
  assert.throws(
    () => defineRuleSet(input, options),
    (e: unknown) => {
      assert.ok(e instanceof RuleError, `expected RuleError, got ${String(e)}`);
      assert.equal(e.code, code);
      if (path !== undefined) assert.equal(e.path, path);
      return true;
    },
  );
}

const combineOf = (set: readonly unknown[]) =>
  (set[0] as { combine: unknown }).combine;

const nested = (depth: number) => {
  let node: unknown = "a";
  for (let i = 0; i < depth; i++) node = { not: node };
  return node;
};

describe("defineRuleSet", () => {
  it("accepts a valid rule set and returns a frozen copy", () => {
    const set = defineRuleSet([rule()]);
    assert.ok(Object.isFrozen(set));
    assert.ok(Object.isFrozen(set[0]));
    assert.ok(Object.isFrozen(set[0]?.conditions));
    assert.ok(Object.isFrozen(set[0]?.conditions[0]));
    const combine = combineOf(set) as { all: unknown[] };
    assert.ok(Object.isFrozen(combine));
    assert.ok(Object.isFrozen(combine.all));
    assert.ok(Object.isFrozen(combine.all[1]));
    const atLeast = defineRuleSet([
      rule({ combine: { atLeast: { n: 2, of: ["a", "b"] } } }),
    ]);
    const inner = (combineOf(atLeast) as { atLeast: { of: unknown[] } })
      .atLeast;
    assert.ok(Object.isFrozen(inner));
    assert.ok(Object.isFrozen(inner.of));
  });

  it("mutating the original after define does not change the loaded set", () => {
    const original = rule();
    const set = defineRuleSet([original]);
    original.conditions[0] = cond("zzz");
    original.id = "changed";
    (original.combine as { all: unknown[] }).all.push("b");
    assert.equal(set[0]?.id, "r1");
    assert.equal(set[0]?.conditions[0]?.id, "a");
    assert.equal((combineOf(set) as { all: unknown[] }).all.length, 2);
  });

  it("drops unknown extra keys", () => {
    const set = defineRuleSet([
      {
        ...rule(),
        extra: 1,
        conditions: [{ ...cond("a"), more: 2 }],
        combine: "a",
      },
    ]);
    assert.deepEqual(Object.keys(set[0] ?? {}).sort(), [
      "combine",
      "conditions",
      "id",
    ]);
    assert.ok(!("more" in (set[0]?.conditions[0] ?? {})));
  });

  it("rejects non-array input, an empty array, a non-object rule", () => {
    fails({}, "invalid_rule_set", "rules");
    fails(null, "invalid_rule_set", "rules");
    fails([], "invalid_rule_set", "rules");
    fails([null], "invalid_rule", "rules.0");
    fails([[]], "invalid_rule", "rules.0");
    fails(["x"], "invalid_rule", "rules.0");
    fails([rule({ conditions: "no" })], "invalid_rule", "rules.0.conditions");
  });

  it("rejects empty or non-string ids and duplicates", () => {
    fails([rule({ id: "" })], "invalid_rule", "rules.0.id");
    fails([rule({ id: 7 })], "invalid_rule", "rules.0.id");
    fails(
      [rule({ conditions: [cond("")] })],
      "invalid_condition",
      "rules.0.conditions.0",
    );
    fails(
      [rule({ conditions: [cond("a", { id: 5 })] })],
      "invalid_condition",
      "rules.0.conditions.0",
    );
    fails(
      [rule({ conditions: [cond("a"), cond("a")] })],
      "duplicate_id",
      "rules.0.conditions.1",
    );
    fails([rule(), rule()], "duplicate_id", "rules.1");
    const ok = defineRuleSet([rule(), rule({ id: "r2" })]);
    assert.equal(ok.length, 2);
  });

  it("rejects unknown operator, non-finite value, non-string label/unit/variable", () => {
    const p = "rules.0.conditions.2";
    const bad = (extra: Record<string, unknown>) =>
      fails(
        [rule({ conditions: [cond("a"), cond("b"), cond("c", extra)] })],
        "invalid_condition",
        p,
      );
    bad({ op: "!=" });
    bad({ op: 1 });
    bad({ value: Number.NaN });
    bad({ value: Number.POSITIVE_INFINITY });
    bad({ value: "10" });
    bad({ label: 1 });
    bad({ unit: null });
    bad({ variable: 3 });
    fails(
      [rule({ conditions: [null, cond("b")] })],
      "invalid_condition",
      "rules.0.conditions.0",
    );
  });

  it("rejects a variable outside options.variables when given", () => {
    fails([rule()], "unknown_variable", "rules.0.conditions.0", {
      variables: new Set(["other"]),
    });
    assert.equal(
      defineRuleSet([rule()], { variables: new Set(["v1"]) }).length,
      1,
    );
    assert.equal(
      defineRuleSet([
        rule({
          conditions: [cond("a", { variable: "anything" })],
          combine: "a",
        }),
      ]).length,
      1,
    );
  });

  it("rejects bad combinators", () => {
    const c = "rules.0.combine";
    const bad = (combine: unknown, path = c) =>
      fails([rule({ combine })], "invalid_combinator", path);
    bad(null);
    bad([]);
    bad({});
    bad(5);
    bad({ all: ["a"], any: ["b"] });
    bad({ atLeast: null });
    bad({ atLeast: 3 });
    bad({ atLeast: { n: 0, of: ["a"] } });
    bad({ atLeast: { n: 3, of: ["a", "b"] } });
    bad({ atLeast: { n: 1.5, of: ["a", "b"] } });
    bad({ atLeast: { n: 1, of: [] } });
    bad({ atLeast: { n: 1, of: "a" } });
    bad({ all: [] });
    bad({ any: [] });
    bad({ all: "a" });
    bad({ bogus: ["a"] });
    bad({ all: ["a", { any: [] }] }, `${c}.1`);
    fails([rule({ combine: "nope" })], "unknown_reference", "rules.0.combine");
    fails(
      [rule({ combine: { all: ["a", "nope"] } })],
      "unknown_reference",
      "rules.0.combine.1",
    );
  });

  it("a __proto__ key in a combinator is rejected", () => {
    fails(
      [rule({ combine: JSON.parse('{"__proto__": ["a"]}') })],
      "invalid_combinator",
      "rules.0.combine",
    );
    fails(
      [rule({ combine: JSON.parse('{"all": ["a"], "__proto__": ["a"]}') })],
      "invalid_combinator",
    );
  });

  it("10 000 nested not raises RuleError too_deep, not RangeError", () => {
    fails([rule({ combine: nested(10_000) })], "too_deep");
  });

  it("depth 64 passes, 65 fails", () => {
    assert.equal(defineRuleSet([rule({ combine: nested(64) })]).length, 1);
    fails([rule({ combine: nested(65) })], "too_deep");
  });

  it("a cyclic combinator raises RuleError, not a stack overflow", () => {
    const loop: Record<string, unknown> = {};
    loop.not = loop;
    fails([rule({ combine: loop })], "too_deep");
  });

  it("error messages and paths never contain a rule value or key name", () => {
    const canary = "CANARY_zq9";
    const cases: unknown[] = [
      [rule({ id: canary }), rule({ id: canary })],
      [rule({ conditions: [cond(canary), cond(canary)] })],
      [rule({ conditions: [cond("a", { op: canary })] })],
      [rule({ conditions: [cond("a", { variable: canary })] })],
      [rule({ conditions: [cond("a", { label: canary, value: canary })] })],
      [rule({ combine: canary })],
      [rule({ combine: { [canary]: ["a"] } })],
      [rule({ combine: { all: ["a"], [canary]: 1 } })],
      [rule({ combine: { atLeast: { n: canary, of: ["a"] } } })],
    ];
    for (const input of cases) {
      try {
        defineRuleSet(input, { variables: new Set(["v1"]) });
        assert.fail("expected RuleError");
      } catch (e) {
        assert.ok(e instanceof RuleError);
        assert.ok(
          !JSON.stringify({ message: e.message, path: e.path }).includes(
            canary,
          ),
        );
      }
    }
  });
});
