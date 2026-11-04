import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(
  new URL("../apps/api/src/server.ts", import.meta.url),
);
const rulesDir = fileURLToPath(new URL("../knowledge/rules", import.meta.url));

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const children: ChildProcess[] = [];
after(() => {
  for (const c of children) c.kill("SIGKILL");
});

function start(port: number, env: Record<string, string> = {}) {
  // The developer's own ALLOWED_SOURCES / RULES_DIR must not change the result.
  const { ALLOWED_SOURCES: _a, RULES_DIR: _r, ...inherited } = process.env;
  const child = spawn("node", [serverPath], {
    env: { ...inherited, PORT: String(port), ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  const exited = new Promise<number | null>((r) =>
    child.once("exit", (c) => r(c)),
  );
  return { child, exited, stderr: () => stderr };
}

async function waitHealthy(port: number, exited: Promise<number | null>) {
  let done = false;
  exited.then(() => {
    done = true;
  });
  for (let i = 0; i < 100 && !done; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy");
}

// Synthetic ids and values only.
const inst = (id: string, rr: number, sbp: number, gcs: number) => ({
  instance_id: id,
  kind: "current",
  variables: [
    { variable: "resp_rate", value: rr, unit: "/min", t_offset_min: 0 },
    { variable: "sbp", value: sbp, unit: "mm[Hg]", t_offset_min: 0 },
    { variable: "gcs", value: gcs, unit: "{score}", t_offset_min: 0 },
  ],
});
const body = (...instances: unknown[]) =>
  JSON.stringify({
    schema_version: "1.0",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    source: "sim-1",
    instances,
  });
type Resp = {
  results: { class: string; trace: unknown[] }[];
  rule_set: { version: string };
};
const IDS = [
  "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
  "e47d0b93-2a5c-4c61-9f18-d36a85b02e4f",
];

test("a real server answers class and trace, and processes N instances", async () => {
  const port = await freePort();
  const { exited } = start(port);
  await waitHealthy(port, exited);
  const post = (payload: string) =>
    fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
  const one = await post(body(inst(IDS[0], 24, 95, 14)));
  assert.equal(one.status, 200);
  const j = (await one.json()) as Resp;
  assert.equal(j.results[0].class, "crítico");
  assert.ok(j.results[0].trace.length > 0);
  assert.match(j.rule_set.version, /^rs-/);
  const two = await post(
    body(inst(IDS[0], 24, 95, 14), inst(IDS[1], 14, 120, 15)),
  );
  assert.deepEqual(
    ((await two.json()) as Resp).results.map((r) => r.class),
    ["crítico", "sin alerta"],
  );
});

test("startup aborts when a rule has no severity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-"));
  cpSync(rulesDir, dir, { recursive: true });
  const file = join(dir, "sepsis.qsofa.v1.yaml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(/^severity: critical\n/m, ""),
  );
  const { exited, stderr } = start(await freePort(), { RULES_DIR: dir });
  const outcome = await Promise.race([
    exited,
    new Promise<string>((r) => setTimeout(() => r("still running"), 8000)),
  ]);
  assert.ok(typeof outcome === "number" && outcome !== 0);
  assert.match(stderr(), /"code":"missing_severity"/);
});

test("an invalid ALLOWED_SOURCES aborts with a structured line, no stack", async () => {
  const { exited, stderr } = start(await freePort(), {
    ALLOWED_SOURCES: "Bad Source!",
  });
  const outcome = await Promise.race([
    exited,
    new Promise<string>((r) => setTimeout(() => r("still running"), 8000)),
  ]);
  assert.ok(typeof outcome === "number" && outcome !== 0);
  assert.match(stderr(), /"msg":"invalid configuration"/);
  assert.ok(!stderr().includes("    at "));
  assert.ok(!stderr().includes("Bad Source"));
});
