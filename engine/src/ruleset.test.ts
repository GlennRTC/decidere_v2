import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";

const cond = (id: string, variable: string) => ({
  id,
  label: `label ${id}`,
  variable,
  op: ">=" as const,
  value: 1,
  unit: "u",
});
const ruleSet = defineRuleSet([
  { id: "r1", conditions: [cond("a", "v1")], combine: "a" },
  { id: "r2", conditions: [cond("a", "v2")], combine: "a" },
  {
    id: "r3",
    conditions: [cond("a", "v1"), cond("b", "v3")],
    combine: { all: ["a", "b"] },
  },
  { id: "r4", conditions: [cond("a", "v1")], combine: { not: "a" } },
]);

describe("multi-rule results", () => {
  it("fired lists only true rules; rules keep declaration order with a full trace", () => {
    const out = evaluateRuleSet(ruleSet, { v1: 1 });
    assert.deepEqual(
      out.rules.map((r) => [r.rule_id, r.result]),
      [
        ["r1", true],
        ["r2", "unknown"],
        ["r3", "unknown"],
        ["r4", false],
      ],
    );
    assert.deepEqual(out.fired, ["r1"]);
    assert.deepEqual(
      out.rules.map((r) => r.trace.map((e) => e.id)),
      [["a"], ["a"], ["a", "b", "combine"], ["a", "combine"]],
    );
  });

  it("a rule with all inputs missing is unknown, not false", () => {
    const out = evaluateRuleSet(ruleSet, {});
    assert.deepEqual(
      out.rules.map((r) => r.result),
      ["unknown", "unknown", "unknown", "unknown"],
    );
    assert.deepEqual(out.fired, []);
  });

  it("fired follows declaration order when several rules are true", () => {
    const out = evaluateRuleSet(ruleSet, { v1: 1, v2: 1, v3: 1 });
    assert.deepEqual(out.fired, ["r1", "r2", "r3"]);
  });

  it("the same condition id in two rules is evaluated independently", () => {
    const out = evaluateRuleSet(ruleSet, { v1: 0, v2: 1 });
    assert.deepEqual(
      out.rules.slice(0, 2).map((r) => r.result),
      [false, true],
    );
  });
});

describe("determinism", () => {
  const forward = { v1: 1, v2: 0, v3: 5 };
  const reversed = { v3: 5, v2: 0, v1: 1 };
  const hash = (input: Record<string, number>) =>
    createHash("sha256")
      .update(JSON.stringify(evaluateRuleSet(ruleSet, input)))
      .digest("hex");

  it("1000 runs with reordered input keys give one distinct output", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) hashes.add(hash(i % 2 ? forward : reversed));
    assert.equal(hashes.size, 1);
  });

  it("a second node process produces the same sha256", () => {
    const script = `
      import { createHash } from "node:crypto";
      import { defineRuleSet, evaluateRuleSet } from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
      const cond = (id, variable) => ({ id, label: "label " + id, variable, op: ">=", value: 1, unit: "u" });
      const rs = defineRuleSet([
        { id: "r1", conditions: [cond("a", "v1")], combine: "a" },
        { id: "r2", conditions: [cond("a", "v2")], combine: "a" },
        { id: "r3", conditions: [cond("a", "v1"), cond("b", "v3")], combine: { all: ["a", "b"] } },
        { id: "r4", conditions: [cond("a", "v1")], combine: { not: "a" } },
      ]);
      process.stdout.write(createHash("sha256").update(JSON.stringify(evaluateRuleSet(rs, { v3: 5, v2: 0, v1: 1 }))).digest("hex"));
    `;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, hash(forward));
  });
});
