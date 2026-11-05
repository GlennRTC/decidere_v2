import assert from "node:assert/strict";
import { connect } from "node:net";
import { Writable } from "node:stream";
import { test } from "node:test";
import { loadRuleSet } from "@decidere/rules";
import { buildApp } from "./app.ts";
import { CANONICAL_VARIABLES } from "./interpret.ts";
import { auditLogLines } from "./testing/log-audit.ts";

const rulesDir = new URL("../../../knowledge/rules/", import.meta.url).pathname;
const rules = loadRuleSet(rulesDir, { variables: CANONICAL_VARIABLES });

const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const FORBIDDEN: (string | number)[] = [
  197,
  391,
  13,
  8888,
  "sentinelq7",
  "sentinel-src",
  INSTANCE_ID,
  "resp_rate",
  "sbp",
  "gcs",
  "mm[Hg]",
];

type Vars = [string, number | null][];
const UNITS: Record<string, string> = {
  resp_rate: "/min",
  sbp: "mm[Hg]",
  gcs: "{score}",
};
function message(vars: Vars, source = "sim-1"): Record<string, unknown> {
  return {
    schema_version: "1.0",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    source,
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: vars.map(([variable, value]) => ({
          variable,
          value,
          unit: UNITS[variable],
          t_offset_min: 0,
        })),
      },
    ],
  };
}
const SENTINEL_VALUES: Vars = [
  ["resp_rate", 197],
  ["sbp", 391],
  ["gcs", 13],
];

function setup(over: Partial<Parameters<typeof buildApp>[0]> = {}) {
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
    ...over,
  });
  return { app, logs: () => chunks.join("") };
}

// Structural scan of an error body: no forbidden number leaf, no forbidden string.
function bodyLeaks(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null)
      for (const [k, item] of Object.entries(v)) {
        for (const f of FORBIDDEN)
          if (typeof f === "string" && k.includes(f)) out.push(`key ${k}`);
        walk(item);
      }
    else
      for (const f of FORBIDDEN) {
        if (typeof f === "number" && v === f) out.push(`number ${f}`);
        if (typeof f === "string" && typeof v === "string" && v.includes(f))
          out.push(`string ${f}`);
      }
  };
  walk(value);
  return out;
}

type Case = {
  name: string;
  url?: string;
  method?: "POST" | "GET";
  contentType?: string;
  payload: () => string;
  status: number;
  rulesOverride?: boolean;
};
const J = JSON.stringify;
const cases: Case[] = [
  {
    name: "success with sentinel values",
    payload: () => J(message(SENTINEL_VALUES)),
    status: 200,
  },
  {
    name: "success with sentinel in the query string",
    url: "/v1/messages?q=sentinelq7",
    payload: () => J(message(SENTINEL_VALUES)),
    status: 200,
  },
  {
    name: "all-null success",
    payload: () =>
      J(
        message([
          ["resp_rate", null],
          ["sbp", null],
          ["gcs", null],
        ]),
      ),
    status: 200,
  },
  {
    name: "422 out-of-range sentinel value",
    payload: () => J(message([["resp_rate", 8888]])),
    status: 422,
  },
  {
    name: "422 unknown field named with the sentinel",
    payload: () => J({ ...message(SENTINEL_VALUES), sentinelq7: 1 }),
    status: 422,
  },
  {
    name: "400 malformed JSON with the sentinel",
    payload: () => "{sentinelq7",
    status: 400,
  },
  {
    name: "403 source sentinel",
    payload: () => J(message(SENTINEL_VALUES, "sentinel-src")),
    status: 403,
  },
  {
    name: "413 oversized body",
    payload: () => J({ pad: "sentinelq7".repeat(14000) }),
    status: 413,
  },
  {
    name: "415 text/plain",
    contentType: "text/plain",
    payload: () => "sentinelq7",
    status: 415,
  },
  {
    name: "404 with a sentinel query string",
    method: "GET",
    url: "/nope?q=sentinelq7",
    payload: () => "",
    status: 404,
  },
  {
    name: "500 evaluation failure",
    payload: () => J(message(SENTINEL_VALUES)),
    status: 500,
    rulesOverride: true,
  },
];

for (const c of cases) {
  test(`log audit: ${c.name}`, async () => {
    const { app, logs } = setup(
      c.rulesOverride ? { rules: { ...rules, ruleSet: [] as never } } : {},
    );
    const method = c.method ?? "POST";
    const res = await app.inject({
      method,
      url: c.url ?? "/v1/messages",
      headers:
        method === "POST"
          ? { "content-type": c.contentType ?? "application/json" }
          : {},
      payload: method === "POST" ? c.payload() : undefined,
    });
    assert.equal(res.statusCode, c.status);
    const audit = auditLogLines(logs(), FORBIDDEN);
    assert.ok(audit.lines > 0);
    assert.deepEqual(audit.problems, []);
    if (c.status >= 400) assert.deepEqual(bodyLeaks(res.json()), []);
  });
}

test("log audit: socket-level garbage with the sentinel", async () => {
  const { app, logs } = setup();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      socket.on("connect", () => socket.write("GARBAGEsentinelq7\r\n\r\n"));
      socket.on("data", () => {});
      socket.on("close", () => resolve());
      socket.on("error", reject);
    });
    const audit = auditLogLines(logs(), FORBIDDEN);
    assert.ok(audit.lines > 0);
    assert.deepEqual(audit.problems, []);
  } finally {
    await app.close();
  }
});

test("log audit: /health writes no request lines", async () => {
  const { app, logs } = setup();
  await app.inject({ method: "GET", url: "/health" });
  assert.equal(auditLogLines(logs(), FORBIDDEN).lines, 0);
});
