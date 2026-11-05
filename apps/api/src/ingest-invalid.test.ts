import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });
const CANARY = "canaryzq9";

// Synthetic ids.
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";

type Json = Record<string, unknown> & {
  instances: { variables: Record<string, unknown>[]; [k: string]: unknown }[];
};
function valid(): Json {
  return {
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
  };
}

function setup() {
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
    allowedSources: new Set(["sim-1"]),
  });
  return { app, logs: () => chunks.join("") };
}

type Row = {
  name: string;
  status: number;
  code: string;
  details?: { path: string; code: string }[];
  method?: string;
  contentType?: string;
  payload: () => string;
};
const json = (m: Record<string, unknown>) => JSON.stringify(m);

const rows: Row[] = [
  {
    name: "unsupported schema_version",
    status: 422,
    code: "validation_failed",
    details: [{ path: "/schema_version", code: "unsupported_version" }],
    payload: () => json({ ...valid(), schema_version: "9.9" }),
  },
  {
    name: "missing instances",
    status: 422,
    code: "validation_failed",
    details: [{ path: "/instances", code: "required" }],
    payload: () => {
      const { instances: _i, ...rest } = valid();
      return json(rest);
    },
  },
  {
    name: "unknown top-level field named with the canary",
    status: 422,
    code: "validation_failed",
    details: [{ path: "", code: "unknown_field" }],
    payload: () => json({ ...valid(), [CANARY]: 1 }),
  },
  {
    name: "string value",
    status: 422,
    code: "validation_failed",
    details: [{ path: "/instances/0/variables/0/value", code: "invalid_type" }],
    payload: () => {
      const m = valid();
      m.instances[0].variables[0].value = CANARY;
      return json(m);
    },
  },
  {
    name: "resp_rate out of range",
    status: 422,
    code: "validation_failed",
    details: [{ path: "/instances/0/variables/0/value", code: "out_of_range" }],
    payload: () => {
      const m = valid();
      m.instances[0].variables[0].value = 9999;
      return json(m);
    },
  },
  {
    name: "duplicate (variable, offset)",
    status: 422,
    code: "validation_failed",
    details: [
      { path: "/instances/0/variables/3", code: "duplicate_measurement" },
    ],
    payload: () => {
      const m = valid();
      m.instances[0].variables.push({ ...m.instances[0].variables[0] });
      return json(m);
    },
  },
  {
    name: "empty instances",
    status: 422,
    code: "validation_failed",
    details: [{ path: "/instances", code: "out_of_range" }],
    payload: () => json({ ...valid(), instances: [] }),
  },
  {
    name: "malformed JSON with canary",
    status: 400,
    code: "invalid_json",
    payload: () => `{"a": ${CANARY}}`,
  },
  {
    name: "source outside the allowlist",
    status: 403,
    code: "forbidden",
    payload: () => json({ ...valid(), source: `${CANARY}-src` }),
  },
  {
    name: "body over the limit",
    status: 413,
    code: "payload_too_large",
    payload: () => json({ ...valid(), pad: CANARY.repeat(20000) }),
  },
  {
    name: "text/plain",
    status: 415,
    code: "unsupported_media_type",
    contentType: "text/plain",
    payload: () => CANARY,
  },
  {
    name: "PUT is not a route",
    status: 404,
    code: "not_found",
    method: "PUT",
    payload: () => json(valid()),
  },
];

for (const row of rows) {
  test(`invalid: ${row.name} -> ${row.status} ${row.code}, no canary anywhere`, async () => {
    const { app, logs } = setup();
    const res = await app.inject({
      method: (row.method ?? "POST") as "POST",
      url: "/v1/messages",
      headers: { "content-type": row.contentType ?? "application/json" },
      payload: row.payload(),
    });
    assert.equal(res.statusCode, row.status);
    const body = res.json().error;
    assert.equal(body.code, row.code);
    assert.equal(typeof body.message, "string");
    assert.ok(body.request_id);
    assert.equal(res.headers["x-request-id"], body.request_id);
    assert.equal(res.headers["cache-control"], "no-store");
    if (row.details) assert.deepEqual(body.details, row.details);
    else assert.equal(body.details, undefined);
    assert.ok(!res.body.includes(CANARY), "body");
    assert.ok(!JSON.stringify(res.headers).includes(CANARY), "headers");
    assert.ok(!logs().includes(CANARY), "logs");
  });
}
