import assert from "node:assert/strict";
import { test } from "node:test";
import { validLocal } from "./fixtures.ts";
import { CANONICAL_BOUNDS } from "./index.ts";
import { validateMessage } from "./validate.ts";

function errorsOf(input: unknown) {
  const result = validateMessage(input);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors;
}

test("valid 1.1 message with decimals and null passes", () => {
  assert.equal(validateMessage(validLocal()).ok, true);
});

test("schema_version 1.2 is unsupported_version", () => {
  const input = { ...validLocal(), schema_version: "1.2" };
  assert.deepEqual(errorsOf(input), [
    { path: "/schema_version", code: "unsupported_version" },
  ]);
});

test("1.1 variable shape violations map to closed codes", () => {
  const cases: [string, (v: Record<string, unknown>) => void, string][] = [
    [
      "extra key",
      (v) => {
        v.variable = "sbp";
      },
      "unknown_field",
    ],
    [
      "33-char code",
      (v) => {
        v.code = "A".repeat(33);
      },
      "out_of_range",
    ],
    [
      "code with space",
      (v) => {
        v.code = "R R";
      },
      "invalid_format",
    ],
    [
      "unit with space",
      (v) => {
        v.unit = "m m";
      },
      "invalid_format",
    ],
    [
      "value 1e7",
      (v) => {
        v.value = 1e7;
      },
      "out_of_range",
    ],
    [
      "offset 1",
      (v) => {
        v.t_offset_min = 1;
      },
      "out_of_range",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    const input = validLocal();
    mutate(input.instances[0].variables[0]);
    const [error] = errorsOf(input);
    assert.equal(error.code, code, name);
  }
});

test("duplicate (code, t_offset_min) is duplicate_measurement", () => {
  const input = validLocal();
  input.instances[0].variables[1] = {
    code: "RR",
    value: 1,
    unit: "/min",
    t_offset_min: 0,
  };
  assert.deepEqual(errorsOf(input), [
    { path: "/instances/0/variables/1", code: "duplicate_measurement" },
  ]);
});

test("CANONICAL_BOUNDS comes from the 1.0 constants", () => {
  assert.deepEqual(CANONICAL_BOUNDS.get("gcs"), { min: 3, max: 15 });
  assert.deepEqual(CANONICAL_BOUNDS.get("resp_rate"), { min: 0, max: 200 });
  assert.deepEqual(CANONICAL_BOUNDS.get("sbp"), { min: 0, max: 400 });
});
