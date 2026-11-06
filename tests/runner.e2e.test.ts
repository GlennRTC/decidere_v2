import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./runner/run.ts", import.meta.url));
const DIVERGENT = [
  "bnd-rr-21-01",
  "bnd-rr-22-01",
  "bnd-sbp-101-01",
  "bnd-sbp-100-01",
  "bnd-21-101-15-01",
  "bnd-22-101-15-01",
  "bnd-21-101-14-01",
  "bnd-21-100-15-01",
  "con-sbp-low-01",
];

function run(args: string[] = [], env: Record<string, string> = {}) {
  const {
    ALLOWED_SOURCES: _a,
    RULES_DIR: _r,
    SEED_API_URL: _u,
    SEED_API_KEY: _k,
    CERTAINTY_TAU: _t,
    ...inherited
  } = process.env;
  const r = spawnSync("node", [cli, ...args], {
    env: { ...inherited, ...env },
    encoding: "utf8",
    timeout: 90_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("default seeds: exit 0, label, tau 0.5 and the 9 baseline divergences", () => {
  const r = run([], { SEED_API_KEY: "synthetic-key-canary" });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(
    r.out,
    /conformidad con criterios publicados; validación clínica pendiente/,
  );
  assert.match(r.out, /τ = 0\.5\n/);
  assert.match(r.out, /Divergencias por certeza \(9\): /);
  for (const id of DIVERGENT) assert.ok(r.out.includes(id), id);
  assert.match(r.out, /Resultado: OK/);
  assert.doesNotMatch(r.out + r.err, /x-api-key|synthetic-key-canary/i);
  assert.doesNotMatch(r.out, /\bIA\b|precisi[oó]n/i);
  assert.doesNotMatch(r.out, /mm\[Hg\]|\/min|\{score\}/);
  assert.doesNotMatch(
    r.out,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
});

test("tau 0.6 keeps criticals and shows the 23-divergence baseline", () => {
  // 23 is a regression baseline (ADR-015 structural jump), not a target.
  const r = run([], { CERTAINTY_TAU: "0.6" });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /τ = 0\.6\n/);
  assert.match(r.out, /Divergencias por certeza \(23\): /);
});

test("a missed critical fails the run", () => {
  const dir = mkdtempSync(join(tmpdir(), "seeds-"));
  const file = join(dir, "seeds.json");
  writeFileSync(
    file,
    JSON.stringify({
      labeling: "provisional",
      labelers: { a: "placeholder-A", b: "placeholder-B", adjudicator: null },
      clinical_approval: { status: "pending", approver: null },
      cases: [
        {
          id: "neg-as-critical-01",
          category: "clear_negative",
          expected_class: "critical",
          criterion: "synthetic mislabel for the runner test",
          instances: [
            {
              kind: "current",
              vitals: [
                { code: "RR", value: 14, unit: "/min" },
                { code: "SBP", value: 120, unit: "mm[Hg]" },
                { code: "GCS", value: 15, unit: "{score}" },
              ],
            },
          ],
        },
      ],
    }),
  );
  const r = run([file]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /Discrepancias sin explicar \(1\): neg-as-critical-01/);
  assert.match(r.out, /Sensibilidad de crítico: 0\/1/);
  assert.match(r.out, /Resultado: FALLA/);
});

test("an unreachable SEED_API_URL exits 2 quickly with a fixed message", () => {
  const t0 = Date.now();
  const r = run([], { SEED_API_URL: "http://127.0.0.1:1" });
  assert.equal(r.code, 2);
  assert.ok(Date.now() - t0 < 10_000);
  assert.match(r.err, /^seeds runner: could not run\n$/);
  assert.equal(r.out, "");
});

test("a missing seeds file exits 2", () => {
  const r = run([join(tmpdir(), "no-such-seeds-file.json")]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^seeds runner: could not run\n$/);
});

function seedsFile(cases: unknown[]): string {
  const file = join(mkdtempSync(join(tmpdir(), "seeds-")), "seeds.json");
  writeFileSync(file, JSON.stringify({ labeling: "provisional", cases }));
  return file;
}

test("an empty seeds file exits 2 with the fixed message", () => {
  const r = run([seedsFile([])]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^seeds runner: could not run\n$/);
  assert.equal(r.out, "");
});

test("duplicate case ids exit 2 with the fixed message", () => {
  const dup = {
    id: "dup-01",
    category: "clear_negative",
    expected_class: "no_alert",
    criterion: "synthetic duplicate for the runner test",
    instances: [{ kind: "current", vitals: [] }],
  };
  const r = run([seedsFile([dup, dup])]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^seeds runner: could not run\n$/);
  assert.equal(r.out, "");
});
