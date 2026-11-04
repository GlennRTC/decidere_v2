import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

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
const send = (
  app: ReturnType<typeof setup>["app"],
  contentType: string,
  payload: string,
) =>
  app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { "content-type": contentType },
    payload,
  });

test("text/plain is 415", async () => {
  const { app } = setup();
  const res = await send(app, "text/plain", "{}");
  assert.equal(res.statusCode, 415);
  assert.equal(res.json().error.code, "unsupported_media_type");
});

test("application/json; charset=latin1 is 415", async () => {
  const { app } = setup();
  const res = await send(app, "application/json; charset=latin1", "{}");
  assert.equal(res.statusCode, 415);
});

test("application/json; charset=utf-8 is accepted", async () => {
  const { app } = setup();
  const res = await send(app, "application/json; charset=utf-8", "{}");
  assert.equal(res.statusCode, 422); // parsed; fails validation
});

test("invalid body with canary string leaves no canary in logs", async () => {
  const { app, logs } = setup();
  const res = await send(app, "application/json", '{"a": canaryxyz}');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "invalid_json");
  assert.ok(!res.body.includes("canaryxyz"));
  assert.ok(!logs().includes("canaryxyz"));
});

test("exponent notation in a value is invalid_json", async () => {
  const { app } = setup();
  const res = await send(
    app,
    "application/json",
    '{"schema_version":"1.0","x":1e-400}',
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "invalid_json");
});

test("body over 131072 bytes is 413", async () => {
  const { app } = setup();
  const res = await send(
    app,
    "application/json",
    JSON.stringify({ a: "x".repeat(131073) }),
  );
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().error.code, "payload_too_large");
});
