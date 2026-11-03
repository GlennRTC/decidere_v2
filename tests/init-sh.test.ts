import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const initPath = fileURLToPath(new URL("../scripts/init.sh", import.meta.url));

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

// Async on purpose: the busy-port test serves from this same process, which spawnSync would block.
type Run = { status: number | null; stdout: string; stderr: string };
const runInit = (port: number): Promise<Run> =>
  new Promise((resolve) => {
    execFile(
      "bash",
      [initPath],
      {
        env: { ...process.env, API_PORT: String(port), SKIP_INSTALL: "1" },
        encoding: "utf8",
        timeout: 60000,
      },
      (err, stdout, stderr) => {
        const code = (err as { code?: unknown } | null)?.code;
        resolve({
          status: err ? (typeof code === "number" ? code : null) : 0,
          stdout,
          stderr,
        });
      },
    );
  });

const describeRun = (r: Run): string =>
  `status=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

const answers = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return true;
  } catch {
    return false;
  }
};

// The first two tests share one real run: the second checks what it left behind.
let port = 0;

test("init.sh exits 0 with the API up", async () => {
  port = await freePort();
  const r = await runInit(port);
  assert.equal(r.status, 0, describeRun(r));
  assert.match(r.stdout, /OK:/, describeRun(r));
  assert.match(r.stdout, /\/health/, describeRun(r));
});

test("init.sh leaves nothing listening afterwards", async () => {
  assert.ok(port > 0, "first test did not run");
  const deadline = Date.now() + 5000;
  while (await answers(port)) {
    assert.ok(Date.now() < deadline, `port ${port} still answers /health`);
    await new Promise((r) => setTimeout(r, 200));
  }
});

test("init.sh fails when the port is already serving", async () => {
  const busyPort = await freePort();
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) =>
    server.listen(busyPort, "127.0.0.1", resolve),
  );
  try {
    const r = await runInit(busyPort);
    assert.notEqual(r.status, 0, describeRun(r));
    assert.match(`${r.stdout}${r.stderr}`, /busy|already/i, describeRun(r));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
