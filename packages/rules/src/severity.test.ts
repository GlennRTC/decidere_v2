import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { RuleLoadError } from "./errors.ts";
import { loadRuleSet } from "./load.ts";
import { canonicalJson } from "./version.ts";

const roots: string[] = [];
function dirWith(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rules-sev-"));
  roots.push(d);
  for (const [n, c] of Object.entries(files))
    fs.writeFileSync(path.join(d, n), c);
  return d;
}
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const opts = { variables: new Set(["v1", "v2"]) };

function yaml(id: string, extra = ""): string {
  return `format_version: 1
id: ${id}
title: Title ${id}
${extra}citation:
  source: Demo source
  version: v1
  section: s1
clinical_approval:
  status: approved
  approver: Reviewer A
  guideline_version: g1
conditions:
  - {id: c1, label: L1, variable: v1, op: ">=", value: 7, unit: u1}
  - {id: c2, label: L2, variable: v2, op: "<", value: 3, unit: u2}
combine:
  all: [c1, c2]
`;
}
const load = (extra?: string) =>
  loadRuleSet(dirWith({ "r.a.yaml": yaml("r.a", extra) }), opts);

test("accepts severity critical and watch", () => {
  assert.equal(load("severity: critical\n").severities.get("r.a"), "critical");
  assert.equal(load("severity: watch\n").severities.get("r.a"), "watch");
});

test("rejects other severity values with invalid_value at the key path and without echoing the value", () => {
  for (const bad of ["info", "Critical", "''", "5", "true", "[critical]"]) {
    try {
      load(`severity: ${bad}\n`);
      assert.fail("expected RuleLoadError");
    } catch (err) {
      assert.ok(err instanceof RuleLoadError, `got ${String(err)}`);
      assert.equal(err.code, "invalid_value");
      assert.equal(err.path, "severity");
      assert.ok(!err.message.includes("info"));
    }
  }
});

test("severity is optional", () => {
  const loaded = load();
  assert.equal(loaded.severities.has("r.a"), false);
  assert.equal(loaded.severities.size, 0);
});

test("severity-only change changes rule_set_version", () => {
  const versions = [
    load("severity: critical\n").rule_set_version,
    load("severity: watch\n").rule_set_version,
    load().rule_set_version,
  ];
  assert.equal(new Set(versions).size, 3);
});

test("rule without severity keeps the previous canonical hash shape", () => {
  assert.ok(!canonicalJson(load().meta[0]).includes("severity"));
  assert.ok(
    canonicalJson(load("severity: watch\n").meta[0]).includes("severity"),
  );
});

test("disabled rules do not appear in severities", () => {
  const loaded = loadRuleSet(
    dirWith({
      "r.a.yaml": yaml("r.a", "severity: critical\n"),
      "r.b.yaml": yaml("r.b", "severity: watch\nenabled: false\n"),
    }),
    opts,
  );
  assert.deepEqual([...loaded.severities], [["r.a", "critical"]]);
});

test("severities cannot be mutated by callers", () => {
  const loaded = load("severity: critical\n");
  assert.throws(() => (loaded.severities as Map<string, string>).set("x", "y"));
  assert.throws(() => (loaded.severities as Map<string, string>).clear());
});
