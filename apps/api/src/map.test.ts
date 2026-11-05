import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoadedMappings } from "@decidere/rules";
import type { Message, MessageV11 } from "@decidere/schema";
import { mapMessage } from "./map.ts";

const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const INSTANCE_ID_2 = "e47d0b93-2a5c-4c61-9f18-d36a85b02e4f";

const entry = (variable: string, conv: [string, number, number][] = []) => ({
  variable,
  conversions: new Map(
    conv.map(([u, factor, offset]) => [u, { factor, offset }]),
  ),
});
const mappings: LoadedMappings = {
  version: "map-test",
  tables: new Map([
    [
      "sim-1",
      new Map([
        ["RR", entry("resp_rate")],
        ["RESP", entry("resp_rate")],
        ["SBP", entry("sbp", [["kPa", 7.50062, 0]])],
        ["constructor", entry("gcs")],
      ]),
    ],
  ]),
};

type V = {
  code: string;
  value: number | null;
  unit: string;
  t_offset_min: number;
};
const msg = (
  variables: V[],
  source = "sim-1",
  kind: "current" | "historical" = "current",
): MessageV11 =>
  ({
    schema_version: "1.1",
    message_id: MESSAGE_ID,
    source,
    instances: [{ instance_id: INSTANCE_ID, kind, variables }],
  }) as MessageV11;
const v = (code: string, value: number | null, unit: string, t = 0): V => ({
  code,
  value,
  unit,
  t_offset_min: t,
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const x of Object.values(o)) deepFreeze(x);
    Object.freeze(o);
  }
  return o;
}

test("known code with canonical unit maps unchanged", () => {
  const r = mapMessage(msg([v("RR", 24, "/min")]), mappings);
  assert.ok(r.ok);
  assert.deepEqual(r.value.message.instances[0]?.variables, [
    { variable: "resp_rate", value: 24, unit: "/min", t_offset_min: 0 },
  ]);
  assert.deepEqual(r.value.unmapped, [[]]);
  assert.equal(r.value.mapping_version, "map-test");
});

test("converts kPa to mm[Hg]; null stays null", () => {
  const r = mapMessage(
    msg([v("SBP", 13.3, "kPa"), v("SBP", null, "kPa", -5)]),
    mappings,
  );
  assert.ok(r.ok);
  const vars = r.value.message.instances[0]?.variables;
  assert.ok(Math.abs((vars?.[0]?.value as number) - 99.75) < 0.05);
  assert.equal(vars?.[0]?.unit, "mm[Hg]");
  assert.equal(vars?.[1]?.value, null);
});

test("unknown and Object.prototype-named codes are unmapped, distinct, in order", () => {
  const r = mapMessage(
    msg([
      v("ZZ", 1, "x"),
      v("__proto__", 1, "x"),
      v("toString", 1, "x"),
      v("ZZ", 2, "x", -1),
      v("RR", 20, "/min"),
    ]),
    mappings,
  );
  assert.ok(r.ok);
  assert.deepEqual(r.value.unmapped, [["ZZ", "__proto__", "toString"]]);
  assert.equal(r.value.message.instances[0]?.variables.length, 1);
});

test("an own-table code named constructor still maps", () => {
  const r = mapMessage(msg([v("constructor", 15, "{score}")]), mappings);
  assert.ok(r.ok);
  assert.equal(r.value.message.instances[0]?.variables[0]?.variable, "gcs");
});

test("incompatible unit, also with null value", () => {
  for (const value of [24, null]) {
    const r = mapMessage(
      msg([v("RR", 20, "/min"), v("RR", value, "mg/dL", -1)]),
      mappings,
    );
    assert.deepEqual(r, {
      ok: false,
      errors: [{ path: "/instances/0/variables/1", code: "incompatible_unit" }],
    });
  }
});

test("converted value outside bounds is out_of_range", () => {
  const r = mapMessage(msg([v("SBP", 1e6, "kPa")]), mappings);
  assert.deepEqual(r, {
    ok: false,
    errors: [{ path: "/instances/0/variables/0", code: "out_of_range" }],
  });
});

test("non-finite converted value is out_of_range", () => {
  const big: LoadedMappings = {
    version: "m",
    tables: new Map([
      ["sim-1", new Map([["RR", entry("resp_rate", [["x", 1e308, 0]])]])],
    ]),
  };
  const r = mapMessage(msg([v("RR", 1e6, "x")]), big);
  assert.deepEqual(r, {
    ok: false,
    errors: [{ path: "/instances/0/variables/0", code: "out_of_range" }],
  });
});

test("two local codes on one canonical variable and offset is duplicate_measurement", () => {
  const r = mapMessage(
    msg([v("RR", 20, "/min"), v("RESP", 21, "/min")]),
    mappings,
  );
  assert.deepEqual(r, {
    ok: false,
    errors: [
      { path: "/instances/0/variables/1", code: "duplicate_measurement" },
    ],
  });
});

test("same variable at another offset is fine", () => {
  assert.ok(
    mapMessage(msg([v("RR", 20, "/min"), v("RESP", 21, "/min", -5)]), mappings)
      .ok,
  );
});

test("source without a table: everything unmapped", () => {
  const r = mapMessage(msg([v("RR", 20, "/min")], "other"), mappings);
  assert.ok(r.ok);
  assert.deepEqual(r.value.unmapped, [["RR"]]);
  assert.deepEqual(r.value.message.instances[0]?.variables, []);
});

test("historical instances are validated too", () => {
  const r = mapMessage(
    msg([v("RR", 20, "mg/dL")], "sim-1", "historical"),
    mappings,
  );
  assert.equal(r.ok, false);
});

test("1.0 input passes through unchanged", () => {
  const input: Message = {
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID_2,
        kind: "current",
        variables: [
          { variable: "resp_rate", value: 24, unit: "/min", t_offset_min: 0 },
        ],
      },
    ],
  } as Message;
  const r = mapMessage(input, mappings);
  assert.ok(r.ok);
  assert.deepEqual(r.value.message, input);
  assert.deepEqual(r.value.unmapped, [[]]);
  assert.equal(r.value.mapping_version, "map-test");
});

test("does not mutate its input", () => {
  const input = deepFreeze(
    msg([v("RR", 20, "/min"), v("SBP", 13.3, "kPa"), v("ZZ", 1, "x")]),
  );
  assert.ok(mapMessage(input, mappings).ok);
});
