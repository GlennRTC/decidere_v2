import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";
import type { ClassId, Severity } from "./policy.ts";
import { classify, POLICY_VERSION, PolicyError } from "./policy.ts";
import type { Input, RuleSetResult } from "./types.ts";

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
    cond("a", "x", ">=", 22),
    cond("b", "y", "<=", 100),
    cond("c", "z", "<", 15),
  ],
  combine: { atLeast: { n: 2, of: ["a", "b", "c"] } },
};
const qsofaSet = defineRuleSet([qsofa]);
const qsofaSev = new Map<string, Severity>([["t.qsofa", "critical"]]);

type Step = "met" | "not" | "missing";
const VALUES: Record<string, Record<Step, number | undefined>> = {
  x: { met: 22, not: 0, missing: undefined },
  y: { met: 100, not: 200, missing: undefined },
  z: { met: 10, not: 20, missing: undefined },
};
const build = (a: Step, b: Step, c: Step): Input => {
  const out: Record<string, number> = {};
  for (const [k, s] of [
    ["x", a],
    ["y", b],
    ["z", c],
  ] as const) {
    const v = VALUES[k]?.[s];
    if (v !== undefined) out[k] = v;
  }
  return out;
};
const run = (input: Input) =>
  classify(evaluateRuleSet(qsofaSet, input), qsofaSev);

const STEPS: Step[] = ["met", "not", "missing"];
const combos: [Step, Step, Step][] = [];
for (const a of STEPS)
  for (const b of STEPS) for (const c of STEPS) combos.push([a, b, c]);

const RANK: Record<string, number> = { no_alert: 0, watch: 1, critical: 2 };

describe("decision table", () => {
  const rows: [string, Input, ClassId, string, ClassId][] = [
    ["T=3", build("met", "met", "met"), "critical", "rule_true", "critical"],
    [
      "T=2 U=1",
      build("met", "met", "missing"),
      "critical",
      "rule_true",
      "critical",
    ],
    [
      "T=2 F=1",
      build("met", "met", "not"),
      "critical",
      "rule_true",
      "critical",
    ],
    [
      "T=1 U=0",
      build("met", "not", "not"),
      "watch",
      "partial_criteria",
      "watch",
    ],
    [
      "T=1 U=1",
      build("met", "not", "missing"),
      "review",
      "could_escalate",
      "critical",
    ],
    [
      "T=1 U=2",
      build("met", "missing", "missing"),
      "review",
      "could_escalate",
      "critical",
    ],
    [
      "T=0 U=2",
      build("not", "missing", "missing"),
      "review",
      "could_escalate",
      "critical",
    ],
    [
      "T=0 U=1",
      build("not", "not", "missing"),
      "review",
      "incomplete_for_no_alert",
      "watch",
    ],
    [
      "T=0 U=0",
      build("not", "not", "not"),
      "no_alert",
      "all_criteria_clear",
      "no_alert",
    ],
    ["all unknown", {}, "review", "could_escalate", "critical"],
    [
      "T=0 U=1 invalid string",
      { x: "abc", y: 200, z: 20 },
      "review",
      "incomplete_for_no_alert",
      "watch",
    ],
  ];
  for (const [name, input, cls, reason, reach] of rows)
    it(name, () => {
      const d = run(input);
      assert.equal(d.class, cls);
      assert.equal(d.reason_code, reason);
      assert.equal(d.highest_reachable_class, reach);
      assert.equal(d.provisional, true);
      assert.equal(d.policy_version, POLICY_VERSION);
      assert.equal(d.basis.length, 1);
      assert.equal(d.conflict, false);
    });
  it("basis carries counts for an atLeast root", () => {
    const b = run(build("met", "not", "missing")).basis[0];
    assert.deepEqual(b?.counts, { t: 1, u: 1, f: 1, min: 1, max: 2 });
    assert.equal(b?.unknown_leaves, 1);
    assert.equal(b?.severity, "critical");
  });
});

describe("27 combinations", () => {
  it("no_alert iff nothing missing and nothing met; critical iff rule true", () => {
    for (const combo of combos) {
      const input = build(...combo);
      const result = evaluateRuleSet(qsofaSet, input);
      const d = classify(result, qsofaSev);
      const expectNoAlert = combo.every((s) => s === "not");
      assert.equal(d.class === "no_alert", expectNoAlert, combo.join());
      assert.equal(
        d.class === "critical",
        result.rules[0]?.result === true,
        combo.join(),
      );
    }
  });
});

describe("reachable monotonicity", () => {
  it("met never lowers, not met never raises", () => {
    for (const combo of combos) {
      const base = run(build(...combo)).highest_reachable_class;
      combo.forEach((s, i) => {
        if (s !== "missing") return;
        const withMet = [...combo] as [Step, Step, Step];
        withMet[i] = "met";
        const withNot = [...combo] as [Step, Step, Step];
        withNot[i] = "not";
        const up = run(build(...withMet)).highest_reachable_class;
        const down = run(build(...withNot)).highest_reachable_class;
        assert.ok((RANK[up] as number) >= (RANK[base] as number), combo.join());
        assert.ok(
          (RANK[down] as number) <= (RANK[base] as number),
          combo.join(),
        );
      });
    }
  });
});

