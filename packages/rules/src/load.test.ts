import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { evaluateRuleSet } from "@decidere/engine";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { loadRuleSet } from "./load.ts";

const roots: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rules-load-"));
  roots.push(d);
  return d;
}
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const vars = new Set(["v1", "v2", "v3"]);
const opts = { variables: vars };

function yaml(
  id: string,
  extra: { enabled?: boolean; status?: string; value?: number } = {},
): string {
  const pending = extra.status === "pending";
  return `format_version: 1
id: ${id}
title: Title ${id}
citation:
  source: Demo source
  version: v1
  section: s1
clinical_approval:
  status: ${extra.status ?? "approved"}
  approver: ${pending ? "null" : "Reviewer A"}
  guideline_version: ${pending ? "null" : "g1"}
${extra.enabled === undefined ? "" : `enabled: ${extra.enabled}\n`}conditions:
  - {id: c1, label: L1, variable: v1, op: ">=", value: ${extra.value ?? 7}, unit: u1}
  - {id: c2, label: L2, variable: v2, op: "<", value: 3, unit: u2}
combine:
  all: [c1, c2]
`;
}
function write(dir: string, name: string, content: string | Buffer): void {
  fs.writeFileSync(path.join(dir, name), content);
}
function dirWith(files: Record<string, string>): string {
  const d = tmp();
  for (const [n, c] of Object.entries(files)) write(d, n, c);
  return d;
}
function fails(dir: string, code: RuleLoadErrorCode): RuleLoadError {
  try {
    loadRuleSet(dir, opts);
  } catch (err) {
    assert.ok(err instanceof RuleLoadError, `got ${String(err)}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail("expected loadRuleSet to throw");
}

test("loads two rules sorted by id with meta in the same order", () => {
  const d = dirWith({ "b.yaml": yaml("b"), "a.yaml": yaml("a") });
  const r = loadRuleSet(d, opts);
  assert.deepEqual(
    r.ruleSet.map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    r.meta.map((m) => m.id),
    ["a", "b"],
  );
  assert.equal(r.meta[0]?.title, "Title a");
  assert.match(r.rule_set_version, /^rs-[0-9a-f]{16}$/);
  assert.equal(r.approval, "approved");
});

test("version ignores file order, comments, key order and whitespace", () => {
  const d1 = dirWith({ "a.yaml": yaml("a"), "b.yaml": yaml("b") });
  const reordered = `# comment
combine: {all: [c1, c2]}


conditions:
  - {unit: u1, value: 7, op: ">=", variable: v1, label: L1, id: c1}
  - {unit: u2, value: 3, op: "<", variable: v2, label: L2, id: c2}
clinical_approval: {guideline_version: g1, approver: Reviewer A, status: approved}
citation: {section: s1, version: v1, source: Demo source}
title: Title a
id: a
format_version: 1
`;
  const d2 = dirWith({ "b.yaml": yaml("b"), "a.yaml": reordered });
  assert.equal(
    loadRuleSet(d1, opts).rule_set_version,
    loadRuleSet(d2, opts).rule_set_version,
  );
});

test("renaming a file to a different valid id changes the version only through the id", () => {
  const v1 = loadRuleSet(dirWith({ "a.yaml": yaml("a") }), opts);
  const v2 = loadRuleSet(dirWith({ "z.yaml": yaml("z") }), opts);
  assert.notEqual(v1.rule_set_version, v2.rule_set_version);
  // same id in a different directory -> same version
  assert.equal(
    v1.rule_set_version,
    loadRuleSet(dirWith({ "a.yaml": yaml("a") }), opts).rule_set_version,
  );
});

test("any field change in a file changes the version", () => {
  const a = loadRuleSet(dirWith({ "a.yaml": yaml("a") }), opts);
  const b = loadRuleSet(dirWith({ "a.yaml": yaml("a", { value: 8 }) }), opts);
  assert.notEqual(a.rule_set_version, b.rule_set_version);
});

test("disabled rules are validated but excluded", () => {
  const off = loadRuleSet(
    dirWith({ "a.yaml": yaml("a"), "b.yaml": yaml("b", { enabled: false }) }),
    opts,
  );
  const off2 = loadRuleSet(
    dirWith({
      "a.yaml": yaml("a"),
      "b.yaml": yaml("b", { enabled: false, value: 99, status: "pending" }),
    }),
    opts,
  );
  assert.equal(off.ruleSet.length, 1);
  assert.equal(off.rule_set_version, off2.rule_set_version);
  assert.equal(off2.approval, "approved");
  const on = loadRuleSet(
    dirWith({ "a.yaml": yaml("a"), "b.yaml": yaml("b", { enabled: true }) }),
    opts,
  );
  assert.equal(on.ruleSet.length, 2);
  assert.notEqual(on.rule_set_version, off.rule_set_version);
  // a broken disabled file still fails the load
  const bad = yaml("b", { enabled: false }).replace('op: ">="', "oops: 1");
  const e = fails(
    dirWith({ "a.yaml": yaml("a"), "b.yaml": bad }),
    "unknown_key",
  );
  assert.equal(e.file, "b.yaml");
});

test("approval is pending if any active rule is pending", () => {
  const r = loadRuleSet(
    dirWith({
      "a.yaml": yaml("a"),
      "b.yaml": yaml("b", { status: "pending" }),
    }),
    opts,
  );
  assert.equal(r.approval, "pending");
  const ok = loadRuleSet(dirWith({ "a.yaml": yaml("a") }), opts);
  assert.equal(ok.approval, "approved");
});

test("rejects a file bigger than 65536 bytes", () => {
  const big = `${yaml("a")}#${"x".repeat(65537 - yaml("a").length - 1)}`;
  assert.equal(Buffer.byteLength(big), 65537);
  assert.equal(
    fails(dirWith({ "a.yaml": big }), "file_too_large").file,
    "a.yaml",
  );
  const exact = `${yaml("a")}#${"x".repeat(65536 - yaml("a").length - 1)}`;
  assert.equal(Buffer.byteLength(exact), 65536);
  loadRuleSet(dirWith({ "a.yaml": exact }), opts);
});

test("rejects 201 files before reading any", () => {
  const d = tmp();
  for (let i = 0; i < 201; i++) write(d, `r${i}.yaml`, "not yaml: [");
  fails(d, "too_many_files");
});

test("rejects subdirectory, symlink, .txt and .yml", () => {
  const sub = dirWith({ "a.yaml": yaml("a") });
  fs.mkdirSync(path.join(sub, "sub"));
  fails(sub, "unsupported_entry");
  const link = dirWith({ "a.yaml": yaml("a") });
  fs.symlinkSync(path.join(link, "a.yaml"), path.join(link, "b.yaml"));
  fails(link, "unsupported_entry");
  fails(dirWith({ "a.yaml": yaml("a"), "n.txt": "x" }), "unsupported_entry");
  fails(
    dirWith({ "a.yaml": yaml("a"), "b.yml": yaml("b") }),
    "unsupported_entry",
  );
});

test("rejects invalid UTF-8", () => {
  const d = tmp();
  write(d, "a.yaml", Buffer.from([0x23, 0xff, 0xfe, 0x0a]));
  fails(d, "not_utf8");
});

test("rejects file name differing from id", () => {
  const e = fails(dirWith({ "a.yaml": yaml("b") }), "file_id_mismatch");
  assert.equal(e.file, "a.yaml");
});

test("rejects duplicate id across files", () => {
  // Duplicates are detected before the file-name check, on the later file.
  const e = fails(
    dirWith({ "a.yaml": yaml("a"), "b.yaml": yaml("a") }),
    "duplicate_rule_id",
  );
  assert.equal(e.file, "b.yaml");
});

test("rejects no active rules", () => {
  fails(
    dirWith({ "a.yaml": yaml("a", { enabled: false }) }),
    "no_active_rules",
  );
  fails(tmp(), "no_active_rules");
});

test("an engine failure maps to invalid_rule with the engine code in detail", () => {
  const unknownVar = yaml("a").replace("variable: v1", "variable: vx");
  let e = fails(dirWith({ "a.yaml": unknownVar }), "invalid_rule");
  assert.equal(e.detail, "unknown_variable");
  assert.equal(e.file, "a.yaml");
  const dup = yaml("a").replace("{id: c2,", "{id: c1,");
  e = fails(dirWith({ "a.yaml": dup }), "invalid_rule");
  assert.equal(e.detail, "duplicate_id");
  const reserved = yaml("a")
    .replace("{id: c1,", "{id: combine.0,")
    .replace("[c1,", "[combine.0,");
  e = fails(dirWith({ "a.yaml": reserved }), "invalid_rule");
  assert.equal(e.detail, "invalid_condition");
});

test("bad op and empty conditions reach the engine", () => {
  const badOp = yaml("a").replace('op: ">="', "op: '!='");
  assert.equal(
    fails(dirWith({ "a.yaml": badOp }), "invalid_rule").detail,
    "invalid_condition",
  );
});

test("errors carry file, path, fixed message and never a YAML value", () => {
  const canary = "CANARY_ZQ9X";
  const cases = [
    yaml("a").replace("Demo source", `${canary}: [`),
    yaml("a").replace("title: Title a", `title: ${canary}\n${canary}: 1`),
    yaml("a").replace("variable: v1", `variable: ${canary}`),
    yaml("a").replace('op: ">="', `op: ${canary}`),
    yaml("a").replace("value: 7", `value: ${canary}`),
    `${yaml("a")}\n!${canary} x`,
  ];
  for (const c of cases) {
    try {
      loadRuleSet(dirWith({ "a.yaml": c }), opts);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof RuleLoadError);
      assert.equal(err.file, "a.yaml");
      assert.equal(typeof err.path, "string");
      const all = JSON.stringify([err.message, err.path, err.detail, err.file]);
      assert.ok(!all.includes(canary), all);
    }
  }
});

test("the loaded RuleSet evaluates", () => {
  const r = loadRuleSet(dirWith({ "a.yaml": yaml("a") }), opts);
  const hit = evaluateRuleSet(r.ruleSet, { v1: 9, v2: 1 });
  assert.deepEqual(hit.fired, ["a"]);
  assert.equal(hit.rules[0]?.result, true);
  const leaf = hit.rules[0]?.trace.find((t) => t.id === "c1");
  assert.ok(leaf && leaf.kind === "leaf" && leaf.observed === 9);
  assert.deepEqual(evaluateRuleSet(r.ruleSet, { v1: 1, v2: 1 }).fired, []);
});
