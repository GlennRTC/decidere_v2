import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CERTAINTY_VERSION,
  computeCertainty,
  TAU_PROVISIONAL,
  VARIABLE_BANDS,
} from "./certainty.ts";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";
import type { Severity } from "./policy.ts";
import { classify, PolicyError } from "./policy.ts";
import type { Input } from "./types.ts";

// Synthetic mechanics only: thresholds are not the clinical rule.
const cond = (
  id: string,
  variable: string,
  op: ">=" | "<=" | "<" | ">",
  value: number,
) => ({ id, label: `label ${id}`, variable, op, value, unit: "u" });

const qsofa = {
  id: "t.qsofa",
  conditions: [
    cond("a", "resp_rate", ">=", 22),
    cond("b", "sbp", "<=", 100),
    cond("c", "gcs", "<", 15),
  ],
  combine: { atLeast: { n: 2, of: ["a", "b", "c"] } },
};
const allRule = {
  id: "t.all",
  conditions: [cond("a", "resp_rate", ">=", 22), cond("b", "sbp", "<=", 100)],
  combine: { all: ["a", "b"] },
};
const watchRule = {
  id: "t.watch",
  conditions: [cond("a", "heart_rate", ">", 90)],
  combine: "a",
};
const bandless = {
  id: "t.bandless",
  conditions: [cond("a", "no_such_band", ">", 1)],
  combine: "a",
};

const run = (
  rules: (typeof qsofa)[],
  sev: [string, Severity][],
  input: Input,
  tau?: number,
) => {
  const rs = defineRuleSet(rules);
  const result = evaluateRuleSet(rs, input);
  const decision = classify(result, new Map(sev));
  return {
    rs,
    result,
    decision,
    out: computeCertainty(rs, result, decision, tau),
  };
};
const q = (input: Input, tau?: number) =>
  run([qsofa], [["t.qsofa", "critical"]], input, tau);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9);

describe("completeness", () => {
  it("is 1 when every criterion is known and 2/3 with one of three qSOFA criteria missing", () => {
    assert.equal(q({ resp_rate: 24, sbp: 95, gcs: 14 }).out.completeness, 1);
    near(q({ resp_rate: 24, sbp: 95 }).out.completeness, 2 / 3);
  });
  it("uses known leaves over total leaves when the root is not atLeast", () => {
    const { out } = run([allRule], [["t.all", "critical"]], { resp_rate: 24 });
    assert.equal(out.completeness, 0.5);
  });
  it("is the minimum across rules", () => {
    const { out } = run(
      [qsofa, allRule],
      [
        ["t.qsofa", "critical"],
        ["t.all", "critical"],
      ],
      { resp_rate: 24, sbp: 95, gcs: 14 },
    );
    assert.equal(out.completeness, 1);
    const part = run(
      [qsofa, allRule],
      [
        ["t.qsofa", "critical"],
        ["t.all", "critical"],
      ],
      { resp_rate: 24, gcs: 14 },
    );
    assert.equal(part.out.completeness, 0.5);
  });
});

describe("margin", () => {
  it("is 0 exactly at the threshold and 1 at one band away or more", () => {
    assert.equal(q({ resp_rate: 22 }).out.margin, 0);
    assert.equal(q({ resp_rate: 26 }).out.margin, 1);
    assert.equal(q({ resp_rate: 24 }).out.margin, 0.5);
    assert.equal(q({ resp_rate: 60 }).out.margin, 1);
  });
  it("is the minimum over known leaves and ignores unknown leaves", () => {
    assert.equal(q({ resp_rate: 26, sbp: 95 }).out.margin, 0.5);
    assert.equal(q({ resp_rate: 26 }).out.margin, 1);
  });
  it("is 1 when no leaf is known", () => {
    assert.equal(q({}).out.margin, 1);
  });
  it("is 0 for a variable without a band", () => {
    const { out } = run([bandless], [["t.bandless", "watch"]], {
      no_such_band: 50,
    });
    assert.equal(out.margin, 0);
  });
  it("never resolves inherited property names as bands", () => {
    assert.equal(Object.hasOwn(VARIABLE_BANDS, "__proto__"), false);
    const { out } = run(
      [{ ...bandless, conditions: [cond("a", "__proto__", ">", 1)] }],
      [["t.bandless", "watch"]],
      { __proto__: 5 } as unknown as Input,
    );
    assert.ok(out.margin <= 1);
  });
});