describe("ignores fired", () => {
  it("tampered fired gives a deep-equal decision", () => {
    for (const combo of combos) {
      const result = evaluateRuleSet(qsofaSet, build(...combo));
      const base = classify(result, qsofaSev);
      const empty: RuleSetResult = { ...result, fired: [] };
      const full: RuleSetResult = { ...result, fired: ["t.qsofa"] };
      assert.deepEqual(classify(empty, qsofaSev), base);
      assert.deepEqual(classify(full, qsofaSev), base);
    }
  });
});

describe("max severity across rules", () => {
  const two = defineRuleSet([
    qsofa,
    { id: "t.single", conditions: [cond("p", "p", ">=", 1)], combine: "p" },
  ]);
  const sev = new Map<string, Severity>([
    ["t.qsofa", "critical"],
    ["t.single", "watch"],
  ]);
  const go = (input: Input) => classify(evaluateRuleSet(two, input), sev);

  it("critical true + watch false -> critical, conflict", () => {
    const d = go({ ...build("met", "met", "met"), p: 0 });
    assert.equal(d.class, "critical");
    assert.equal(d.conflict, true);
  });
  it("watch true + critical false-complete -> watch", () => {
    const d = go({ ...build("not", "not", "not"), p: 1 });
    assert.equal(d.class, "watch");
    assert.equal(d.reason_code, "rule_true");
    assert.equal(d.highest_reachable_class, "watch");
    assert.equal(d.conflict, true);
  });
  it("critical unknown + watch true -> review, reachable critical", () => {
    const d = go({ p: 1 });
    assert.equal(d.class, "review");
    assert.equal(d.reason_code, "could_escalate");
    assert.equal(d.highest_reachable_class, "critical");
  });
  it("both false-complete -> no_alert, no conflict", () => {
    const d = go({ ...build("not", "not", "not"), p: 0 });
    assert.equal(d.class, "no_alert");
    assert.equal(d.conflict, false);
    assert.deepEqual(
      d.basis.map((b) => b.rule_id),
      ["t.qsofa", "t.single"],
    );
  });
  it("watch rule with missing input is review but reachable no_alert alone", () => {
    const d = classify(
      evaluateRuleSet(defineRuleSet([two[1] as never]), {}),
      new Map<string, Severity>([["t.single", "watch"]]),
    );
    assert.equal(d.class, "review");
    assert.equal(d.highest_reachable_class, "watch");
  });
});

describe("single-leaf and non-atLeast roots", () => {
  const set = defineRuleSet([
    {
      id: "t.all",
      conditions: [cond("a", "x", ">=", 1), cond("b", "y", ">=", 1)],
      combine: { all: ["a", "b"] },
    },
    { id: "t.leaf", conditions: [cond("a", "x", ">=", 1)], combine: "a" },
  ]);
  const sev = new Map<string, Severity>([
    ["t.all", "critical"],
    ["t.leaf", "critical"],
  ]);
  it("counts null and never partial_criteria", () => {
    const d = classify(evaluateRuleSet(set, { x: 5, y: 0 }), sev);
    for (const b of d.basis) {
      assert.equal(b.counts, null);
      assert.notEqual(b.reason_code, "partial_criteria");
    }
    assert.equal(d.basis[0]?.class, "no_alert");
    assert.equal(d.basis[1]?.class, "critical");
  });
  it("false with an unknown leaf is review with reachable no_alert", () => {
    const d = classify(evaluateRuleSet(set, { x: 0 }), sev);
    const all = d.basis[0];
    assert.equal(all?.result, false);
    assert.equal(all?.class, "review");
    assert.equal(all?.reason_code, "incomplete_for_no_alert");
    assert.equal(all?.reachable, "no_alert");
  });
});

describe("fail closed", () => {
  const good = evaluateRuleSet(qsofaSet, build("met", "met", "met"));
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof PolicyError);
      assert.ok(!e.message.includes("t.qsofa"));
      return e.code;
    }
    return "no throw";
  };
  it("empty rules", () => {
    assert.equal(
      codeOf(() => classify({ rules: [], fired: [] }, qsofaSev)),
      "empty_result",
    );
  });
  it("missing severity", () => {
    assert.equal(
      codeOf(() => classify(good, new Map())),
      "missing_severity",
    );
  });
  it("malformed input", () => {
    const bad = (x: unknown, s: unknown = qsofaSev) =>
      codeOf(() => classify(x as never, s as never));
    assert.equal(bad(null), "invalid_input");
    assert.equal(bad("x"), "invalid_input");
    assert.equal(bad({ rules: "nope", fired: [] }), "invalid_input");
    assert.equal(bad(good, new Map([["t.qsofa", "info"]])), "invalid_input");
    assert.equal(bad(good, {}), "invalid_input");
    assert.equal(
      bad({ rules: [{ rule_id: "t.qsofa", result: "yes", trace: [] }] }),
      "invalid_input",
    );
  });
});

describe("no mutation", () => {
  it("accepts a deep-frozen result", () => {
    const freeze = (o: unknown): void => {
      if (o !== null && typeof o === "object") {
        Object.freeze(o);
        for (const v of Object.values(o)) freeze(v);
      }
    };
    const result = evaluateRuleSet(qsofaSet, build("met", "not", "missing"));
    freeze(result);
    assert.doesNotThrow(() => classify(result, qsofaSev));
  });
});
