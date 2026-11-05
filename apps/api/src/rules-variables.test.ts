import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_RULES_DIR, loadActiveRules } from "./rules.ts";

test("an active rule on a variable the contract cannot deliver fails to load", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  try {
    const yaml = fs
      .readFileSync(
        path.join(DEFAULT_RULES_DIR, "sepsis.qsofa.v1.yaml"),
        "utf8",
      )
      .replace("variable: resp_rate", "variable: not_a_variable");
    fs.writeFileSync(path.join(tmp, "sepsis.qsofa.v1.yaml"), yaml);
    assert.throws(() => loadActiveRules(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
