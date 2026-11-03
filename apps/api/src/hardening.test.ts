import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { validateMessage } from "@decidere/schema";
import { buildApp } from "./app.ts";
import { replyValidationFailed } from "./errors.ts";

const JSON_CT = { "content-type": "application/json" };

function setup(options: Parameters<typeof buildApp>[0] = {}) {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const app = buildApp({ logStream, ...options });
  app.post("/echo", async () => ({ ok: true }));
  return { app, text: () => chunks.join("") };
}

test("no-return validation reply logs a fixed msg and keeps the 422 contract", async () => {
  const { app, text } = setup();
  app.post("/v-noreturn", async (request, reply) => {
    const r = validateMessage(request.body);
    if (!r.ok) replyValidationFailed(request, reply, r.errors);
    return { ok: true };
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v-noreturn?canary=q",
      headers: JSON_CT,
      payload: "[]",
    });
    assert.equal(res.statusCode, 422);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "validation_failed");
    assert.equal(body.error.request_id, res.headers["x-request-id"]);
    assert.equal(res.headers["cache-control"], "no-store");
    const lines = text()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.msg === "request error"));
    for (const l of lines) assert.ok(!String(l.msg).includes("canary"));
  } finally {
    await app.close();
  }
});

test("V8 JSON fragment in a syntax error never leaks", async () => {
  const { app, text } = setup();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: '{"a": canary}',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, "invalid_json");
    assert.ok(!res.body.includes("canary"));
    assert.ok(!JSON.stringify(res.headers).includes("canary"));
    assert.ok(!text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("default body limit boundary is exactly 262144 bytes", async () => {
  const { app } = setup();
  const wrapper = '{"a":""}'.length;
  const exact = JSON.stringify({ a: "x".repeat(262144 - wrapper) });
  assert.equal(Buffer.byteLength(exact), 262144);
  try {
    const ok = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: exact,
    });
    assert.equal(ok.statusCode, 200);
    const over = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: JSON.stringify({ a: "x".repeat(262144 - wrapper + 1) }),
    });
    assert.equal(over.statusCode, 413);
  } finally {
    await app.close();
  }
});

test("hostile thrown objects return exactly 500", async () => {
  const { app } = setup();
  const boom = () => {
    throw new Error("canary-getter");
  };
  const hostile: Record<string, () => unknown> = {
    "/h-status": () => ({
      get statusCode() {
        return boom();
      },
    }),
    "/h-name": () => ({
      get name() {
        return boom();
      },
    }),
    "/h-code": () => ({
      get code() {
        return boom();
      },
    }),
    "/h-proxy": () => new Proxy({}, { get: boom, has: boom }),
    "/h-nan": () => ({ statusCode: Number.NaN }),
    "/h-frac": () => ({ statusCode: 400.5 }),
    "/h-big": () => ({ statusCode: 99999 }),
    "/h-proto": () => ({ code: "__proto__" }),
    "/h-ctor": () => ({ code: "constructor" }),
  };
  for (const [url, make] of Object.entries(hostile)) {
    app.get(url, () => {
      throw make();
    });
  }
  try {
    for (const url of Object.keys(hostile)) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 500, url);
      assert.equal(JSON.parse(res.body).error.code, "internal_error", url);
    }
  } finally {
    await app.close();
  }
});

test("422 carries request id and no-store", async () => {
  const { app } = setup();
  app.post("/validate", async (request, reply) => {
    const r = validateMessage(request.body);
    return r.ok
      ? { ok: true }
      : replyValidationFailed(request, reply, r.errors);
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/validate",
      headers: JSON_CT,
      payload: "{}",
    });
    assert.equal(res.statusCode, 422);
    assert.equal(
      JSON.parse(res.body).error.request_id,
      res.headers["x-request-id"],
    );
    assert.equal(res.headers["cache-control"], "no-store");
  } finally {
    await app.close();
  }
});
