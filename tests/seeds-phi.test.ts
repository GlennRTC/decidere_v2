import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hook = ".claude/hooks/check_phi_patterns.py";
const seedPaths = ["seeds/cases.json", "seeds/build.ts"];

function runHook(filePath: string, content: string) {
  return spawnSync("python3", [hook], {
    cwd: root,
    input: JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: filePath, content },
    }),
    encoding: "utf8",
  });
}

test("seed files are not under a hook-allowlisted path", () => {
  const source = readFileSync(`${root}${hook}`, "utf8");
  const match = source.match(/ALLOWLIST_SUBSTRINGS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, "allowlist found in hook");
  const allow = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(allow.length > 0);
  for (const p of seedPaths) {
    for (const s of allow) {
      assert.ok(!p.toLowerCase().includes(s), `${p} contains ${s}`);
    }
  }
});

test("the PHI hook lets seeds/cases.json through", () => {
  const content = readFileSync(`${root}seeds/cases.json`, "utf8");
  const r = runHook("seeds/cases.json", content);
  assert.equal(r.status, 0, r.stderr);
});

test("the same hook blocks an email written to a seed path", () => {
  const r = runHook("seeds/cases.json", '{"note": "a@b.co"}');
  assert.equal(r.status, 2, r.stderr);
});
