import assert from "node:assert/strict";
import { test } from "node:test";
import { validMinimal, validQsofa, withHistorical } from "./fixtures.ts";
import type { Message } from "./index.ts";
import { validateMessage } from "./validate.ts";

test("valid minimal message passes", () => {
  const input = validMinimal();
  const result = validateMessage(input);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, input);
});

test("valid full qSOFA message passes (three variables, offsets 0, -5, -30)", () => {
  const result = validateMessage(validQsofa());
  assert.equal(result.ok, true);
});

test("value null is accepted", () => {
  const input = validQsofa();
  input.instances[0].variables[0].value = null;
  assert.equal(validateMessage(input).ok, true);
});

test("an instance with no variables is accepted", () => {
  assert.equal(validateMessage(validMinimal()).ok, true);
});

test("several instances (current + historical) pass", () => {
  assert.equal(validateMessage(withHistorical()).ok, true);
});

test("each unit is allowed only for its variable", () => {
  const table: [string, string, boolean][] = [
    ["resp_rate", "/min", true],
    ["resp_rate", "mm[Hg]", false],
    ["sbp", "kPa", false],
    ["gcs", "{score}", true],
  ];
  for (const [variable, unit, ok] of table) {
    const input = validMinimal();
    input.instances[0].variables = [
      { variable, value: 15, unit, t_offset_min: 0 },
    ];
    assert.equal(validateMessage(input).ok, ok, `${variable} ${unit}`);
  }
});

test("types: a valid Message literal typechecks", () => {
  const ok: Message = {
    schema_version: "1.0",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    source: "sim-1",
    instances: [
      {
        instance_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
        kind: "current",
        variables: [
          { variable: "gcs", value: 14, unit: "{score}", t_offset_min: 0 },
        ],
      },
    ],
  };
  const extra: Message = {
    ...ok,
    // @ts-expect-error extra property is not allowed
    note: "x",
  };
  const badKind: Message = {
    ...ok,
    instances: [
      {
        instance_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
        // @ts-expect-error bad kind
        kind: "future",
        variables: [],
      },
    ],
  };
  assert.ok(ok && extra && badKind);
});
