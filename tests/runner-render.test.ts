import assert from "node:assert/strict";
import { test } from "node:test";
import type { Observed, Outcome, Report } from "./runner/metrics.ts";
import { type ReportHeader, renderReport } from "./runner/render.ts";

const LABEL =
  "conformidad con criterios publicados; validación clínica pendiente";
const header: ReportHeader = {
  tau: "0.7",
  policy_version: "p1",
  rule_set_version: "r1",
  rule_set_approval: "PROVISIONAL",
  certainty_version: "c1",
  labeling: "PROVISIONAL",
  labelers: "placeholder",
  clinical_approval: "desconocido",
  seed_count: 3,
};
const obs = (cls: string): Observed => ({
  status: 200,
  class: cls,
  routed_from: null,
  reason_code: null,
  requires_confirmation: null,
});
const out = (id: string, o: Partial<Outcome>): Outcome => ({
  id,
  category: "c",
  expected: "watch",
  observed: obs("vigilancia"),
  verdict: "match",
  ...o,
});
const base = (outcomes: Outcome[]): Report => ({
  total: outcomes.length,
  outcomes,
  coverage: { covered: outcomes.length, total: outcomes.length },
  sensitivity: null,
  conformity: {
    matches: outcomes.filter((o) => o.verdict === "match").length,
    total: outcomes.length,
  },
  divergences: [],
  discrepancies: [],
  not_covered: [],
  criticals_in_review: [],
  criticals_missed: [],
  failed: false,
});

const passing = base([out("syn-001", {}), out("syn-002", {})]);
const crit = out("syn-003", {
  expected: "critical",
  observed: obs("revisión clínica"),
  verdict: "discrepancy",
  critical: "in_review",
});
const div = out("syn-004", { verdict: "certainty_divergence" });
const disc = out("syn-005", { verdict: "discrepancy" });
const failing: Report = {
  ...base([out("syn-001", {}), crit, div, disc]),
  sensitivity: { detected: 0, expected: 1 },
  divergences: [div],
  discrepancies: [crit, disc],
  criticals_in_review: [crit],
  failed: true,
};

test("required phrases and bans", () => {
  for (const r of [passing, failing]) {
    const text = renderReport(r, header);
    for (const s of [
      LABEL,
      "τ = 0.7",
      "PROVISIONAL",
      "placeholder",
      "menos de 100",
      "PhysioNet",
      "kappa: no disponible (etiquetadores placeholder)",
    ])
      assert.ok(text.includes(s), s);
    assert.doesNotMatch(text, /\bIA\b|precisi[oó]n|concordancia/i);
    assert.ok(!text.replace(LABEL, "").includes("validación clínica"));
    assert.ok(!/cero discrepancias/i.test(text));
  }
});

test("sections appear in order", () => {
  const text = renderReport(failing, header);
  const keys = [
    "Cobertura",
    "Sensibilidad de crítico",
    "Conformidad",
    "Divergencias por certeza",
    "Críticos esperados en revisión clínica",
    "Discrepancias sin explicar",
    "Resultado",
  ];
  const idx = keys.map((k) => text.indexOf(k));
  assert.ok(idx.every((i) => i >= 0));
  assert.deepEqual(
    [...idx].sort((a, b) => a - b),
    idx,
  );
});

test("lists ids and states in-review criticals are not hits", () => {
  const text = renderReport(failing, header);
  assert.match(text, /syn-004/);
  assert.match(text, /syn-003/);
  assert.match(text, /syn-005/);
  assert.match(text, /NO cuentan como aciertos/);
});

test("sensitivity n/a without expected criticals", () => {
  assert.match(renderReport(passing, header), /Sensibilidad de crítico: n\/a/);
});

test("result line", () => {
  assert.ok(renderReport(passing, header).trimEnd().endsWith("Resultado: OK"));
  assert.ok(
    renderReport(failing, header).trimEnd().endsWith("Resultado: FALLA"),
  );
});
