import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { buildMessage, type SeedFile } from "../../seeds/build.ts";
import { evaluateSeeds, type Observed, observe } from "./metrics.ts";
import { type ReportHeader, renderReport } from "./render.ts";

const serverPath = fileURLToPath(
  new URL("../../apps/api/src/server.ts", import.meta.url),
);
const UNKNOWN = "desconocido";

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

const str = (v: unknown): string => (typeof v === "string" ? v : UNKNOWN);

async function main(): Promise<number> {
  const seeds = JSON.parse(
    readFileSync(
      process.argv[2] ??
        fileURLToPath(new URL("../../seeds/cases.json", import.meta.url)),
      "utf8",
    ),
  ) as SeedFile;
  if (!seeds || !Array.isArray(seeds.cases)) throw new Error("bad seeds");
  if (
    seeds.cases.length === 0 ||
    new Set(seeds.cases.map((c) => c.id)).size !== seeds.cases.length
  )
    throw new Error("bad seeds");

  const external = process.env.SEED_API_URL;
  const envTau = process.env.CERTAINTY_TAU;
  let child: ChildProcess | undefined;
  try {
    let base: string;
    if (external) {
      base = external.replace(/\/$/, "");
    } else {
      const port = await freePort();
      // The developer's own ALLOWED_SOURCES / RULES_DIR / MAPPINGS_DIR must not change the result.
      const {
        ALLOWED_SOURCES: _a,
        RULES_DIR: _r,
        MAPPINGS_DIR: _m,
        ...inherited
      } = process.env;
      child = spawn(process.execPath, [serverPath], {
        env: {
          ...inherited,
          PORT: String(port),
          ...(envTau ? { CERTAINTY_TAU: envTau } : {}),
          API_HOST: "127.0.0.1",
          ALLOWED_SOURCES: "sim-1",
        },
        stdio: "ignore",
      });
      base = `http://127.0.0.1:${port}`;
      await waitHealthy(base, child);
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (process.env.SEED_API_KEY)
      headers["x-api-key"] = process.env.SEED_API_KEY;

    const observed = new Map<string, Observed>();
    let first: Record<string, unknown> | undefined;
    for (const c of seeds.cases) {
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

    const obj = (v: unknown): Record<string, unknown> =>
      v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const results = first?.results;
    const certainty = obj(
      obj(Array.isArray(results) ? results[0] : null).certainty,
    );
    const header: ReportHeader = {
      tau:
        certainty.tau !== undefined ? String(certainty.tau) : envTau || UNKNOWN,
      policy_version: str(obj(first?.policy).version),
      rule_set_version: str(obj(first?.rule_set).version),
      rule_set_approval: str(obj(first?.rule_set).approval),
      certainty_version: str(certainty.version),
      labeling: str(seeds.labeling),
      labelers: [
        seeds.labelers?.a,
        seeds.labelers?.b,
        seeds.labelers?.adjudicator,
      ]
        .map((l) => (typeof l === "string" ? l : "ninguno"))
        .join(", "),
      clinical_approval: str(seeds.clinical_approval?.status),
      seed_count: seeds.cases.length,
    };
    const report = evaluateSeeds(seeds.cases, observed);
    process.stdout.write(renderReport(report, header));
    return report.failed ? 1 : 0;
  } finally {
    child?.kill("SIGKILL");
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // Fixed message: never the error text (it could echo a path or a payload).
    process.stderr.write("seeds runner: could not run\n");
    process.exitCode = 2;
  },
);
