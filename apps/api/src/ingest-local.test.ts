import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";
import { DEFAULT_MAPPINGS_DIR, loadActiveMappings } from "./rules.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });
const mappings = loadActiveMappings(DEFAULT_MAPPINGS_DIR);
const JSON_CT = { "content-type": "application/json" };
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";

type Item = { code: string; value: number; unit: string };
const local = (variables: Item[], source = "sim-1") => ({
  schema_version: "1.1",
  message_id: MESSAGE_ID,
  source,
  instances: [
    {
      instance_id: INSTANCE_ID,
      kind: "current",
      variables: variables.map((v) => ({ ...v, t_offset_min: 0 })),
    },
  ],
});
const QSOFA: Item[] = [
  { code: "RR", value: 24, unit: "/min" },
  { code: "SBP", value: 13.3, unit: "kPa" },
  { code: "GCS", value: 15, unit: "{score}" },
];

function setup(sources = ["sim-1"]) {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const app = buildApp({
    logStream,
    rules,
    mappings,
    allowedSources: new Set(sources),
  });
  return { app, logs: () => chunks.join("") };
}
const post = (app: ReturnType<typeof setup>["app"], payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: JSON_CT,
    payload: JSON.stringify(payload),
  });

test("1.1 qSOFA with local codes and kPa is critical, versioned, nothing unmapped", async () => {
  const { app } = setup();
  const res = await post(app, local(QSOFA));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.results[0].class, "crítico");
  assert.match(body.mapping_version, /^map-[0-9a-f]{16}$/);
  assert.deepEqual(body.results[0].unmapped, []);
});

test("an unmapped code is visible in results and the case still classifies", async () => {
  const { app } = setup();
  const res = await post(
    app,
    local([...QSOFA, { code: "XYZ", value: 1, unit: "1" }]),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().results[0].unmapped, ["XYZ"]);
  assert.equal(res.json().results[0].class, "crítico");
});

test("an incompatible unit is 422 incompatible_unit and echoes nothing", async () => {
  const { app } = setup();
  const res = await post(
    app,
    local([{ code: "RR", value: 24, unit: "mg/dL" }]),
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, "validation_failed");
  assert.deepEqual(res.json().error.details, [
    { path: "/instances/0/variables/0", code: "incompatible_unit" },
  ]);
  assert.ok(!res.body.includes("mg/dL"));
  assert.ok(!res.body.includes("RR"));
});

test("an allowlisted source without a table is 200 with every code unmapped", async () => {
  const { app } = setup(["sim-1", "no-table"]);
  const res = await post(app, local(QSOFA, "no-table"));
  assert.equal(res.statusCode, 200);
  const r = res.json().results[0];
  assert.deepEqual(r.unmapped, ["RR", "SBP", "GCS"]);
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.highest_reachable_class, "critical");
});

test("an instance with only unmapped variables does not break the engine", async () => {
  const { app } = setup();
  const res = await post(app, local([{ code: "XYZ", value: 1, unit: "1" }]));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().results[0].unmapped, ["XYZ"]);
  assert.equal(res.json().results[0].class, "revisión clínica");
  assert.equal(res.json().results[0].highest_reachable_class, "critical");
});

test("a 1.0 message keeps its class and carries mapping_version", async () => {
  const { app } = setup();
  const res = await post(app, {
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: [
          { variable: "resp_rate", value: 24, unit: "/min", t_offset_min: 0 },
          { variable: "sbp", value: 95, unit: "mm[Hg]", t_offset_min: 0 },
          { variable: "gcs", value: 14, unit: "{score}", t_offset_min: 0 },
        ],
      },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().results[0].class, "crítico");
  assert.match(res.json().mapping_version, /^map-[0-9a-f]{16}$/);
});

test("the log stream never carries an unmapped code", async () => {
  const { app, logs } = setup();
  const res = await post(
    app,
    local([...QSOFA, { code: "ZZ-SENTINEL-1", value: 1, unit: "1" }]),
  );
  assert.equal(res.statusCode, 200);
  assert.ok(logs().includes("message interpreted"));
  assert.ok(!logs().includes("ZZ-SENTINEL-1"));
});
