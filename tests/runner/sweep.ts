import { createHash } from "node:crypto";
import type { SeedCase } from "../../seeds/build.ts";
import type { Observed } from "./metrics.ts";

// provisional: clinical rule pending (ADR-017)
export const STABILITY_MAX_DELTA = 0.1;

export function splitSeeds(cases: SeedCase[]): {
  calibration: SeedCase[];
  held_out: SeedCase[];
} {
  const calibration: SeedCase[] = [];
  const held_out: SeedCase[] = [];
  for (const c of cases) {
    const byte = createHash("sha256").update(`split:${c.id}`).digest()[0] ?? 0;
    (byte % 10 < 3 ? held_out : calibration).push(c);
  }
  return { calibration, held_out };
}

export type TauRow = {
  tau: number;
  total: number;
  routed: number;
  routed_share: number;
  routed_ids: string[];
  criticals: {
    expected: number;
    detected: number;
    in_review: number;
    missed: number;
    requires_confirmation: number;
  };
  uncovered: string[];
};

export function summarizeTau(
  cases: SeedCase[],
  observed: ReadonlyMap<string, Observed>,
  tau: number,
): TauRow {
  const routed_ids: string[] = [];
  const uncovered: string[] = [];
  const criticals = {
    expected: 0,
    detected: 0,
    in_review: 0,
    missed: 0,
    requires_confirmation: 0,
  };
  for (const c of cases) {
    const o = observed.get(c.id);
    const covered = o !== undefined && o.class !== null;
    if (!covered) uncovered.push(c.id);
    else if (o.routed_from !== null) routed_ids.push(c.id);
    if (c.expected_class !== "critical") continue;
    criticals.expected++;
    if (covered && o.class === "crítico") criticals.detected++;
    else if (covered && o.class === "revisión clínica") criticals.in_review++;
    else criticals.missed++;
    if (o?.requires_confirmation === true) criticals.requires_confirmation++;
  }
  return {
    tau,
    total: cases.length,
    routed: routed_ids.length,
    routed_share: cases.length === 0 ? 0 : routed_ids.length / cases.length,
    routed_ids,
    criticals,
    uncovered,
  };
}

export type Stability = {
  candidate: number;
  neighbours: { tau: number; row: TauRow | null }[];
  safe: boolean;
  max_delta: number | null;
  stable: boolean;
  reason: string;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function assessStability(
  rows: ReadonlyMap<number, TauRow>,
  candidate: number,
  maxDelta: number,
): Stability {
  const own = rows.get(candidate) ?? null;
  const neighbours = [round1(candidate - 0.1), round1(candidate + 0.1)].map(
    (tau) => ({
      tau,
      row: tau > 0 && tau <= 1 ? (rows.get(tau) ?? null) : null,
    }),
  );
  const present = neighbours.flatMap((n) => (n.row ? [n.row] : []));
  const safe =
    own !== null &&
    [own, ...present].every(
      (r) => r.criticals.in_review === 0 && r.criticals.missed === 0,
    );
  const deltas = own
    ? present.map((r) => Math.abs(r.routed_share - own.routed_share))
    : [];
  const max_delta = deltas.length ? Math.max(...deltas) : null;
  const stable = safe && max_delta !== null && max_delta <= maxDelta + 1e-9; // tolerance: 0.4 - 0.3 is 0.10000000000000003 in floats
  const reason = stable
    ? "Estable: sin críticos en revisión ni perdidos y variación dentro del límite."
    : own === null
      ? "Sin datos del candidato: no se puede evaluar su estabilidad."
      : !safe
        ? "No seguro: hay un crítico en revisión clínica o no detectado en el candidato o un vecino."
        : max_delta === null
          ? "Sin vecinos evaluados: no se puede medir la variación."
          : "Inestable: la variación de casos derivados entre vecinos supera el límite.";
  return { candidate, neighbours, safe, max_delta, stable, reason };
}
