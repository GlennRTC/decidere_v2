import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { buildApp } from "./app.ts";
import { codeFor, MESSAGES } from "./errors.ts";

function collectLog() {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { logStream, text: () => chunks.join("") };
}

function appWithRoutes(options: Parameters<typeof buildApp>[0] = {}) {
  const log = collectLog();
  const app = buildApp({ logStream: log.logStream, ...options });
  app.post("/echo", async () => ({ ok: true }));
  app.get("/throw-string", () => {
    throw "canary-string";
  });
  app.get("/throw-null", () => {
    throw null;
  });
  app.get("/throw-object", () => {
    throw { message: "canary-object" };
  });
  app.get("/reject-string", async () => {
    throw "canary-reject";
  });
  app.get("/teapot", () => {
    const e = Object.assign(new Error("canary-418"), { statusCode: 418 });
    throw e;
  });
  return { app, log };
}

const JSON_CT = { "content-type": "application/json" };

test("malformed JSON returns invalid_json and echoes nothing", async () => {
  const { app, log } = appWithRoutes();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: '{"canary-key": ',
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "invalid_json");
    assert.equal(body.error.message, MESSAGES.invalid_json);
    assert.ok(!res.body.includes("canary"));
    assert.ok(!log.text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("empty JSON body returns invalid_json", async () => {
  const { app } = appWithRoutes();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: "",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, "invalid_json");
  } finally {
    await app.close();
  }
});

test("__proto__ and constructor keys return invalid_json without pollution", async () => {
  const { app } = appWithRoutes();
  try {
    for (const payload of [
      '{"__proto__":{"polluted":1}}',
      '{"constructor":{"prototype":{"polluted":1}}}',
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/echo",
        headers: JSON_CT,
        payload,
      });
      assert.equal(res.statusCode, 400);
      assert.equal(JSON.parse(res.body).error.code, "invalid_json");
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally {
    await app.close();
  }
});

test("oversized body returns payload_too_large", async () => {
  const { app } = appWithRoutes({ bodyLimit: 100 });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: JSON.stringify({ a: "x".repeat(200) }),
    });
    assert.equal(res.statusCode, 413);
    assert.equal(JSON.parse(res.body).error.code, "payload_too_large");
  } finally {
    await app.close();
  }
});

