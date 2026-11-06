import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TAU_PROVISIONAL } from "../engine/src/certainty.ts";
import type { SeedFile } from "../seeds/build.ts";
import { postSeeds, startApi } from "./runner/server.ts";
import { splitSeeds, summarizeTau } from "./runner/sweep.ts";

const cli = fileURLToPath(new URL("./runner/sweep-run.ts", import.meta.url));
const seeds = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../seeds/cases.json", import.meta.url)),
    "utf8",
  ),
) as SeedFile;
const split = splitSeeds(seeds.cases);
const CANARY = "synthetic-key-canary";

function run(args: string[] = []) {
  const {
    ALLOWED_SOURCES: _a,
    RULES_DIR: _r,
    SEED_API_URL: _u,
    CERTAINTY_TAU: _t,
    ...inherited
  } = process.env;
  const r = spawnSync("node", [cli, ...args], {
    env: { ...inherited, SEED_API_KEY: CANARY },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const tableRows = (out: string) =>
  out.split("\n").filter((l) => /^\| (0\.\d|1\.0) \|/.test(l));

let def: ReturnType<typeof run>;
before(() => {
  def = run();
});

test("default sweep: exit 0, 10 rows, no held-out id, criticals safe, candidate unstable", () => {
  assert.equal(def.code, 0, def.out + def.err);
  const rows = tableRows(def.out);
  assert.equal(rows.length, 10);
  for (const l of rows) {
    const c = l.split("|").map((s) => s.trim());
    assert.equal(c[7], "0", l); // en revisión
    assert.equal(c[8], "0", l); // no detectados
  }
  for (const c of split.held_out) assert.ok(!def.out.includes(c.id), c.id);
  assert.match(def.out, /Candidato: 0\.5/);
  assert.match(def.out, /candidato por defecto \(TAU_PROVISIONAL\)/);
  // Baseline measured on the calibration subset (36 of 46): 0.4 and 0.5 route 7, 0.6 routes 17.
  assert.match(def.out, /estable: no/);
  assert.match(def.out, /variación máxima: 27\.8 puntos/);
  assert.match(def.out, /variación de casos derivados entre vecinos/);
  assert.doesNotMatch(def.out + def.err, /x-api-key|synthetic-key-canary/i);
  assert.doesNotMatch(def.out, /mm\[Hg\]|\/min|\{score\}/);
  assert.doesNotMatch(
    def.out,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
});

test("the default candidate is TAU_PROVISIONAL", () => {
  assert.equal(TAU_PROVISIONAL, 0.5);
});

test("--candidate 0.4 lists 0.3, 0.4, 0.5 and keeps critical safety", () => {
  const r = run(["--candidate", "0.4"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Candidato: 0\.4/);
  for (const t of ["0.3", "0.4", "0.5"]) assert.ok(r.out.includes(`τ ${t}:`));
  assert.match(r.out, /seguro: sí/);
  // Baseline (finding of Task 4, not asserted): estable: sí, variación 0.0 puntos.
});

test("--held-out prints the held-out subset and says it did not choose tau", () => {
  const r = run(["--held-out"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /no se usó para elegir τ/);
  assert.doesNotMatch(r.out, /Regla provisional/);
  assert.equal(tableRows(r.out).length, 10);
});

test("whole set: routed 9 at 0.5, 23 at 0.6, 16 of 16 criticals at 0.4-0.6", async () => {
  const want: [number, number | null][] = [
    [0.4, null],
    [0.5, 9],
    [0.6, 23],
  ];
  for (const [tau, routed] of want) {
    const { base, stop } = await startApi({ tau: String(tau) });
    try {
      const { observed } = await postSeeds(base, seeds.cases);
      const row = summarizeTau(seeds.cases, observed, tau);
      assert.equal(row.criticals.expected, 16);
      assert.equal(row.criticals.detected, 16, `tau ${tau}`);
      if (routed !== null) assert.equal(row.routed, routed, `tau ${tau}`);
    } finally {
      stop();
    }
  }
});

test("bad arguments and a missing file exit 2 quickly with a fixed message", () => {
  for (const args of [
    ["--candidate", "0"],
    ["--candidate", "1.5"],
    ["--bogus"],
    ["--candidate"],
  ]) {
    const t0 = Date.now();
    const r = run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.err, "tau sweep: could not run\n");
    assert.equal(r.out, "");
    assert.ok(Date.now() - t0 < 5000, args.join(" "));
  }
  const r = run([join(tmpdir(), "no-such-seeds-file.json")]);
  assert.equal(r.code, 2);
  assert.equal(r.err, "tau sweep: could not run\n");
});
