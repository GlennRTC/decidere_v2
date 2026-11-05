import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES_DIR, loadActiveRules } from "./rules.ts";

test("the SIRS candidate is not part of the active rule set", () => {
  const loaded = loadActiveRules(DEFAULT_RULES_DIR);
  assert.equal(loaded.ruleSet.length, 1);
  assert.equal(loaded.rule_set_version, "rs-810ea5889733ed08");
  assert.ok(!loaded.meta.some((m) => m.id === "sepsis.sirs.v1"));
});
