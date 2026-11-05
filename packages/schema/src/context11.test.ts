import assert from "node:assert/strict";
import { test } from "node:test";
import { validLocal, validLocalWithContext } from "./fixtures.ts";
import { validateMessage } from "./validate.ts";

function errorsOf(input: unknown) {
  const result = validateMessage(input);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors;
}

function withContext(patch: (instance: Record<string, unknown>) => void) {
  const message = validLocalWithContext();
  patch(message.instances[0] as Record<string, unknown>);
  return message;
}

test("1.1 instance with orders and ICD-10 codes is valid", () => {
  assert.equal(validateMessage(validLocalWithContext()).ok, true);
});

test("empty orders and diagnoses are valid", () => {
  const message = withContext((i) => {
    i.orders = [];
    i.diagnoses_icd10 = [];
  });
  assert.equal(validateMessage(message).ok, true);
});

test("context violations map to closed codes, indices only", () => {
  const cases: [
    string,
    (i: Record<string, unknown>) => void,
    string,
    string,
  ][] = [
    [
      "free text",
      (i) => {
        i.diagnoses_icd10 = ["A41.9 patient"];
      },
      "/instances/0/diagnoses_icd10/0",
      "invalid_format",
    ],
    [
      "lowercase",
      (i) => {
        i.diagnoses_icd10 = ["a41.9"];
      },
      "/instances/0/diagnoses_icd10/0",
      "invalid_format",
    ],
    [
      "21 codes",
      (i) => {
        // A00..A20 all match the pattern: the only error is maxItems
        i.diagnoses_icd10 = Array.from(
          { length: 21 },
          (_, n) => `A${String(n).padStart(2, "0")}`,
        );
      },
      "/instances/0/diagnoses_icd10",
      "out_of_range",
    ],
    [
      "duplicate",
      (i) => {
        i.diagnoses_icd10 = ["A41.9", "A41.9"];
      },
      "/instances/0/diagnoses_icd10",
      "invalid_value",
    ],
    [
      "21 orders",
      (i) => {
        i.orders = Array.from({ length: 21 }, () => ({
          type: "antibiotic",
          t_offset_min: 0,
        }));
      },
      "/instances/0/orders",
      "out_of_range",
    ],
    [
      "bad type",
      (i) => {
        i.orders = [{ type: "x", t_offset_min: 0 }];
      },
      "/instances/0/orders/0/type",
      "invalid_value",
    ],
    [
      "extra key",
      (i) => {
        i.orders = [{ type: "antibiotic", t_offset_min: 0, note: "x" }];
      },
      "/instances/0/orders/0",
      "unknown_field",
    ],
    [
      "future offset",
      (i) => {
        i.orders = [{ type: "antibiotic", t_offset_min: 1 }];
      },
      "/instances/0/orders/0/t_offset_min",
      "out_of_range",
    ],
    [
      "missing type",
      (i) => {
        i.orders = [{ t_offset_min: 0 }];
      },
      "/instances/0/orders/0/type",
      "required",
    ],
  ];
  for (const [name, patch, path, code] of cases) {
    const errors = errorsOf(withContext(patch));
    assert.deepEqual(errors, [{ path, code }], name);
    assert.ok(!JSON.stringify(errors).includes("patient"), name);
  }
});

test("1.0 rejects orders and diagnoses_icd10 as unknown_field", () => {
  const base = {
    schema_version: "1.0",
    message_id: validLocal().message_id,
    source: "sim-1",
    instances: [
      {
        instance_id: validLocal().instances[0]?.instance_id,
        kind: "current",
        variables: [],
      },
    ],
  };
  for (const [key, value] of [
    ["orders", []],
    ["diagnoses_icd10", []],
  ] as const) {
    const input = structuredClone(base) as Record<string, unknown>;
    (input.instances as [Record<string, unknown>])[0][key] = value;
    assert.deepEqual(errorsOf(input), [
      { path: "/instances/0", code: "unknown_field" },
    ]);
  }
});
