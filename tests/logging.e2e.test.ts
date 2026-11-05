import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditLogLines } from "../apps/api/src/testing/log-audit.ts";

const serverPath = fileURLToPath(
  new URL("../apps/api/src/server.ts", import.meta.url),
);

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

// Synthetic sentinels only.
const FORBIDDEN: (string | number)[] = [
  197,
  391,
  13,
  "sentinelq7",
  "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
  "resp_rate",
  "sbp",
  "gcs",
  "mm[Hg]",
];
const valid = JSON.stringify({
  schema_version: "1.0",
  message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
  source: "sim-1",
  instances: [
    {
      instance_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
      kind: "current",
      variables: [
        { variable: "resp_rate", value: 197, unit: "/min", t_offset_min: 0 },
        { variable: "sbp", value: 391, unit: "mm[Hg]", t_offset_min: 0 },
        { variable: "gcs", value: 13, unit: "{score}", t_offset_min: 0 },
      ],
    },
  ],
});

test("a real server process logs only approved fields and no sentinel", async () => {
  const port = await freePort();
  // The developer's own settings must not change the result.
  const { ALLOWED_SOURCES: _a, RULES_DIR: _r, ...inherited } = process.env;
  const child = spawn("node", [serverPath], {
    env: { ...inherited, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  child.stdout?.on("data", (d) => {
    stdout += String(d);
  });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));

  let healthy = false;
  for (let i = 0; i < 100 && !healthy; i++) {
    try {
      healthy = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {}
    if (!healthy) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(healthy, "server did not become healthy");

  const post = (body: string) =>
    fetch(`http://127.0.0.1:${port}/v1/messages?q=sentinelq7`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  assert.equal((await post(valid)).status, 200);
  assert.equal((await post("{sentinelq7")).status, 400);

  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);

  const audit = auditLogLines(stdout, FORBIDDEN);
  assert.deepEqual(audit.problems, []);
  // Normal operation writes nothing else to stderr. Node's own runtime warnings
  // (type stripping on older Node) are not ours; anything else must be approved JSON.
  const ours = stderr
    .split("\n")
    .filter(
      (l) =>
        l.trim() !== "" &&
        !/ExperimentalWarning|--trace-warnings|^\(node:/.test(l),
    )
    .join("\n");
  assert.equal(ours, "", "unexpected stderr output");
  assert.match(stdout, /Server listening at/);
  assert.match(stdout, /"msg":"message interpreted"/);
});

for (const [name, env, leak] of [
  ["invalid configuration", { ALLOWED_SOURCES: "Bad Source!" }, "Bad Source"],
  [
    "unreadable rules directory",
    { RULES_DIR: "/nonexistent/sentinelq7" },
    "sentinelq7",
  ],
] as const) {
  test(`startup failure (${name}) writes only approved lines to stderr`, async () => {
    const { ALLOWED_SOURCES: _a, RULES_DIR: _r, ...inherited } = process.env;
    const child = spawn("node", [serverPath], {
      env: { ...inherited, PORT: String(await freePort()), ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    children.push(child);
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const code = await new Promise<number | null>((r) =>
      child.once("exit", (c) => r(c)),
    );
    assert.notEqual(code, 0);
    const audit = auditLogLines(stderr, [leak]);
    assert.ok(audit.lines > 0);
    assert.deepEqual(audit.problems, []);
    assert.ok(!stderr.includes("    at "), "no stack trace");
  });
}
