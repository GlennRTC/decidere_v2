import assert from "node:assert/strict";
import { test } from "node:test";
import { strictJsonParse } from "./strict-json.ts";

const rejects = (text: string) =>
  assert.throws(
    () => strictJsonParse(text),
    (e: unknown) =>
      (e as { code?: string }).code === "FST_ERR_CTP_INVALID_JSON_BODY" &&
      (e as { statusCode?: number }).statusCode === 400,
  );

test("rejects 2e1", () => rejects('{"value":2e1}'));
test("rejects 1e-400", () => rejects('{"value":1e-400}'));
test("rejects 1E5", () => rejects("[1E5]"));
test("rejects duplicate key in nested object", () =>
  rejects('{"a":{"sbp":1,"sbp":2}}'));
test("rejects __proto__ and constructor keys", () => {
  rejects('{"__proto__":{}}');
  rejects('{"constructor":{"prototype":{}}}');
});
test("rejects invalid syntax with a fixed error that does not quote the text", () => {
  try {
    strictJsonParse('{"a": canary}');
    assert.fail("should throw");
  } catch (e) {
    assert.ok(!String((e as Error).message).includes("canary"));
    assert.equal(
      (e as { code?: string }).code,
      "FST_ERR_CTP_INVALID_JSON_BODY",
    );
  }
});
test("accepts exponent-like text and repeated keys across sibling objects", () => {
  assert.deepEqual(
    strictJsonParse('{"a":"2e1","b":[{"k":1},{"k":2}],"c":"\\"x\\":1"}'),
    {
      a: "2e1",
      b: [{ k: 1 }, { k: 2 }],
      c: '"x":1',
    },
  );
});
test("accepts a valid message-like body and integers/decimals without exponent", () => {
  assert.deepEqual(strictJsonParse('{"v":-12,"w":0.5,"n":null}'), {
    v: -12,
    w: 0.5,
    n: null,
  });
});

test("rejects a duplicate key when whitespace precedes the colon", () =>
  rejects('{"a" :1,"a":2}'));
test("rejects a plain duplicate key", () => rejects('{"a":1,"a":2}'));
test("accepts a string value equal to its key", () => {
  assert.deepEqual(strictJsonParse('{"a":"a"}'), { a: "a" });
});
test("rejects duplicates that differ only by escape", () => {
  rejects('{"a":1,"\\u0061":2}');
});
