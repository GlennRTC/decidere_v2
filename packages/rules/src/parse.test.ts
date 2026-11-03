import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { parseRuleYaml } from "./parse.ts";

function codeOf(text: string): { code: RuleLoadErrorCode; err: RuleLoadError } {
  try {
    parseRuleYaml(text);
  } catch (err) {
    assert.ok(
      err instanceof RuleLoadError,
      `expected RuleLoadError, got ${String(err)}`,
    );
    return { code: err.code, err };
  }
  assert.fail("expected parseRuleYaml to throw");
}

test("parses a plain document to a JS object", () => {
  assert.deepEqual(parseRuleYaml("a: 1\nb: [x, y]\n"), { a: 1, b: ["x", "y"] });
});

test("rejects an alias without expanding it", () => {
  assert.equal(codeOf("a: &x [1]\nb: *x\n").code, "yaml_alias");
  const lines = ["l0: &l0 [a, a, a, a, a, a, a, a, a]"];
  for (let i = 1; i <= 10; i++) {
    const refs = Array.from({ length: 9 }, () => `*l${i - 1}`).join(", ");
    lines.push(`l${i}: &l${i} [${refs}]`);
  }
  const bomb = `${lines.join("\n")}\n`;
  assert.ok(bomb.length < 2048);
  const start = Date.now();
  assert.equal(codeOf(bomb).code, "yaml_alias");
  assert.ok(Date.now() - start < 1000);
});

test("rejects duplicate keys", () => {
  assert.equal(codeOf("a: 1\na: 2\n").code, "yaml_duplicate_key");
});

test("rejects several documents", () => {
  assert.equal(codeOf("a: 1\n---\nb: 2\n").code, "yaml_multiple_documents");
});

test("rejects unknown and standard tags", () => {
  assert.equal(codeOf("a: !foo 1\n").code, "yaml_tag");
  assert.equal(codeOf("a: !!js/function 'x'\n").code, "yaml_tag");
});

test("rejects a syntax error", () => {
  const { code, err } = codeOf("a: [1, 2\nb: : :\n");
  assert.equal(code, "yaml_syntax");
  assert.equal(typeof err.line, "number");
  assert.equal(err.message, codeOf("a: [1, 2\nb: : :\n").err.message);
});

test("10 000 nested flow sequences raise RuleLoadError, not RangeError", () => {
  const text = `a: ${"[".repeat(10000)}${"]".repeat(10000)}\n`;
  const { code } = codeOf(text);
  assert.ok(["yaml_syntax", "yaml_alias"].includes(code));
});

test("__proto__ stays an own key and does not pollute", () => {
  const result = parseRuleYaml("__proto__: 1\nx: 2\n") as Record<
    string,
    unknown
  >;
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("a leading BOM is accepted; 1.2 numbers: 010 -> 10, 0x16 -> 22, 1e3 -> 1000, 22.0 -> 22", () => {
  assert.deepEqual(parseRuleYaml("﻿a: 010\nb: 0x16\nc: 1e3\nd: 22.0\n"), {
    a: 10,
    b: 22,
    c: 1000,
    d: 22,
  });
});

test("no message or detail contains a canary string placed in a key, a value or a tag", () => {
  const canary = "CANARY_zq7";
  const docs = [
    `${canary}: 1\n${canary}: 2\n`,
    `a: !${canary} 1\n`,
    `a: &${canary} 1\nb: *${canary}\n`,
    `a: [${canary}\nb: : ${canary}\n`,
    `${canary}: 1\n---\n${canary}: 2\n`,
  ];
  for (const doc of docs) {
    const { err } = codeOf(doc);
    assert.ok(!err.message.includes(canary));
    assert.ok(!(err.detail ?? "").includes(canary));
    assert.ok(!err.path.includes(canary));
  }
});
