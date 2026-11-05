import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CANONICAL_VARIABLES } from "@decidere/schema";
import { loadRuleSet } from "./load.ts";

const dir = new URL("../../../knowledge/rules/", import.meta.url).pathname;

test("qsofa loads against the catalog", () => {
  const loaded = loadRuleSet(dir, { variables: CANONICAL_VARIABLES });
  assert.equal(loaded.ruleSet.length, 1);
});

test("a rule using a variable absent from the catalog fails to load", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  const yaml = fs
    .readFileSync(path.join(dir, "sepsis.qsofa.v1.yaml"), "utf8")
    .replace("variable: resp_rate", "variable: lactate");
  fs.writeFileSync(path.join(tmp, "sepsis.qsofa.v1.yaml"), yaml);
  assert.throws(
    () => loadRuleSet(tmp, { variables: CANONICAL_VARIABLES }),
    (e: unknown) => e instanceof Error && e.name === "RuleLoadError",
  );
});
