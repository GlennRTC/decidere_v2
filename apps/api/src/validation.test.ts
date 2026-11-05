import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { type ValidationError, validateMessage } from "@decidere/schema";
import { buildApp } from "./app.ts";
import { replyValidationFailed } from "./errors.ts";

const JSON_CT = { "content-type": "application/json" };

function valid(): Record<string, any> {
  return {
    schema_version: "1.0",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    source: "sim-1",
    instances: [
      {
        instance_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
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
  const app = buildApp({ logStream });
  app.post("/validate", async (request, reply) => {
    const r = validateMessage(request.body);
    return r.ok
      ? { ok: true }
      : replyValidationFailed(request, reply, r.errors);
  });
  app.post("/extra", async (request, reply) =>
    replyValidationFailed(request, reply, [
      {
        path: "/x",
        code: "invalid",
        extra: "canary-extra",
      } as unknown as ValidationError,
    ]),
  );
  const post = (payload: unknown, url = "/validate") =>
    app.inject({
      method: "POST",
      url,
      headers: JSON_CT,
      payload: JSON.stringify(payload),
    });
  return { app, post, log: () => chunks.join("") };
}

// Sends the body, asserts the closed 422 contract and no canary anywhere.
async function expect422(payload: unknown, details: unknown) {
  const { app, post, log } = setup();
  try {
    const res = await post(payload);
    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.equal(body.error.code, "validation_failed");
    assert.deepEqual(body.error.details, details);
    for (const d of body.error.details) {
      assert.deepEqual(Object.keys(d).sort(), ["code", "path"]);
    }
    const all = `${res.body}${JSON.stringify(res.headers)}${log()}`;
    assert.ok(!/canary/i.test(all));
  } finally {
    await app.close();
  }
}

test("valid message passes", async () => {
  const { app, post } = setup();
  try {
    const res = await post(valid());
    assert.equal(res.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("unknown key at root, instance and variable level is not echoed", async () => {
  const root = valid();
  root["canary-key-root"] = 1;
  await expect422(root, [{ path: "", code: "unknown_field" }]);
  const inst = valid();
  inst.instances[0]["canary-key-instance"] = 1;
  await expect422(inst, [{ path: "/instances/0", code: "unknown_field" }]);
  const v = valid();
  v.instances[0].variables[0]["canary-key-variable"] = 1;
  await expect422(v, [
    { path: "/instances/0/variables/0", code: "unknown_field" },
  ]);
});

test("invalid values are not reflected", async () => {
  const m = valid();
  m.source = "CANARY-VALUE";
  m.message_id = "canary";
  m.instances[0].kind = "canary-kind";
  m.instances[0].variables[0].value = "canary-string";
  m.instances[0].variables[0].unit = "canary-unit";
  const { app, post, log } = setup();
  try {
    const res = await post(m);
    assert.equal(res.statusCode, 422);
    const { details } = res.json().error;
    assert.ok(details.length > 0);
    for (const d of details) {
      assert.deepEqual(Object.keys(d).sort(), ["code", "path"]);
    }
    assert.ok(
      !/canary/i.test(`${res.body}${JSON.stringify(res.headers)}${log()}`),
    );
  } finally {
    await app.close();
  }
});

test("replyValidationFailed drops extra properties", async () => {
  const { app, post } = setup();
  try {
    const res = await post({}, "/extra");
    assert.equal(res.statusCode, 422);
    assert.ok(!res.body.includes("canary-extra"));
    assert.deepEqual(res.json().error.details, [
      { path: "/x", code: "invalid" },
    ]);
  } finally {
    await app.close();
  }
});

test("schema_version mismatch", async () => {
  const m = valid();
  m.schema_version = "2.0";
  await expect422(m, [
    { path: "/schema_version", code: "unsupported_version" },
  ]);
});

test("duplicate measurement", async () => {
  const m = valid();
  m.instances[0].variables.push({ ...m.instances[0].variables[0] });
  await expect422(m, [
    { path: "/instances/0/variables/3", code: "duplicate_measurement" },
  ]);
});

test("validation failure logs only code, status and count", async () => {
  const m = valid();
  m.source = "CANARY-VALUE";
  m.instances[0]["canary-key-instance"] = 1;
  const { app, post, log } = setup();
  try {
    await post(m);
    const lines = log()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((l) => l.apiError);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].apiError.code, "validation_failed");
    assert.equal(lines[0].apiError.status, 422);
    assert.deepEqual(Object.keys(lines[0].apiError).sort(), [
      "code",
      "count",
      "status",
    ]);
    assert.equal(typeof lines[0].apiError.count, "number");
    const text = log();
    assert.ok(!/canary/i.test(text));
    assert.ok(!text.includes("unknown_field"));
    assert.ok(!text.includes("/instances/0"));
  } finally {
    await app.close();
  }
});

test("top-level JSON array and string bodies", async () => {
  await expect422([], [{ path: "", code: "invalid_type" }]);
  await expect422("canary", [{ path: "", code: "invalid_type" }]);
});