describe("conflict", () => {
  it("is 1 with one rule and 0.5 when two rules decide different classes", () => {
    assert.equal(q({ resp_rate: 30, sbp: 80 }).out.conflict, 1);
    const { out, decision } = run(
      [qsofa, watchRule],
      [
        ["t.qsofa", "critical"],
        ["t.watch", "watch"],
      ],
      { resp_rate: 30, sbp: 80, gcs: 10, heart_rate: 80 },
    );
    assert.equal(decision.class, "critical");
    assert.equal(out.conflict, 0.5);
  });
});

describe("value and flags", () => {
  it("value is the minimum of the three components and stays in [0,1]", () => {
    const { out } = q({ resp_rate: 24, sbp: 95 });
    assert.equal(
      out.value,
      Math.min(out.completeness, out.margin, out.conflict),
    );
    assert.ok(out.value >= 0 && out.value <= 1);
    assert.equal(out.provisional, true);
    assert.equal(out.version, CERTAINTY_VERSION);
    assert.equal(out.tau, TAU_PROVISIONAL);
  });
  it("requires_confirmation is true only for a critical below tau", () => {
    const input = { resp_rate: 30, sbp: 80, gcs: 10 };
    const hi = q(input, 1.01);
    assert.equal(hi.decision.class, "critical");
    assert.equal(hi.out.below_tau, true);
    assert.equal(hi.out.requires_confirmation, true);
    const lo = q(input, 0);
    assert.equal(lo.out.below_tau, false);
    assert.equal(lo.out.requires_confirmation, false);
    const w = run(
      [watchRule],
      [["t.watch", "watch"]],
      { heart_rate: 91 },
      1.01,
    );
    assert.equal(w.decision.class, "watch");
    assert.equal(w.out.below_tau, true);
    assert.equal(w.out.requires_confirmation, false);
  });
  it("does not mutate or depend on the decision class beyond requires_confirmation", () => {
    const { rs, result, decision, out } = q({
      resp_rate: 30,
      sbp: 80,
      gcs: 10,
    });
    const frozen = JSON.stringify(decision);
    const other = computeCertainty(rs, result, { ...decision, class: "watch" });
    assert.equal(JSON.stringify(decision), frozen);
    // Conflict is defined against the decided class, so only it may move with the class.
    assert.equal(other.completeness, out.completeness);
    assert.equal(other.margin, out.margin);
    assert.equal(other.requires_confirmation, false);
  });
  it("same input gives deep-equal output on repeated calls", () => {
    const { rs, result, decision, out } = q({ resp_rate: 24, sbp: 95 });
    assert.deepEqual(computeCertainty(rs, result, decision), out);
  });
});

describe("malformed input", () => {
  it("throws PolicyError invalid_input", () => {
    const { rs, result, decision } = q({ resp_rate: 24 });
    for (const bad of [
      () => computeCertainty(rs, null as never, decision),
      () => computeCertainty(null as never, result, decision),
      () => computeCertainty(rs, result, null as never),
      () => computeCertainty(rs, { rules: [], fired: [] }, decision),
      () =>
        computeCertainty(
          rs,
          { rules: [{ rule_id: "nope", result: true, trace: [] }], fired: [] },
          decision,
        ),
      () => computeCertainty(rs, result, decision, Number.NaN),
    ])
      assert.throws(
        bad,
        (e) => e instanceof PolicyError && e.code === "invalid_input",
      );
  });
});
