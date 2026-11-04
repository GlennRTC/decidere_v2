import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleLoadError } from "./errors.ts";
import { parseRuleYaml } from "./parse.ts";

function codeOf(text: string): string {
  try {
    parseRuleYaml(text);
  } catch (err) {
    assert.ok(err instanceof RuleLoadError);
    return err.code;
  }
  return "accepted";
}

test("every explicit tag is rejected", () => {
  for (const text of [
    "value: !!int '5'\n",
    "value: !<tag:yaml.org,2002:int> '5'\n",
    "value: !!int '0x16'\n",
    "title: !!str 1\n",
    "enabled: !!bool 'true'\n",
    "a: !!map {b: 1}\n",
    "a: !!seq [1]\n",
    "a: !!str\n",
  ])
    assert.equal(codeOf(text), "yaml_tag", text);
});

test("an anchor alone is rejected as yaml_alias", () => {
  assert.equal(codeOf("title: &t T\n"), "yaml_alias");
  assert.equal(codeOf("a: &m {b: 1}\n"), "yaml_alias");
  assert.equal(codeOf("a: &s [1]\n"), "yaml_alias");
});

test("plain scalars, maps and sequences still load", () => {
  assert.deepEqual(
    parseRuleYaml("a: 5\nb: 'x'\nc: true\nd: [1, {e: null}]\n"),
    {
      a: 5,
      b: "x",
      c: true,
      d: [1, { e: null }],
    },
  );
});
