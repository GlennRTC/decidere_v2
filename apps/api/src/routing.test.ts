import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import type { Message } from "@decidere/schema";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES, interpretMessage } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const loaded = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

// Synthetic ids.
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const INSTANCE_ID_2 = "5d8a1e30-2c47-4b9f-8e16-7a03c5f2b9d4";

const UNITS: Record<string, string> = {
  resp_rate: "/min",
  sbp: "mm[Hg]",
  gcs: "{score}",
};
type Vars = Record<string, number>;
const instance = (id: string, vars: Vars) => ({
  instance_id: id,
  kind: "current",
  variables: Object.entries(vars).map(([variable, value]) => ({
    variable,
    value,
    unit: UNITS[variable],
    t_offset_min: 0,
  })),
});
const payload = (...all: Array<[string, Vars]>) => ({
  schema_version: "1.0",
  message_id: MESSAGE_ID,
  source: "sim-1",
  instances: all.map(([id, vars]) => instance(id, vars)),
});
const interpret = (vars: Vars, tau?: number) =>
  interpretMessage(
    payload([INSTANCE_ID, vars]) as unknown as Message,
    loaded,
    undefined,
    undefined,
    tau,
  ).results[0];

test("a complete normal case stays sin alerta at the default tau", () => {
  const r = interpret({ resp_rate: 14, sbp: 120, gcs: 15 });
  assert.equal(r.class, "sin alerta");
  assert.equal(r.certainty.value, 0.5);
  assert.equal(r.routed_from, null);
});

test("the same case goes to review when tau is 0.6", () => {
  const r = interpret({ resp_rate: 14, sbp: 120, gcs: 15 }, 0.6);
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.reason_code, "low_certainty");
  assert.equal(r.routed_from, "sin alerta");
  assert.equal(r.highest_reachable_class, "no_alert");
});

test("a near-threshold normal case goes to review at the default tau", () => {
  const r = interpret({ resp_rate: 21, sbp: 120, gcs: 15 });
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.routed_from, "sin alerta");
});

test("a vigilancia below tau goes to review and keeps its origin", () => {
  const r = interpret({ resp_rate: 22, sbp: 120, gcs: 15 });
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.routed_from, "vigilancia");
  assert.equal(r.highest_reachable_class, "watch");
});

test("a critical keeps its class below tau and keeps the flag", () => {
  const r = interpret({ resp_rate: 22, sbp: 80, gcs: 14 });
  assert.equal(r.class, "crítico");
  assert.equal(r.requires_confirmation, true);
  assert.equal(r.routed_from, null);
  assert.equal(r.reason_code, "rule_true");
});

test("a case already in review is not relabelled", () => {
  const r = interpret({ resp_rate: 30 });
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.routed_from, null);
  assert.notEqual(r.reason_code, "low_certainty");
});

test("tau 1 never changes a critical over the 27 qSOFA combinations", () => {
  const axes: Array<[string, Array<number | null>]> = [
    ["resp_rate", [30, 10, null]],
    ["sbp", [80, 130, null]],
    ["gcs", [10, 15, null]],
  ];
  let criticals = 0;
  for (const rr of axes[0][1])
    for (const sbp of axes[1][1])
      for (const gcs of axes[2][1]) {
        const vars: Vars = {};
        if (rr !== null) vars.resp_rate = rr;
        if (sbp !== null) vars.sbp = sbp;
        if (gcs !== null) vars.gcs = gcs;
        const base = interpret(vars);
        const strict = interpret(vars, 1);
        if (
          base.highest_reachable_class === "critical" &&
          base.class === "crítico"
        ) {
          criticals++;
          assert.equal(strict.class, "crítico", JSON.stringify(vars));
        }
      }
  assert.ok(criticals > 0);
});

test("siblings are routed independently", () => {
  const out = interpretMessage(
    payload(
      [INSTANCE_ID, { resp_rate: 21, sbp: 120, gcs: 15 }],
      [INSTANCE_ID_2, { resp_rate: 14, sbp: 120, gcs: 15 }],
    ) as unknown as Message,
    loaded,
  );
  assert.deepEqual(
    out.results.map((r) => r.class),
    ["revisión clínica", "sin alerta"],
  );
});

test("POST uses the tau given to buildApp", async () => {
  const app = buildApp({
    rules: loaded,
    allowedSources: new Set(["sim-1"]),
    tau: 0.6,
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(
      payload([INSTANCE_ID, { resp_rate: 14, sbp: 120, gcs: 15 }]),
    ),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.results[0].class, "revisión clínica");
  assert.equal(body.results[0].certainty.tau, 0.6);
});
