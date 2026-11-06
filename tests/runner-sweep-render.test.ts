import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessStability,
  STABILITY_MAX_DELTA,
  type TauRow,
} from "./runner/sweep.ts";
import { renderSweep } from "./runner/sweep-render.ts";

const row = (tau: number, routed: number, total = 10): TauRow => ({
  tau,
  total,
  routed,
  routed_share: routed / total,
  routed_ids: [],
  criticals: {
    expected: 4,
    detected: 4,
    in_review: 0,
    missed: 0,
    requires_confirmation: 1,
  },
  uncovered: [],
});
const grid = Array.from({ length: 10 }, (_, i) =>
  row(Math.round(i + 1) / 10, i),
);
const stability = assessStability(
  new Map(grid.map((r) => [r.tau, r])),
  0.5,
  STABILITY_MAX_DELTA,
);
const BANNED = /\bIA\b|precisi[oó]n|concordancia|confianza/i;

test("calibration output carries the mandatory wording and sizes", () => {
  const out = renderSweep({
    subset: "calibration",
    seed_count: 46,
    subset_count: 33,
    held_out_count: 13,
    rows: grid,
    stability,
  });
  assert.match(out, /calibración, no validación/);
  assert.match(out, /τ provisional, no validado/);
  assert.match(out, /menos de 100/);
  assert.match(out, /33/);
  assert.match(out, /13/);
  assert.doesNotMatch(out, /no se usó para elegir τ/);
  assert.match(out, /% a revisión/);
  const rows = out.split("\n").filter((l) => /^\| 0\.\d |^\| 1\.0 /.test(l));
  assert.equal(rows.length, 10);
  assert.deepEqual(
    rows.map((l) => l.split("|")[1]?.trim()),
    ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0"],
  );
  assert.match(out, /Regla provisional/);
  for (const t of ["0.4", "0.5", "0.6"]) assert.ok(out.includes(`τ ${t}`));
  assert.match(out, /Candidato: 0\.5/);
  assert.doesNotMatch(
    out.replace(
      /conformidad con criterios publicados; validación clínica pendiente/g,
      "",
    ),
    BANNED,
  );
  assert.doesNotMatch(
    out.replace(/validación clínica pendiente/g, ""),
    /validación clínica/,
  );
});

test("held-out output states it was not used to choose tau", () => {
  const out = renderSweep({
    subset: "held_out",
    seed_count: 46,
    subset_count: 13,
    held_out_count: 13,
    rows: grid,
    stability: null,
  });
  assert.match(out, /no se usó para elegir τ/);
  assert.match(out, /calibración, no validación/);
  assert.doesNotMatch(out, BANNED);
});

test("a critical in review is visible in its row", () => {
  const bad = row(0.3, 2);
  bad.criticals.in_review = 1;
  const out = renderSweep({
    subset: "calibration",
    seed_count: 10,
    subset_count: 10,
    held_out_count: 0,
    rows: [bad],
    stability: null,
  });
  const cells = out
    .split("\n")
    .find((l) => l.startsWith("| 0.3 |"))
    ?.split("|")
    .map((s) => s.trim());
  assert.equal(cells?.[7], "1"); // en revisión
  assert.equal(cells?.[8], "0"); // no detectados
});
