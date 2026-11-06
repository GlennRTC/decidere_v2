import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SeedFile } from "../../seeds/build.ts";
import { evaluateSeeds } from "./metrics.ts";
import { type ReportHeader, renderReport } from "./render.ts";
import { postSeeds, startApi } from "./server.ts";

const UNKNOWN = "desconocido";

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
  const { base, stop } = await startApi({ tau: envTau, external });
  try {
    const { observed, first } = await postSeeds(
      base,
      seeds.cases,
      process.env.SEED_API_KEY,
    );

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
    stop();
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
