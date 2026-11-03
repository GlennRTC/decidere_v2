import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const path = new URL("../.github/CODEOWNERS", import.meta.url);

test("CODEOWNERS exists", () => {
  assert.ok(existsSync(path));
});

test("CODEOWNERS assigns /knowledge/ to at least one owner", () => {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const line = lines.find((l) => l.startsWith("/knowledge/"));
  assert.ok(line, "missing /knowledge/ line");
  const owners = line.split(/\s+/).slice(1);
  assert.ok(owners.some((o) => o.startsWith("@")));
});

test("CODEOWNERS documents the interim clinical owner", () => {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  assert.ok(lines.some((l) => l.startsWith("#") && /interim/i.test(l)));
});
