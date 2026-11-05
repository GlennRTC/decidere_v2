import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { MessageV11 } from "@decidere/schema";
import { mapMessage } from "./map.ts";
import {
  DEFAULT_MAPPINGS_DIR,
  DEFAULT_RULES_DIR,
  loadActiveMappings,
  loadActiveRules,
} from "./rules.ts";

const mappings = loadActiveMappings(DEFAULT_MAPPINGS_DIR);

type V = {
  code: string;
  value: number | null;
  unit: string;
  t_offset_min: number;
};
const v = (code: string, value: number | null, unit: string): V => ({
  code,
  value,
  unit,
  t_offset_min: 0,
});
const msg = (variables: V[]) =>
  ({
    schema_version: "1.1",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    source: "sim-1",
    instances: [
      {
        instance_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
        kind: "current",
        variables,
      },
    ],
  }) as MessageV11;

test("the five SIRS codes map to canonical variables, values unchanged", () => {
  const r = mapMessage(
    msg([
      v("HR", 95, "/min"),
      v("TEMP", 38.4, "Cel"),
      v("WBC", 13.2, "10*3/uL"),
      v("PACO2", 30, "mm[Hg]"),
      v("BANDS", 12, "%"),
    ]),
    mappings,
  );
  assert.ok(r.ok);
  const got = r.value.message.instances[0]?.variables.map((x) => [
    x.variable,
    x.value,
  ]);
  assert.deepEqual(got, [
    ["heart_rate", 95],
    ["temperature", 38.4],
    ["wbc", 13.2],
    ["paco2", 30],
    ["bands_pct", 12],
  ]);
  assert.deepEqual(r.value.unmapped, [[]]);
});

test("10*9/L converts to 10*3/uL with factor 1", () => {
  const r = mapMessage(msg([v("WBC", 13.2, "10*9/L")]), mappings);
  assert.ok(r.ok);
  assert.equal(r.value.message.instances[0]?.variables[0]?.value, 13.2);
});

const firstError = (variables: V[]) => {
  const r = mapMessage(msg(variables), mappings);
  assert.ok(!r.ok);
  return r.errors[0]?.code;
};

test("out-of-range and wrong-unit SIRS values are rejected", () => {
  assert.equal(firstError([v("TEMP", 100, "Cel")]), "out_of_range");
  assert.equal(firstError([v("BANDS", 101, "%")]), "out_of_range");
  assert.equal(firstError([v("HR", 95, "/h")]), "incompatible_unit");
  assert.equal(firstError([v("TEMP", null, "mg/dL")]), "incompatible_unit");
});

test("an unknown new code lands in unmapped", () => {
  const r = mapMessage(msg([v("XHR", 95, "/min")]), mappings);
  assert.ok(r.ok);
  assert.deepEqual(r.value.unmapped, [["XHR"]]);
});

test("the real sim-1 table has the five SIRS codes", () => {
  const table = mappings.tables.get("sim-1");
  for (const code of ["HR", "TEMP", "WBC", "PACO2", "BANDS"]) {
    assert.ok(table?.has(code), code);
  }
});

test("a rule may use a deliverable SIRS variable but not an unknown one", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  try {
    const src = fs.readFileSync(
      path.join(DEFAULT_RULES_DIR, "sepsis.qsofa.v1.yaml"),
      "utf8",
    );
    const file = path.join(tmp, "sepsis.qsofa.v1.yaml");
    fs.writeFileSync(
      file,
      src.replace("variable: resp_rate", "variable: heart_rate"),
    );
    assert.doesNotThrow(() => loadActiveRules(tmp));
    fs.writeFileSync(
      file,
      src.replace("variable: resp_rate", "variable: not_a_variable"),
    );
    assert.throws(() => loadActiveRules(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
