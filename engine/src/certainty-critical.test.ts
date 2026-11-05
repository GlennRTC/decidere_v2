import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCertainty } from "./certainty.ts";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";
import { classify } from "./policy.ts";
import type { Input } from "./types.ts";

// Synthetic mechanics only: same shape as the real qSOFA rule, not its clinical content.
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

const rs = defineRuleSet([qsofa]);
const severities = new Map([["t.qsofa", "critical"]] as const);

const decide = (input: Input, tau?: number) => {
  const result = evaluateRuleSet(rs, input);
  const decision = classify(result, severities);
  return {
    result,
    decision,
    out: computeCertainty(rs, result, decision, tau),
  };
};

// Every combination of {resp_rate, sbp, gcs} over the values in the brief.
// An undefined value means the variable is absent from the input.
const RESP = [30, 10, undefined] as const;
const SBP = [80, 130, undefined] as const;
const GCS = [10, 15, undefined] as const;
const combinations: Input[] = [];
for (const resp_rate of RESP)
  for (const sbp of SBP)
    for (const gcs of GCS) {
      const input: Record<string, number> = {};
      if (resp_rate !== undefined) input.resp_rate = resp_rate;
      if (sbp !== undefined) input.sbp = sbp;
      if (gcs !== undefined) input.gcs = gcs;
      combinations.push(input);
    }

describe("certainty never degrades a critical", () => {
  it("critical with a missing criterion keeps its class and gets a certainty below 1", () => {
    const { decision, out } = decide({ resp_rate: 30, sbp: 80 });
    assert.equal(decision.class, "critical");
    assert.ok(Math.abs(out.completeness - 2 / 3) < 1e-9);
    assert.ok(out.value < 1);
  });

  it("a critical below tau is flagged and keeps critical", () => {
    const { decision, out } = decide({ resp_rate: 30, sbp: 80 }, 1.01);
    assert.equal(decision.class, "critical");
    assert.equal(out.below_tau, true);
    assert.equal(out.requires_confirmation, true);
  });

  it("no qSOFA combination with a reachable critical is no_alert", () => {
    assert.equal(combinations.length, 27);
    let n = 0;
    for (const input of combinations) {
      const { decision } = decide(input);
      if (decision.class === "critical") n++;
      assert.ok(
        decision.highest_reachable_class !== "critical" ||
          decision.class !== "no_alert",
        `reachable critical decided no_alert for ${JSON.stringify(input)}`,
      );
    }
    assert.ok(n > 0);
  });

  it("a decided critical is unchanged by computeCertainty", () => {
    for (const input of combinations) {
      const result = evaluateRuleSet(rs, input);
      const decision = classify(result, severities);
      if (decision.class !== "critical") continue;
      const before = JSON.stringify(decision);
      computeCertainty(rs, result, decision, 1.01);
      assert.equal(JSON.stringify(decision), before);
    }
  });

  it("requires_confirmation is never true unless the class is critical", () => {
    for (const input of combinations) {
      const { decision, out } = decide(input, 1.01);
      if (out.requires_confirmation)
        assert.equal(decision.class, "critical", JSON.stringify(input));
    }
  });
});
