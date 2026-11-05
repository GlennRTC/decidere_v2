import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES_DIR, loadActiveRules } from "./rules.ts";

test("DEFAULT_RULES_DIR is a decoded file path that loads", () => {
  assert.equal(
    DEFAULT_RULES_DIR,
    fileURLToPath(new URL("../../../knowledge/rules/", import.meta.url)),
  );
  assert.ok(loadActiveRules(DEFAULT_RULES_DIR).meta.length > 0);
});

test("a rule without severity fails with code missing_severity", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-"));
  cpSync(DEFAULT_RULES_DIR, dir, { recursive: true });
  const file = join(dir, "sepsis.qsofa.v1.yaml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(/^severity: critical\n/m, ""),
  );
  assert.throws(
    () => loadActiveRules(dir),
    (e: Error & { code?: string }) => e.code === "missing_severity",
  );
});
