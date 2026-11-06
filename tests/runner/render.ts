import type { Outcome, Report } from "./metrics.ts";

export type ReportHeader = {
  tau: string;
  policy_version: string;
  rule_set_version: string;
  rule_set_approval: string;
  certainty_version: string;
  labeling: string;
  labelers: string;
  clinical_approval: string;
  seed_count: number;
};

const ids = (os: Outcome[]): string =>
  os.length ? os.map((o) => o.id).join(", ") : "ninguno";

export function renderReport(report: Report, h: ReportHeader): string {
  const s = report.sensitivity;
  const lines = [
    "Reporte de seeds: conformidad con criterios publicados; validación clínica pendiente",
    `τ = ${h.tau}`,
    "Datos sintéticos; no aprobado para uso clínico. τ provisional, no validado (ADR-015).",
    `Política: ${h.policy_version}`,
    `Reglas: ${h.rule_set_version} (aprobación: ${h.rule_set_approval})`,
    `Certeza: ${h.certainty_version}`,
    `Etiquetado: ${h.labeling} (PROVISIONAL si no hay adjudicación clínica)`,
    `Etiquetadores: ${h.labelers}`,
    `Aprobación clínica: ${h.clinical_approval}`,
    `Seeds: ${h.seed_count}`,
    "kappa: no disponible (etiquetadores placeholder)",
    "Con menos de 100 seeds esto no es una cifra estadística: 99% equivale a 0 discrepancias con ese tamaño.",
    "Con etiquetas placeholder y un oráculo escrito por el mismo equipo, las cifras miden consistencia con la política provisional y no son evidencia de validez clínica.",
    "No se compara 1:1 con PhysioNet/CinC 2019 (etiquetas distintas).",
    "",
    `Cobertura: ${report.coverage.covered}/${report.coverage.total}`,
    s
      ? `Sensibilidad de crítico: ${s.detected}/${s.expected}`
      : "Sensibilidad de crítico: n/a",
    `Conformidad: ${report.conformity.matches}/${report.conformity.total} coinciden; ${report.divergences.length} derivadas a revisión por certeza (no penalizadas, ADR-016); ${report.discrepancies.length} discrepancias sin explicar`,
    `Divergencias por certeza (${report.divergences.length}): ${ids(report.divergences)}`,
    `Críticos esperados en revisión clínica (${report.criticals_in_review.length}): ${ids(report.criticals_in_review)}`,
    "  Estos casos NO cuentan como aciertos de la clase crítico.",
    `Discrepancias sin explicar (${report.discrepancies.length}): ${ids(report.discrepancies)}`,
    `Críticos esperados no detectados (${report.criticals_missed.length}): ${ids(report.criticals_missed)}`,
    `Sin cobertura (${report.not_covered.length}): ${ids(report.not_covered)}`,
    `Resultado: ${report.failed ? "FALLA" : "OK"}`,
  ];
  return `${lines.join("\n")}\n`;
}
