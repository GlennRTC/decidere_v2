import assert from "node:assert/strict";
import { connect } from "node:net";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

async function start() {
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
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  return { app, port, logs: () => chunks.join("") };
}

function raw(port: number, parts: string[], gapMs = 50): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let out = "";
    socket.on("data", (d) => {
      out += String(d);
    });
    socket.on("close", () => resolve(out));
    socket.on("error", reject);
    socket.on("connect", async () => {
      for (const part of parts) {
        socket.write(part);
        await new Promise((r) => setTimeout(r, gapMs));
      }
    });
  });
}

const bodyOf = (response: string) =>
  response.slice(response.indexOf("\r\n\r\n") + 4);

test("a malformed request line gets a structured 400 with x-request-id and no-store", async () => {
  const { app, port, logs } = await start();
  try {
    const out = await raw(port, ["GARBAGEcanaryzq9\r\n\r\n"]);
    assert.match(out, /^HTTP\/1\.1 400 /);
    assert.match(out, /x-request-id: [0-9a-f-]{36}/i);
    assert.match(out, /cache-control: no-store/i);
    const error = JSON.parse(bodyOf(out)).error;
    assert.equal(error.code, "bad_request");
    assert.equal(error.message, "The request is invalid.");
    assert.equal(
      error.request_id,
      /x-request-id: ([0-9a-f-]{36})/i.exec(out)?.[1],
    );
    assert.ok(!out.includes("canaryzq9"));
    assert.ok(!logs().includes("canaryzq9"));
    assert.ok(logs().includes('"code":"bad_request"'));
  } finally {
    await app.close();
  }
});

test("a valid request split across two TCP writes still gets 200", async () => {
  const { app, port } = await start();
  try {
    const payload = JSON.stringify({
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
    });
    const head = `POST /v1/messages HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(payload)}\r\nconnection: close\r\n\r\n`;
    const out = await raw(port, [
      head.slice(0, 20),
      head.slice(20) + payload.slice(0, 30),
      payload.slice(30),
    ]);
    assert.match(out, /^HTTP\/1\.1 200 /);
  } finally {
    await app.close();
  }
});

test("the client-error handler survives an already-destroyed socket", async () => {
  const { app } = await start();
  try {
    const handler =
      (app.initialConfig as unknown as Record<string, unknown>) &&
      app.server.listeners("clientError")[0];
    assert.equal(typeof handler, "function");
    const { Socket } = await import("node:net");
    const socket = new Socket();
    socket.destroy();
    assert.doesNotThrow(() =>
      (handler as (e: Error, s: unknown) => void)(
        new Error("boom canaryzq9"),
        socket,
      ),
    );
  } finally {
    await app.close();
  }
});
