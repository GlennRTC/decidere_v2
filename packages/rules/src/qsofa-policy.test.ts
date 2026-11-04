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
  assert.equal(decide({}).class, "review");
  d = decide({ resp_rate: 18, sbp: 120 });
  assert.equal(d.class, "review");
  assert.equal(d.reason_code, "incomplete_for_no_alert");
  assert.equal(decide({ resp_rate: 28, sbp: 88 }).class, "critical");
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

test("no_alert only when no input is missing and none is met (27 combinations)", () => {
  // 0 = not met, 1 = met, 2 = missing
  const values = [
    { resp_rate: 18, sbp: 120, gcs: 15 },
    { resp_rate: 24, sbp: 95, gcs: 14 },
  ];
  const states = [0, 1, 2];
  for (const a of states)
    for (const b of states)
      for (const c of states) {
        const input: Record<string, unknown> = {};
        const pick = (s: number, key: "resp_rate" | "sbp" | "gcs") => {
          if (s !== 2) input[key] = (values[s] as (typeof values)[number])[key];
        };
        pick(a, "resp_rate");
        pick(b, "sbp");
        pick(c, "gcs");
        const expectNoAlert = [a, b, c].every((s) => s === 0);
        assert.equal(
          decide(input).class === "no_alert",
          expectNoAlert,
          `${a}${b}${c}`,
        );
      }
});
