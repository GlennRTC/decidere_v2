import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { classify, evaluateRuleSet } from "@decidere/engine";
import { DELIVERABLE_VARIABLES } from "@decidere/schema";
import { loadRuleSet } from "./load.ts";

const knowledge = new URL("../../../knowledge/", import.meta.url);
const candidateDir = new URL("rules-candidate/", knowledge);
const loaded = loadRuleSet(candidateDir.pathname, {
  variables: DELIVERABLE_VARIABLES,
});

const normal = {
  temperature: 37,
  heart_rate: 80,
  resp_rate: 16,
  wbc: 8,
  paco2: 40,
  bands_pct: 2,
};

function run(input: Record<string, unknown>) {
  const result = evaluateRuleSet(loaded.ruleSet, input);
  return {
    rule: result.rules[0],
    decision: classify(result, loaded.severities),
  };
}

// Number of criteria (out of 4 groups) the engine counted as true.
function criteriaTrue(input: Record<string, unknown>): number {
  const entry = run(input).rule?.trace.find((t) => t.kind === "atLeast");
  assert.ok(entry && entry.kind === "atLeast");
  return entry.t;
}

test("exact thresholds are not met", () => {
  for (const override of [
    { temperature: 38 },
    { temperature: 36 },
    { heart_rate: 90 },
    { resp_rate: 20 },
    { paco2: 32 },
    { wbc: 12 },
    { wbc: 4 },
    { bands_pct: 10 },
  ]) {
    const { rule, decision } = run({ ...normal, ...override });
    assert.equal(rule?.result, false, JSON.stringify(override));
    assert.equal(decision.class, "no_alert", JSON.stringify(override));
  }
});

test("each criterion alone is true beyond its threshold", () => {
  for (const override of [
    { temperature: 38.5 },
    { temperature: 35.5 },
    { heart_rate: 95 },
    { resp_rate: 22 },
    { paco2: 30, resp_rate: 18 },
    { wbc: 13 },
    { wbc: 3.5 },
    { bands_pct: 11, wbc: 8 },
  ]) {
    assert.equal(
      criteriaTrue({ ...normal, ...override }),
      1,
      JSON.stringify(override),
    );
  }
});

test("two criteria make the rule true and the class watch", () => {
  const { rule, decision } = run({
    ...normal,
    temperature: 38.5,
    heart_rate: 95,
  });
  assert.equal(rule?.result, true);
  assert.equal(decision.class, "watch");
  assert.equal(decision.reason_code, "rule_true");
  assert.equal(decision.highest_reachable_class, "watch");
});

test("alternatives within a criterion", () => {
  // resp_rate > 20 alone satisfies the respiratory criterion without paco2.
  assert.equal(
    run({ temperature: 37, heart_rate: 95, resp_rate: 22, wbc: 8 }).rule
      ?.result,
    true,
  );
  // resp_rate 18 without paco2 leaves the respiratory criterion unknown: with
  // one other criterion true the rule cannot be decided.
  const unknownResp = run({
    temperature: 37,
    heart_rate: 95,
    resp_rate: 18,
    wbc: 8,
    bands_pct: 2,
  });
  assert.equal(unknownResp.rule?.result, "unknown");
  // Bands alone satisfy the leukocyte criterion when wbc is absent.
  assert.equal(
    run({ temperature: 37, heart_rate: 95, resp_rate: 16, bands_pct: 11 }).rule
      ?.result,
    true,
  );
});

test("missing paco2 and bands_pct send a clean patient to review", () => {
  const partial = { temperature: 37, heart_rate: 80, resp_rate: 16, wbc: 8 };
  let { decision } = run(partial);
  assert.equal(decision.class, "review");
  assert.equal(decision.highest_reachable_class, "watch");
  ({ decision } = run({ ...partial, paco2: 40, bands_pct: 2 }));
  assert.equal(decision.class, "no_alert");
  assert.equal(decision.reason_code, "all_criteria_clear");
});

test("all-normal minus paco2 or minus bands_pct is review, not no_alert", () => {
  const { paco2: _p, ...noPaco2 } = normal;
  const { bands_pct: _b, ...noBands } = normal;
  for (const input of [noPaco2, noBands]) {
    const { decision } = run(input);
    assert.equal(decision.class, "review");
    assert.equal(decision.reason_code, "incomplete_for_no_alert");
  }
  // A false rule with any unknown leaf is still review, even with RR above 20.
  const { decision } = run({ ...noPaco2, resp_rate: 22 });
  assert.equal(decision.class, "review");
});

test("a single criterion yields no alert under the current policy", () => {
  // The policy only grants partial-criteria vigilancia to critical rules;
  // whether a watch rule should too is an activation decision.
  const { decision } = run({ ...normal, temperature: 38.5 });
  assert.equal(decision.class, "no_alert");
});

const tmp = mkdtempSync(join(tmpdir(), "sirs-preview-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("activation preview: adding SIRS makes a qSOFA-only input review", () => {
  const qsofaFile = "sepsis.qsofa.v1.yaml";
  const qsofaOnly = join(tmp, "qsofa-only");
  const both = join(tmp, "both");
  mkdirSync(qsofaOnly);
  mkdirSync(both);
  const qsofa = new URL(`rules/${qsofaFile}`, knowledge).pathname;
  const sirs = new URL("rules-candidate/sepsis.sirs.v1.yaml", knowledge)
    .pathname;
  cpSync(qsofa, join(qsofaOnly, qsofaFile));
  cpSync(qsofa, join(both, qsofaFile));
  cpSync(sirs, join(both, "sepsis.sirs.v1.yaml"));
  const input = { resp_rate: 16, sbp: 120, gcs: 15 };
  const decide = (dir: string) => {
    const l = loadRuleSet(dir, { variables: DELIVERABLE_VARIABLES });
    return classify(evaluateRuleSet(l.ruleSet, input), l.severities);
  };
  assert.equal(decide(qsofaOnly).class, "no_alert");
  assert.equal(decide(both).class, "review");
});
