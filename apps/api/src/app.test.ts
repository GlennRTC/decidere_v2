import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { buildApp } from "./app.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

test("GET /health returns 200 with status ok", async () => {
  const app = buildApp();
  try {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { status: "ok" });
    assert.ok(
      String(res.headers["content-type"]).startsWith("application/json"),
    );
  } finally {
    await app.close();
  }
});

test("/health body is identical across repeated calls", async () => {
  const app = buildApp();
  try {
    const bodies: string[] = [];
    for (let i = 0; i < 3; i++) {
      bodies.push((await app.inject({ method: "GET", url: "/health" })).body);
    }
    assert.equal(bodies[1], bodies[0]);
    assert.equal(bodies[2], bodies[0]);
  } finally {
    await app.close();
  }
});

test("/health sets no-store and a request id", async () => {
  const app = buildApp();
  try {
    const a = await app.inject({ method: "GET", url: "/health" });
    const b = await app.inject({ method: "GET", url: "/health" });
    assert.equal(a.headers["cache-control"], "no-store");
    assert.match(String(a.headers["x-request-id"]), UUID);
    assert.match(String(b.headers["x-request-id"]), UUID);
    assert.notEqual(a.headers["x-request-id"], b.headers["x-request-id"]);
  } finally {
    await app.close();
  }
});

test("inbound x-request-id is not trusted", async () => {
  const app = buildApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "attacker-controlled" },
    });
    assert.match(String(res.headers["x-request-id"]), UUID);
  } finally {
    await app.close();
  }
});

test("HEAD /health returns 200 with empty body", async () => {
  const app = buildApp();
  try {
    const res = await app.inject({ method: "HEAD", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, "");
  } finally {
    await app.close();
  }
});

test("POST /health returns 404 (deliberate)", async () => {
  const app = buildApp();
  try {
    const res = await app.inject({ method: "POST", url: "/health" });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("unknown route returns the standard error shape without echoing the path", async () => {
  const app = buildApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nope/abc123" });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "not_found");
    assert.equal(body.error.request_id, res.headers["x-request-id"]);
    assert.ok(!res.body.includes("abc123"));
  } finally {
    await app.close();
  }
});

test("thrown error does not leak its message", async () => {
  const app = buildApp();
  try {
    app.get("/boom", () => {
      throw new Error("secret-value-123");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error.code, "internal_error");
    assert.ok(!res.body.includes("secret-value-123"));
  } finally {
    await app.close();
  }
});

test("logs carry no query string, header values or remote address", async () => {
  const { logStream, text } = collectLog();
  const app = buildApp({ logStream });
  try {
    await app.inject({
      method: "GET",
      url: "/nope?token=abc123",
      headers: { authorization: "Bearer xyz789" },
    });
    const logged = text();
    // F011: an unmatched path can hold client-chosen text, so it is logged as a marker.
    assert.ok(logged.includes("<unmatched>"), "marker should be logged");
    assert.ok(
      !logged.includes("/nope"),
      "raw unmatched path must not be logged",
    );
    assert.ok(!logged.includes("abc123"));
    assert.ok(!logged.includes("xyz789"));
    assert.ok(!logged.includes("remoteAddress"));
  } finally {
    await app.close();
  }
});

test("/health requests are not logged", async () => {
  const { logStream, text } = collectLog();
  const app = buildApp({ logStream });
  try {
    await app.inject({ method: "GET", url: "/health" });
    assert.ok(!text().includes("/health"));
  } finally {
    await app.close();
  }
});
