import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { buildMessage, type SeedCase } from "../../seeds/build.ts";
import { type Observed, observe } from "./metrics.ts";

const serverPath = fileURLToPath(
  new URL("../../apps/api/src/server.ts", import.meta.url),
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

async function waitHealthy(base: string, child: ChildProcess) {
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", () => {
    exited = true;
  });
  const deadline = Date.now() + 10_000;
  while (!exited && Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("not healthy");
}

/** Starts the API on a free port (or uses `external`); `stop` kills the child. */
export async function startApi(opts: {
  tau?: string;
  external?: string;
}): Promise<{ base: string; stop: () => void }> {
  if (opts.external)
    return { base: opts.external.replace(/\/$/, ""), stop: () => {} };
  const port = await freePort();
  // The developer's own ALLOWED_SOURCES / RULES_DIR / MAPPINGS_DIR must not change the result.
  const {
    ALLOWED_SOURCES: _a,
    RULES_DIR: _r,
    MAPPINGS_DIR: _m,
    ...inherited
  } = process.env;
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...inherited,
      PORT: String(port),
      ...(opts.tau ? { CERTAINTY_TAU: opts.tau } : {}),
      API_HOST: "127.0.0.1",
      ALLOWED_SOURCES: "sim-1",
    },
    stdio: "ignore",
  });
  const stop = () => {
    child.kill("SIGKILL");
  };
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(base, child);
  } catch (e) {
    stop();
    throw e;
  }
  return { base, stop };
}

/** POSTs every case sequentially and returns what the API answered. */
export async function postSeeds(
  base: string,
  cases: SeedCase[],
  apiKey?: string,
): Promise<{
  observed: Map<string, Observed>;
  first: Record<string, unknown> | undefined;
}> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const observed = new Map<string, Observed>();
  let first: Record<string, unknown> | undefined;
  for (const c of cases) {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildMessage(c)),
      signal: AbortSignal.timeout(5000),
    });
    const body: unknown = await res.json().catch(() => null);
    observed.set(c.id, observe(res.status, body));
    if (res.status === 200 && !first && body && typeof body === "object")
      first = body as Record<string, unknown>;
  }
  return { observed, first };
}
