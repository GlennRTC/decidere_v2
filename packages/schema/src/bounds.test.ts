import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIABLE_CATALOG } from "./catalog.ts";
import { CANONICAL_BOUNDS, DELIVERABLE_VARIABLES } from "./index.ts";
import { MESSAGE_VARIABLES } from "./message.schema.ts";

const EXPECTED: Record<string, { min: number; max: number }> = {
  resp_rate: { min: 0, max: 200 },
  sbp: { min: 0, max: 400 },
  gcs: { min: 3, max: 15 },
  heart_rate: { min: 0, max: 350 },
  temperature: { min: 25, max: 45 },
  wbc: { min: 0, max: 1000 },
  paco2: { min: 0, max: 300 },
  bands_pct: { min: 0, max: 100 },
};

test("canonical bounds match the table", () => {
  for (const [variable, bounds] of Object.entries(EXPECTED)) {
    assert.deepEqual(CANONICAL_BOUNDS.get(variable), bounds, variable);
  }
});

test("deliverable variables are the catalog variables", () => {
  assert.deepEqual(
    [...DELIVERABLE_VARIABLES].sort(),
    VARIABLE_CATALOG.map((e) => e.variable).sort(),
  );
  assert.deepEqual(
    [...DELIVERABLE_VARIABLES].sort(),
    Object.keys(EXPECTED).sort(),
  );
});

test("1.0 variables are deliverable", () => {
  for (const v of MESSAGE_VARIABLES) assert.ok(DELIVERABLE_VARIABLES.has(v), v);
});

test("every catalog variable has bounds", () => {
  for (const e of VARIABLE_CATALOG)
    assert.ok(CANONICAL_BOUNDS.has(e.variable), e.variable);
});
