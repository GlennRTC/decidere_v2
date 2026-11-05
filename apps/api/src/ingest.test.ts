import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });
const allowedSources = new Set(["sim-1"]);
const JSON_CT = { "content-type": "application/json" };

const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const INSTANCE_ID_2 = "e47d0b93-2a5c-4c61-9f18-d36a85b02e4f";

function instance(
  id: string,
  kind: string,
  rr: number,
  sbp: number,
  gcs: number,
) {
  return {
    instance_id: id,
    kind,
    variables: [
      { variable: "resp_rate", value: rr, unit: "/min", t_offset_min: 0 },
      { variable: "sbp", value: sbp, unit: "mm[Hg]", t_offset_min: 0 },
      { variable: "gcs", value: gcs, unit: "{score}", t_offset_min: 0 },
    ],
  };
}
function message(
  source = "sim-1",
  instances = [instance(INSTANCE_ID, "current", 24, 95, 14)],
) {
  return { schema_version: "1.0", message_id: MESSAGE_ID, source, instances };
}

function setup(over: Partial<{ rules: typeof rules }> = {}) {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const app = buildApp({
    logStream,
    rules: over.rules ?? rules,
    allowedSources,
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

test("200 returns class crítico, rules_fired, trace and rule_set.version", async () => {
  const { app } = setup();
  const res = await post(app, message());
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.results[0].class, "crítico");
  assert.deepEqual(body.results[0].rules_fired, ["sepsis.qsofa.v1"]);
  assert.ok(body.results[0].trace.length > 0);
  assert.match(body.rule_set.version, /^rs-/);
  assert.ok(!res.body.includes(INSTANCE_ID));
  assert.equal(res.headers["cache-control"], "no-store");
});

test("N current instances are all processed", async () => {
  const { app } = setup();
  const res = await post(
    app,
    message("sim-1", [
      instance(INSTANCE_ID, "current", 24, 95, 14),
      instance(INSTANCE_ID_2, "current", 14, 120, 15),
    ]),
  );
  assert.deepEqual(
    res.json().results.map((r: { class: string }) => r.class),
    ["crítico", "sin alerta"],
  );
});

test("source outside allowlist is 403 forbidden and the source value is not in the body or logs", async () => {
  const { app, logs } = setup();
  const res = await post(app, message("canary-src"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "forbidden");
  assert.ok(!res.body.includes("canary-src"));
  assert.ok(!logs().includes("canary-src"));
});

test("invalid message stays 422 validation_failed with details", async () => {
  const { app } = setup();
  const res = await post(app, { ...message(), schema_version: "9.9" });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, "validation_failed");
  assert.deepEqual(res.json().error.details, [
    { path: "/schema_version", code: "unsupported_version" },
  ]);
});

test("zero current instances is 422 with path /instances", async () => {
  const { app } = setup();
  const res = await post(
    app,
    message("sim-1", [instance(INSTANCE_ID, "historical", 24, 95, 14)]),
  );
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json().error.details, [
    { path: "/instances", code: "invalid_value" },
  ]);
});

test("logs contain message_id, case_id and class, and contain neither source, instance_id nor any observed value", async () => {
  const { app, logs } = setup();
  const res = await post(app, message());
  const caseId = res.json().results[0].case_id;
  const out = logs();
  assert.ok(out.includes(MESSAGE_ID));
  assert.ok(out.includes(caseId));
  assert.ok(out.includes("crítico"));
  assert.ok(!out.includes("sim-1"));
  assert.ok(!out.includes(INSTANCE_ID));
  assert.ok(!out.includes("observed"));
});

test("evaluation error is 500 internal_error with a fixed body", async () => {
  const { app } = setup({ rules: { ...rules, ruleSet: [] as never } });
  const res = await post(app, message());
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, "internal_error");
  assert.equal(res.json().error.message, "Internal server error.");
});

test("logs carry no engine input: no variable names, units or values", async () => {
  const { app, logs } = setup();
  await post(app, message());
  const out = logs();
  for (const leak of [
    "resp_rate",
    "sbp",
    "gcs",
    "mm[Hg]",
    "/min",
    "t_offset_min",
  ])
    assert.ok(!out.includes(leak), leak);
});
