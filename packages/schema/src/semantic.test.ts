import assert from "node:assert/strict";
import { test } from "node:test";
import { validQsofa, withHistorical } from "./fixtures.ts";
import { currentInstances, validateMessage } from "./index.ts";

const rr = (t: number) => ({
  variable: "resp_rate",
  value: 20,
  unit: "/min",
  t_offset_min: t,
});

test("same variable and same offset in one instance is rejected", () => {
  const input = validQsofa();
  input.instances[0].variables.push(rr(0)); // index 3 duplicates index 0
  const result = validateMessage(input);
  assert.deepEqual(result, {
    ok: false,
    errors: [
      { path: "/instances/0/variables/3", code: "duplicate_measurement" },
    ],
  });
});

test("same variable with different offsets is accepted", () => {
  const input = validQsofa();
  input.instances[0].variables.push(rr(-10));
  assert.equal(validateMessage(input).ok, true);
});

test("same offset with different variables is accepted", () => {
  const input = validQsofa();
  input.instances[0].variables = [
    rr(-5),
    { variable: "sbp", value: 100, unit: "mm[Hg]", t_offset_min: -5 },
    { variable: "gcs", value: 15, unit: "{score}", t_offset_min: -5 },
  ];
  assert.equal(validateMessage(input).ok, true);
});

test("same variable and offset in different instances is accepted", () => {
  const input = withHistorical();
  input.instances[1].variables = [rr(0)];
  assert.equal(validateMessage(input).ok, true);
});

test("variable order does not matter", () => {
  const input = validQsofa();
  input.instances[0].variables.reverse();
  assert.equal(validateMessage(input).ok, true);
  const dup = validQsofa();
  dup.instances[0].variables.push(rr(0));
  dup.instances[0].variables.reverse();
  const result = validateMessage(dup);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors[0].code, "duplicate_measurement");
});

test("historical instances are validated with the full strict shape", () => {
  const input = withHistorical();
  (input.instances[1].variables[0] as { unit: string }).unit = "kPa";
  assert.equal(validateMessage(input).ok, false);
  const dup = withHistorical();
  dup.instances[1].variables.push(rr(-240));
  const result = validateMessage(dup);
  assert.deepEqual(result, {
    ok: false,
    errors: [
      { path: "/instances/1/variables/1", code: "duplicate_measurement" },
    ],
  });
});

test("currentInstances ignores historical", () => {
  const withH = validateMessage(withHistorical());
  const without = validateMessage(validQsofa());
  assert.ok(withH.ok && without.ok);
  if (withH.ok && without.ok) {
    assert.equal(currentInstances(withH.value).length, 1);
    assert.deepEqual(
      currentInstances(withH.value),
      currentInstances(without.value),
    );
  }
});

test("a message with only historical instances is valid and yields no current instances", () => {
  // Meaning of "no current instance" is decided by the evaluator (F040).
  const input = withHistorical();
  input.instances.shift();
  const result = validateMessage(input);
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(currentInstances(result.value), []);
});

test("diagnoses_icd10 is rejected as unknown_field (deferred to F044)", () => {
  const input = { ...validQsofa(), diagnoses_icd10: ["A41.9"] };
  assert.deepEqual(validateMessage(input), {
    ok: false,
    errors: [{ path: "", code: "unknown_field" }],
  });
});

test("no date-like or free-text field is accepted anywhere", () => {
  for (const key of ["note", "label", "created_at"]) {
    const top = { ...validQsofa(), [key]: "x" };
    assert.equal(validateMessage(top).ok, false, `top ${key}`);
    const inst = validQsofa();
    Object.assign(inst.instances[0], { [key]: "x" });
    assert.equal(validateMessage(inst).ok, false, `instance ${key}`);
    const variable = validQsofa();
    Object.assign(variable.instances[0].variables[0], { [key]: "x" });
    assert.equal(validateMessage(variable).ok, false, `variable ${key}`);
  }
});