test("default bodyLimit is 262144", async () => {
  const { app } = appWithRoutes();
  try {
    const big = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: JSON.stringify({ a: "x".repeat(300_000) }),
    });
    assert.equal(big.statusCode, 413);
    const ok = await app.inject({
      method: "POST",
      url: "/echo",
      headers: JSON_CT,
      payload: JSON.stringify({ a: "x".repeat(200_000) }),
    });
    assert.equal(ok.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("hostile content-type returns unsupported_media_type without echo", async () => {
  const { app, log } = appWithRoutes();
  try {
    const hostile = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "text/canary-type" },
      payload: "{}",
    });
    assert.equal(hostile.statusCode, 415);
    assert.equal(JSON.parse(hostile.body).error.code, "unsupported_media_type");
    assert.ok(!hostile.body.includes("canary"));
    const missing = await app.inject({
      method: "POST",
      url: "/echo",
      payload: "{}",
    });
    assert.equal(missing.statusCode, 415);
    assert.equal(JSON.parse(missing.body).error.code, "unsupported_media_type");
    assert.ok(!log.text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("thrown non-Error values produce the generic 500", async () => {
  const { app, log } = appWithRoutes();
  try {
    for (const url of [
      "/throw-string",
      "/throw-null",
      "/throw-object",
      "/reject-string",
    ]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 500, url);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, "internal_error");
      assert.equal(body.error.request_id, res.headers["x-request-id"]);
      assert.ok(!res.body.includes("canary"));
    }
    assert.ok(!log.text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("every error carries a request id and no-store", async () => {
  const { app } = appWithRoutes({ bodyLimit: 100 });
  try {
    const responses = [
      [
        400,
        await app.inject({
          method: "POST",
          url: "/echo",
          headers: JSON_CT,
          payload: "{",
        }),
      ],
      [404, await app.inject({ method: "GET", url: "/nope" })],
      [
        413,
        await app.inject({
          method: "POST",
          url: "/echo",
          headers: JSON_CT,
          payload: JSON.stringify({ a: "x".repeat(200) }),
        }),
      ],
      [
        415,
        await app.inject({
          method: "POST",
          url: "/echo",
          headers: { "content-type": "text/canary-type" },
          payload: "x",
        }),
      ],
      [500, await app.inject({ method: "GET", url: "/throw-string" })],
    ] as const;
    for (const [status, res] of responses) {
      assert.equal(res.statusCode, status);
      assert.equal(
        JSON.parse(res.body).error.request_id,
        res.headers["x-request-id"],
      );
      assert.equal(res.headers["cache-control"], "no-store");
    }
  } finally {
    await app.close();
  }
});

test("unmapped 4xx falls back to bad_request", async () => {
  const { app, log } = appWithRoutes();
  try {
    const res = await app.inject({ method: "GET", url: "/teapot" });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, "bad_request");
    assert.ok(!res.body.includes("canary"));
    assert.ok(!log.text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("codeFor is total over any thrown value", () => {
  for (const v of [undefined, null, "x", {}, { statusCode: "400" }]) {
    assert.equal(codeFor(v), "internal_error");
  }
  assert.equal(
    codeFor({ statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE" }),
    "payload_too_large",
  );
  assert.equal(codeFor({ statusCode: 404 }), "bad_request");
});

test("a parsed body is never logged when the handler throws", async () => {
  const { app, log } = appWithRoutes();
  app.post("/boom", async () => {
    throw new Error("boom");
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/boom?q=canary-query",
      headers: { ...JSON_CT, "x-canary": "canary-header" },
      payload: '{"canary-key":"canary-value"}',
    });
    assert.equal(res.statusCode, 500);
    assert.ok(!res.body.includes("canary"));
    assert.ok(!log.text().includes("canary"));
  } finally {
    await app.close();
  }
});

test("hostile thrown objects map to the closed contract", async () => {
  const { app, log } = appWithRoutes();
  const throwing = () => {
    throw new Error("canary-getter");
  };
  const hostile: Record<string, () => unknown> = {
    "/h-status": () => ({
      get statusCode() {
        return throwing();
      },
      message: "canary-msg",
    }),
    "/h-name": () => ({
      get name() {
        return throwing();
      },
      message: "canary-msg",
    }),
    "/h-code": () => ({
      get code() {
        return throwing();
      },
    }),
    "/h-proxy": () =>
      new Proxy(
        {},
        {
          get: throwing,
          has: throwing,
          getPrototypeOf: throwing,
        },
      ),
    "/h-nan": () => ({ statusCode: Number.NaN, message: "canary-msg" }),
    "/h-frac": () => ({ statusCode: 400.5, message: "canary-msg" }),
    "/h-big": () => ({ statusCode: 99999, message: "canary-msg" }),
    "/h-proto": () => ({ code: "__proto__", message: "canary-msg" }),
    "/h-ctor": () => ({ code: "constructor", message: "canary-msg" }),
  };
  for (const [url, make] of Object.entries(hostile)) {
    app.get(url, () => {
      throw make();
    });
  }
  try {
    for (const url of Object.keys(hostile)) {
      const res = await app.inject({ method: "GET", url });
      const body = JSON.parse(res.body);
      assert.ok(res.statusCode === 500 || res.statusCode === 400, url);
      assert.equal(
        body.error.code,
        res.statusCode === 400 ? "bad_request" : "internal_error",
        url,
      );
      assert.equal(body.error.request_id, res.headers["x-request-id"], url);
      assert.ok(!res.body.includes("canary"), url);
      assert.ok(!JSON.stringify(res.headers).includes("canary"), url);
    }
    assert.ok(!log.text().includes("canary"));
    assert.equal(codeFor(Number.NaN), "internal_error");
    assert.equal(codeFor({ statusCode: 99999 }), "internal_error");
    assert.equal(codeFor({ statusCode: 400.5 }), "internal_error");
    assert.equal(codeFor({ code: "__proto__" }), "internal_error");
    assert.equal(codeFor({ code: "constructor" }), "internal_error");
  } finally {
    await app.close();
  }
});

test("bad URL returns bad_request without echoing the path", async () => {
  const { app, log } = appWithRoutes();
  try {
    const res = await app.inject({ method: "GET", url: "/CANARY%zz" });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "bad_request");
    assert.equal(body.error.message, MESSAGES.bad_request);
    assert.equal(body.error.request_id, res.headers["x-request-id"]);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(!res.body.includes("CANARY"));
    assert.ok(!JSON.stringify(res.headers).includes("CANARY"));
    // The raw path in the req serializer is by design; no log line may carry
    // an msg/err/message field derived from the error.
    for (const line of log.text().split("\n").filter(Boolean)) {
      const rec = JSON.parse(line);
      assert.ok(
        !("message" in (rec.err ?? {})) && !("stack" in (rec.err ?? {})),
      );
      assert.ok(!String(rec.msg).includes("CANARY"));
    }
  } finally {
    await app.close();
  }
});

test("error after reply sent is logged without message or stack", async () => {
  const { app, log } = appWithRoutes();
  app.get("/after-send", async (_request, reply) => {
    reply.send({ ok: true });
    throw new Error("canary-after-send");
  });
  try {
    await app.inject({ method: "GET", url: "/after-send" });
    assert.ok(!log.text().includes("canary-after-send"));
    assert.ok(!log.text().includes("stack"));
  } finally {
    await app.close();
  }
});

test("a long error code is bounded in the log", async () => {
  const { app, log } = appWithRoutes();
  app.get("/long-code", () => {
    throw Object.assign(new Error("boom"), { code: "C".repeat(500) });
  });
  try {
    await app.inject({ method: "GET", url: "/long-code" });
    assert.ok(log.text().includes("C".repeat(64)));
    assert.ok(!log.text().includes("C".repeat(65)));
  } finally {
    await app.close();
  }
});

test("codeFor never throws on throwing getters or proxies", () => {
  const boom = () => {
    throw new Error("canary-getter");
  };
  assert.equal(
    codeFor({
      get statusCode() {
        return boom();
      },
    }),
    "internal_error",
  );
  assert.equal(
    codeFor({
      get code() {
        return boom();
      },
    }),
    "internal_error",
  );
  assert.equal(codeFor(new Proxy({}, { get: boom })), "internal_error");
});
