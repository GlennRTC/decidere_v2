import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_RULES_DIR, loadActiveRules } from "./rules.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-units-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("the real knowledge/rules units match the catalog", () => {
  assert.doesNotThrow(() => loadActiveRules(DEFAULT_RULES_DIR));
});

test("a condition unit that differs from the catalog ucum fails closed without echoing values", () => {
  const yaml = fs
    .readFileSync(path.join(DEFAULT_RULES_DIR, "sepsis.qsofa.v1.yaml"), "utf8")
    .replace('unit: "/min"', 'unit: "/h"');
  assert.match(yaml, /\/h/);
  fs.writeFileSync(path.join(tmp, "sepsis.qsofa.v1.yaml"), yaml);
  assert.throws(
    () => loadActiveRules(tmp),
    (err: unknown) => {
      const e = err as Error & { code?: string };
      assert.equal(e.code, "unit_mismatch");
      assert.ok(!e.message.includes("/h"));
      assert.ok(!e.message.includes("resp_rate"));
      return true;
    },
  );
});
