import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SeedFile } from "../../seeds/build.ts";
import { postSeeds, startApi } from "./server.ts";
import {
  assessStability,
  STABILITY_MAX_DELTA,
  splitSeeds,
  summarizeTau,
  type TauRow,
} from "./sweep.ts";
import { renderSweep } from "./sweep-render.ts";

const GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
// Default candidate: TAU_PROVISIONAL (engine/src/certainty.ts); a test pins the equality.
const DEFAULT_CANDIDATE = 0.5;
// Strict: a grid value in (0, 1]; anything else is a usage error.
const CANDIDATE = /^(0\.[1-9]|1(\.0)?)$/;

function parseArgs(argv: string[]) {
  let candidate = DEFAULT_CANDIDATE;
  let heldOut = false;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--held-out") heldOut = true;
    else if (a === "--candidate") {
      const v = argv[++i];
      if (v === undefined || !CANDIDATE.test(v)) throw new Error("bad args");
      candidate = Number(v);
    } else if (!a.startsWith("--") && file === undefined) file = a;
    else throw new Error("bad args");
  }
  return { candidate, heldOut, file };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const seeds = JSON.parse(
    readFileSync(
      args.file ??
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

  const split = splitSeeds(seeds.cases);
  const shown = args.heldOut ? split.held_out : split.calibration;
  const rows: TauRow[] = [];
  const failures: string[] = [];
  let unsafe = false;
  for (const tau of GRID) {
    const { base, stop } = await startApi({ tau: String(tau) });
    try {
      const { observed } = await postSeeds(
        base,
        seeds.cases,
        process.env.SEED_API_KEY,
      );
      const whole = summarizeTau(seeds.cases, observed, tau);
      if (
        whole.uncovered.length ||
        whole.criticals.in_review ||
        whole.criticals.missed
      )
        unsafe = true;
      for (const c of shown) {
        const o = observed.get(c.id);
        if (c.expected_class === "critical" && o?.class !== "crítico")
          failures.push(`τ ${tau.toFixed(1)}: ${c.id}`);
        else if (o === undefined || o.class === null)
          failures.push(`τ ${tau.toFixed(1)}: ${c.id} (sin cobertura)`);
      }
      rows.push(summarizeTau(shown, observed, tau));
    } finally {
      stop();
    }
  }

  const stability = args.heldOut
    ? null
    : assessStability(
        new Map(rows.map((r) => [r.tau, r])),
        args.candidate,
        STABILITY_MAX_DELTA,
      );
  let out = renderSweep({
    subset: args.heldOut ? "held_out" : "calibration",
    seed_count: seeds.cases.length,
    subset_count: shown.length,
    held_out_count: split.held_out.length,
    rows,
    stability,
  });
  if (!args.heldOut)
    out += `Origen del candidato: ${args.candidate === DEFAULT_CANDIDATE ? "candidato por defecto (TAU_PROVISIONAL)" : "elegido con --candidate"}\n`;
  if (failures.length)
    out += `Críticos no detectados o casos sin cobertura (${failures.length}): ${failures.join("; ")}\n`;
  if (unsafe && !failures.length)
    out +=
      "Falla fuera del subconjunto mostrado: un crítico o un caso sin cobertura en algún τ.\n";
  out += `Resultado: ${unsafe ? "FALLA" : "OK"}\n`;
  process.stdout.write(out);
  return unsafe ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // Fixed message: never the error text (it could echo a path or a payload).
    process.stderr.write("tau sweep: could not run\n");
    process.exitCode = 2;
  },
);
