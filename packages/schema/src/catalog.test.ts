import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_VARIABLES,
  CATALOG_VERSION,
  VARIABLE_CATALOG,
} from "./catalog.ts";

test("catalog has the eight variables", () => {
  assert.equal(CATALOG_VERSION, "catalog-1");
  assert.deepEqual(VARIABLE_CATALOG.map((e) => e.variable).sort(), [
    "bands_pct",
    "gcs",
    "heart_rate",
    "paco2",
    "resp_rate",
    "sbp",
    "temperature",
    "wbc",
  ]);
});

test("every loinc matches the LOINC code format", () => {
  for (const e of VARIABLE_CATALOG) assert.match(e.loinc, /^\d{1,7}-\d$/);
});

test("variable names and loinc codes are unique", () => {
  const names = new Set(VARIABLE_CATALOG.map((e) => e.variable));
  const codes = new Set(VARIABLE_CATALOG.map((e) => e.loinc));
  assert.equal(names.size, VARIABLE_CATALOG.length);
  assert.equal(codes.size, VARIABLE_CATALOG.length);
});

test("every entry has a source, a loinc name and a verified_on date", () => {
  for (const e of VARIABLE_CATALOG) {
    assert.ok(
      e.source.length > 0 && e.loinc_name.length > 0 && e.ucum.length > 0,
    );
    assert.match(e.verified_on, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("CANONICAL_VARIABLES equals the catalog variable names", () => {
  assert.deepEqual(
    [...CANONICAL_VARIABLES].sort(),
    VARIABLE_CATALOG.map((e) => e.variable).sort(),
  );
});

test("gcs unit is the UCUM annotation {score}", () => {
  assert.equal(
    VARIABLE_CATALOG.find((e) => e.variable === "gcs")?.ucum,
    "{score}",
  );
});
