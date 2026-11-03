import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { loadRuleSet } from "./load.ts";

const roots: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rules-lerr-"));
  roots.push(d);
  return d;
}
after(() => {
  for (const r of roots) {
    try {
      fs.chmodSync(r, 0o700);
    } catch {}
    fs.rmSync(r, { recursive: true, force: true });
  }
});

const opts = { variables: new Set(["v1"]) };

function fails(run: () => unknown, code: RuleLoadErrorCode, dir: string) {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof RuleLoadError, `got ${String(err)}`);
    assert.equal(err.code, code);
    const shown = JSON.stringify([err.message, err.path, err.detail, err.file]);
    assert.ok(!shown.includes(dir), "leaks the directory path");
    assert.ok(!shown.includes(path.basename(dir)), "leaks the directory name");
    assert.ok(!/ENOENT|ENOTDIR|EACCES|errno/i.test(shown), "leaks errno text");
    return;
  }
  assert.fail("expected a throw");
}

test("a missing directory is unreadable_entry without path or errno", () => {
  const dir = path.join(tmp(), "missing-dir");
  fails(() => loadRuleSet(dir, opts), "unreadable_entry", dir);
});

test("a path that is a file is unreadable_entry", () => {
  const dir = tmp();
  const file = path.join(dir, "plain.yaml");
  fs.writeFileSync(file, "x");
  fails(() => loadRuleSet(file, opts), "unreadable_entry", dir);
});

test("an unreadable directory is unreadable_entry", {
  skip: process.getuid?.() === 0 ? "running as root" : false,
}, () => {
  const dir = tmp();
  fs.chmodSync(dir, 0o000);
  fails(() => loadRuleSet(dir, opts), "unreadable_entry", dir);
});

test("an unreadable file is unreadable_entry with the file name", () => {
  if (process.getuid?.() === 0) return;
  const dir = tmp();
  const f = path.join(dir, "a.yaml");
  fs.writeFileSync(f, "x");
  fs.chmodSync(f, 0o000);
  try {
    loadRuleSet(dir, opts);
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof RuleLoadError);
    assert.equal(err.code, "unreadable_entry");
    assert.equal(err.file, "a.yaml");
  }
});

test("a FIFO named like a rule file is unsupported_entry", (t) => {
  const dir = tmp();
  const r = spawnSync("mkfifo", [path.join(dir, "a.yaml")]);
  if (r.status !== 0) return t.skip("mkfifo unavailable");
  try {
    loadRuleSet(dir, opts);
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof RuleLoadError);
    assert.equal(err.code, "unsupported_entry");
  }
});

test("options must carry a Set of variables", () => {
  const dir = tmp();
  const bad: unknown[] = [
    undefined,
    null,
    {},
    [],
    { variables: ["v1"] },
    { variables: { has: () => true } },
    { variables: null },
  ];
  for (const o of bad)
    fails(
      () => (loadRuleSet as (d: string, o: unknown) => unknown)(dir, o),
      "invalid_options",
      dir,
    );
});
