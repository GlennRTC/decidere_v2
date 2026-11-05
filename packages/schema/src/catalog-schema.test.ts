import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIABLE_CATALOG } from "./catalog.ts";
import { validMinimal } from "./fixtures.ts";
import { MESSAGE_VARIABLES } from "./message.schema.ts";
import { validateMessage } from "./validate.ts";

const IN_SCHEMA = [...MESSAGE_VARIABLES];

function messageWith(variable: string, unit: string) {
  const m = validMinimal();
  m.instances[0].variables = [{ variable, value: 15, unit, t_offset_min: 0 }];
  return m;
}

test("schema units match the catalog", () => {
  for (const name of IN_SCHEMA) {
    const ucum = VARIABLE_CATALOG.find((e) => e.variable === name)?.ucum ?? "";
    assert.equal(validateMessage(messageWith(name, ucum)).ok, true, name);
    assert.equal(
      validateMessage(messageWith(name, `${ucum}x`)).ok,
      false,
      name,
    );
  }
});

test("schema variables are a subset of the catalog", () => {
  const catalog = new Set(VARIABLE_CATALOG.map((e) => e.variable));
  for (const name of IN_SCHEMA) assert.ok(catalog.has(name), name);
});
