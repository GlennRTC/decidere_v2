import type { Stability, TauRow } from "./sweep.ts";

export type SweepInput = {
  subset: "calibration" | "held_out";
  seed_count: number;
  subset_count: number;
  held_out_count: number;
  rows: TauRow[];
  stability: Stability | null;
};

const pct = (n: number) => `${(n * 100).toFixed(1)} %`;
const yn = (b: boolean) => (b ? "sí" : "no");

export function renderSweep(i: SweepInput): string {
  const held = i.subset === "held_out";
  const lines = [
    `Barrido de τ sobre los seeds: calibración, no validación (${held ? "subconjunto reservado" : "subconjunto de calibración"})`,
    "Datos sintéticos; no aprobado para uso clínico. τ provisional, no validado (ADR-015).",
    `Seeds: ${i.seed_count}; subconjunto mostrado: ${i.subset_count}; reservado: ${i.held_out_count}`,
    "Con menos de 100 seeds los porcentajes no son una cifra estadística.",
    "Conformidad con criterios publicados; validación clínica pendiente.",
  ];
  if (held)
    lines.push(
      "Este subconjunto no se usó para elegir τ; se lee una sola vez, después de elegirlo.",
    );
  lines.push(
    "",
    "| τ | seeds | a revisión | % a revisión | críticos esperados | detectados | en revisión | no detectados | requieren confirmación |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of i.rows) {
    const c = r.criticals;
    lines.push(
      `| ${r.tau.toFixed(1)} | ${r.total} | ${r.routed} | ${pct(r.routed_share)} | ${c.expected} | ${c.detected} | ${c.in_review} | ${c.missed} | ${c.requires_confirmation} |`,
    );
  }
  const s = i.stability;
  if (s) {
    lines.push(
      "",
      "Regla provisional (ADR-017, pendiente de criterio clínico): seguridad de críticos en τ y vecinos, y variación de casos derivados de a lo sumo 10 puntos porcentuales.",
      `Candidato: ${s.candidate.toFixed(1)}`,
    );
    const own = i.rows.find((r) => r.tau === s.candidate);
    const all = [
      ...s.neighbours.slice(0, 1),
      { tau: s.candidate, row: own ?? null },
      ...s.neighbours.slice(1),
    ];
    for (const n of all)
      lines.push(
        n.row
          ? `  τ ${n.tau.toFixed(1)}: ${n.row.routed}/${n.row.total} a revisión (${pct(n.row.routed_share)})`
          : `  τ ${n.tau.toFixed(1)}: fuera de la cuadrícula`,
      );
    lines.push(
      `  seguro: ${yn(s.safe)}`,
      `  variación máxima: ${s.max_delta === null ? "n/a" : `${(s.max_delta * 100).toFixed(1)} puntos`}`,
      `  estable: ${yn(s.stable)}`,
      `  motivo: ${s.reason}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
