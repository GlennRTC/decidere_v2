import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, evaluateRuleSet } from "@decidere/engine";
import { loadRuleSet } from "./load.ts";

const dir = new URL("../../../knowledge/rules/", import.meta.url);
const variables = new Set(["resp_rate", "sbp", "gcs"]);
const loaded = loadRuleSet(dir.pathname, { variables });

function decide(input: Record<string, unknown>) {
  return classify(evaluateRuleSet(loaded.ruleSet, input), loaded.severities);
}

test("the real qSOFA declares severity critical", () => {
  assert.equal(loaded.severities.get("sepsis.qsofa.v1"), "critical");
});

test("clinician-review cases", () => {
  let d = decide({ resp_rate: 24, sbp: 95, gcs: 15 });
  assert.equal(d.class, "critical");
  assert.equal(d.reason_code, "rule_true");
  assert.equal(decide({ resp_rate: 22, sbp: 100, gcs: 14 }).class, "critical");
  assert.equal(decide({ resp_rate: 21, sbp: 101, gcs: 15 }).class, "no_alert");
  d = decide({ resp_rate: 26, sbp: 120, gcs: 15 });
  assert.equal(d.class, "watch");
  assert.equal(d.reason_code, "partial_criteria");
  d = decide({ resp_rate: 26, gcs: 15 });
  assert.equal(d.class, "review");
  assert.equal(d.reason_code, "could_escalate");
  assert.equal(d.highest_reachable_class, "critical");
  d = decide({});
  assert.equal(d.class, "review");
  assert.equal(d.reason_code, "could_escalate");
  assert.equal(d.highest_reachable_class, "critical");
  d = decide({ resp_rate: 18, sbp: 120 });
  assert.equal(d.class, "review");
  assert.equal(d.reason_code, "incomplete_for_no_alert");
  d = decide({ resp_rate: 28, sbp: 88 });
  assert.equal(d.class, "critical");
  assert.equal(d.reason_code, "rule_true");
  assert.equal(d.highest_reachable_class, "critical");
  assert.deepEqual(
    decide({ resp_rate: 18, sbp: 120, gcs: "abc" }),
    decide({ resp_rate: 18, sbp: 120 }),
  );
});

test("decision is provisional and versioned", () => {
  const d = decide({ resp_rate: 24, sbp: 95, gcs: 15 });
  assert.equal(d.provisional, true);
  assert.equal(d.policy_version, "policy-provisional-1");
});

test("whole decision table over the 27 combinations", () => {
  // 0 = not met, 1 = met, 2 = missing
  const met = { resp_rate: 22, sbp: 100, gcs: 14 };
  const notMet = { resp_rate: 12, sbp: 120, gcs: 15 };
  const keys = ["resp_rate", "sbp", "gcs"] as const;
  for (const a of [0, 1, 2])
    for (const b of [0, 1, 2])
      for (const c of [0, 1, 2]) {
        const states = [a, b, c];
        const input: Record<string, unknown> = {};
        keys.forEach((k, i) => {
          if (states[i] !== 2) input[k] = (states[i] === 1 ? met : notMet)[k];
        });
        const t = states.filter((s) => s === 1).length;
        const m = states.filter((s) => s === 2).length;
        const d = decide(input);
        const at = `${a}${b}${c}`;
        let want: [string, string];
        if (t >= 2) want = ["critical", "rule_true"];
        else if (t === 1 && m === 0) want = ["watch", "partial_criteria"];
        else if (t === 1 || m >= 2) want = ["review", "could_escalate"];
        else if (m === 1) want = ["review", "incomplete_for_no_alert"];
        else want = ["no_alert", "all_criteria_clear"];
        assert.deepEqual([d.class, d.reason_code], want, at);
        const reach =
          t + m >= 2 ? "critical" : t + m >= 1 ? "watch" : "no_alert";
        assert.equal(d.highest_reachable_class, reach, at);
      }
});
