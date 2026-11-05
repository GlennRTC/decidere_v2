import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import type { Message } from "@decidere/schema";
import { CANONICAL_VARIABLES, interpretMessage } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const loaded = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

// Synthetic ids (random-looking v4 strings).
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const INSTANCE_ID_2 = "e47d0b93-2a5c-4c61-9f18-d36a85b02e4f";
const INSTANCE_ID_3 = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

type Vars = [string, number | null, number?][];
const UNITS: Record<string, string> = {
  resp_rate: "/min",
  sbp: "mm[Hg]",
  gcs: "{score}",
};
const inst = (id: string, kind: string, vars: Vars) => ({
  instance_id: id,
  kind,
  variables: vars.map(([variable, value, t = 0]) => ({
    variable,
    value,
    unit: UNITS[variable],
    t_offset_min: t,
  })),
});
const msg = (...instances: unknown[]) =>
  ({
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances,
  }) as unknown as Message;

test("qsofa 24/95/14 is crítico with sepsis.qsofa.v1 fired and a trace for each condition", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 24],
        ["sbp", 95],
        ["gcs", 14],
      ]),
    ),
    loaded,
  );
  const r = out.results[0];
  assert.equal(r.class, "crítico");
  assert.deepEqual(r.rules_fired, ["sepsis.qsofa.v1"]);
  const ids = r.trace[0].trace.map((t) => t.id);
  for (const id of ["fr_alta", "ta_baja", "gcs_bajo"])
    assert.ok(ids.includes(id));
  assert.equal(out.rule_set.version, loaded.rule_set_version);
  assert.equal(out.message_id, MESSAGE_ID);
});

test("all normal is sin alerta", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 14],
        ["sbp", 120],
        ["gcs", 15],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].class, "sin alerta");
});

test("all-null values is revisión clínica with highest_reachable_class critical", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", null],
        ["sbp", null],
        ["gcs", null],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].class, "revisión clínica");
  assert.equal(out.results[0].highest_reachable_class, "critical");
});

test("latest measurement wins: rr 30 at -60 then rr 12 at 0 yields rr 12", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 30, -60],
        ["resp_rate", 12, 0],
        ["sbp", 120],
        ["gcs", 15],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].class, "sin alerta");
});

test("three current instances give three results in order with distinct case_id", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 24],
        ["sbp", 95],
        ["gcs", 15],
      ]),
      inst(INSTANCE_ID_2, "current", [
        ["resp_rate", 14],
        ["sbp", 120],
        ["gcs", 15],
      ]),
      inst(INSTANCE_ID_3, "current", [
        ["resp_rate", 14],
        ["sbp", 120],
        ["gcs", 15],
      ]),
    ),
    loaded,
  );
  assert.deepEqual(
    out.results.map((r) => r.class),
    ["crítico", "sin alerta", "sin alerta"],
  );
  assert.equal(new Set(out.results.map((r) => r.case_id)).size, 3);
});

test("historical instances are not evaluated and are counted in historical_ignored", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 14],
        ["sbp", 120],
        ["gcs", 15],
      ]),
      inst(INSTANCE_ID_2, "historical", [
        ["resp_rate", 30],
        ["sbp", 80],
        ["gcs", 8],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results.length, 1);
  assert.equal(out.historical_ignored, 1);
});

test("output never contains instance_id", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 24],
        ["sbp", 95],
        ["gcs", 14],
      ]),
      inst(INSTANCE_ID_2, "historical", []),
    ),
    loaded,
  );
  const text = JSON.stringify(out);
  assert.ok(!text.includes(INSTANCE_ID) && !text.includes(INSTANCE_ID_2));
});

test("certainty is null and policy.provisional is true", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 24],
        ["sbp", 95],
        ["gcs", 14],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].certainty.provisional, true);
  assert.equal(out.policy.provisional, true);
  assert.equal(out.policy.version, "policy-provisional-1");
  assert.equal(out.rule_set.approval, "pending");
});

test("a later null does not erase an earlier measured value: rr 30 at -60, null at 0 stays crítico", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", null, 0],
        ["resp_rate", 30, -60],
        ["sbp", 95],
        ["gcs", 15],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].class, "crítico");
});

test("the latest value wins regardless of array order: t=0 listed first", () => {
  const out = interpretMessage(
    msg(
      inst(INSTANCE_ID, "current", [
        ["resp_rate", 12, 0],
        ["resp_rate", 30, -60],
        ["sbp", 120],
        ["gcs", 15],
      ]),
    ),
    loaded,
  );
  assert.equal(out.results[0].class, "sin alerta");
});
