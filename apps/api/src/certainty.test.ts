import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { VARIABLE_BANDS } from "@decidere/engine";
import { loadRuleSet } from "@decidere/rules";
import { DELIVERABLE_VARIABLES, type Message } from "@decidere/schema";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES, interpretMessage } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const loaded = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

// Synthetic ids.
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";

const UNITS: Record<string, string> = {
  resp_rate: "/min",
  sbp: "mm[Hg]",
  gcs: "{score}",
};
const payload = (vars: Record<string, number>) => ({
  schema_version: "1.0",
  message_id: MESSAGE_ID,
  source: "sim-1",
  instances: [
    {
      instance_id: INSTANCE_ID,
      kind: "current",
      variables: Object.entries(vars).map(([variable, value]) => ({
        variable,
        value,
        unit: UNITS[variable],
        t_offset_min: 0,
      })),
    },
  ],
});
const interpret = (vars: Record<string, number>) =>
  interpretMessage(payload(vars) as unknown as Message, loaded).results[0];

test("response carries the three components, their minimum, tau and the provisional marker", () => {
  const { certainty: c } = interpret({ resp_rate: 24, sbp: 95, gcs: 14 });
  assert.equal(c.completeness, 1);
  assert.equal(c.value, Math.min(c.completeness, c.margin, c.conflict));
  assert.equal(c.provisional, true);
  assert.equal(c.version, "certainty-provisional-2");
  assert.equal(typeof c.tau, "number");
});

test("missing gcs lowers completeness below 1 and keeps class crítico", () => {
  const r = interpret({ resp_rate: 30, sbp: 80 });
  assert.equal(r.class, "crítico");
  assert.ok(r.certainty.completeness < 1);
});

test("a normal complete case is sin alerta and requires_confirmation is false", () => {
  const r = interpret({ resp_rate: 14, sbp: 120, gcs: 15 });
  assert.equal(r.class, "sin alerta");
  assert.equal(r.requires_confirmation, false);
  assert.equal(r.certainty.value, 0.5);
});

test("critical with gcs 15 measured keeps margin 0.5 and is not flagged", () => {
  const r = interpret({ resp_rate: 30, sbp: 80, gcs: 15 });
  assert.equal(r.class, "crítico");
  assert.equal(r.certainty.value, 0.5);
  assert.equal(r.requires_confirmation, false);
});

test("critical on the resp_rate threshold is flagged requires_confirmation", () => {
  const r = interpret({ resp_rate: 22, sbp: 80, gcs: 14 });
  assert.equal(r.class, "crítico");
  assert.equal(r.certainty.margin, 0);
  assert.equal(r.requires_confirmation, true);
});

test("every DELIVERABLE_VARIABLES entry has a band in VARIABLE_BANDS", () => {
  for (const name of DELIVERABLE_VARIABLES)
    assert.ok(name in VARIABLE_BANDS, name);
});

test("POST /v1/messages returns certainty as an object and the log line carries a number", async () => {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const app = buildApp({
    logStream,
    rules: loaded,
    allowedSources: new Set(["sim-1"]),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(payload({ resp_rate: 24, sbp: 95, gcs: 14 })),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.results[0].certainty, "object");
  assert.equal(typeof body.results[0].requires_confirmation, "boolean");
  assert.equal(
    body.results[0].requires_confirmation,
    body.results[0].certainty.requires_confirmation,
  );
  const line = chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((l) => l.msg === "message interpreted");
  assert.equal(typeof line.results[0].certainty, "number");
});
