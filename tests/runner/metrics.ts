import type { SeedCase, SeedClass } from "../../seeds/build.ts";

export type Observed = {
  status: number;
  class: string | null;
  routed_from: string | null;
  reason_code: string | null;
  requires_confirmation: boolean | null;
};
export type Verdict =
  | "match"
  | "certainty_divergence"
  | "discrepancy"
  | "not_covered";
export type CriticalStatus = "detected" | "in_review" | "missed";
export type Outcome = {
  id: string;
  category: string;
  expected: SeedClass;
  observed: Observed;
  verdict: Verdict;
  critical?: CriticalStatus;
};
export type Report = {
  total: number;
  outcomes: Outcome[];
  coverage: { covered: number; total: number };
  sensitivity: { detected: number; expected: number } | null;
  conformity: { matches: number; total: number };
  divergences: Outcome[];
  discrepancies: Outcome[];
  not_covered: Outcome[];
  criticals_in_review: Outcome[];
  criticals_missed: Outcome[];
  failed: boolean;
};

const CLASS_NAMES: Record<SeedClass, string> = {
  critical: "crítico",
  watch: "vigilancia",
  no_alert: "sin alerta",
  review: "revisión clínica",
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function observe(status: number, body: unknown): Observed {
  const none: Observed = {
    status,
    class: null,
    routed_from: null,
    reason_code: null,
    requires_confirmation: null,
  };
  if (status !== 200 || typeof body !== "object" || body === null) return none;
  const results = (body as { results?: unknown }).results;
  const first: unknown = Array.isArray(results) ? results[0] : undefined;
  if (typeof first !== "object" || first === null) return none;
  const r = first as Record<string, unknown>;
  const cls = str(r.class);
  if (cls === null) return none;
  return {
    status,
    class: cls,
    routed_from: str(r.routed_from),
    reason_code: str(r.reason_code),
    requires_confirmation:
      typeof r.requires_confirmation === "boolean"
        ? r.requires_confirmation
        : null,
  };
}

function verdictFor(expected: SeedClass, o: Observed): Verdict {
  const name = CLASS_NAMES[expected];
  if (o.class === null) return "not_covered";
  if (o.class === name) return "match";
  if (
    (expected === "watch" || expected === "no_alert") &&
    o.class === CLASS_NAMES.review &&
    o.routed_from === name &&
    o.reason_code === "low_certainty"
  )
    return "certainty_divergence";
  return "discrepancy";
}

export function evaluateSeeds(
  cases: SeedCase[],
  observed: ReadonlyMap<string, Observed>,
): Report {
  const outcomes: Outcome[] = cases.map((c) => {
    const o: Observed = observed.get(c.id) ?? observe(0, null);
    const verdict = verdictFor(c.expected_class, o);
    const outcome: Outcome = {
      id: c.id,
      category: c.category,
      expected: c.expected_class,
      observed: o,
      verdict,
    };
    if (c.expected_class === "critical")
      outcome.critical =
        o.class === CLASS_NAMES.critical
          ? "detected"
          : o.class === CLASS_NAMES.review
            ? "in_review"
            : "missed";
    return outcome;
  });
  const by = (f: (o: Outcome) => boolean) => outcomes.filter(f);
  const criticals = by((o) => o.critical !== undefined);
  const report: Report = {
    total: outcomes.length,
    outcomes,
    coverage: {
      covered: by((o) => o.verdict !== "not_covered").length,
      total: outcomes.length,
    },
    sensitivity: criticals.length
      ? {
          detected: criticals.filter((o) => o.critical === "detected").length,
          expected: criticals.length,
        }
      : null,
    conformity: {
      matches: by((o) => o.verdict === "match").length,
      total: outcomes.length,
    },
    divergences: by((o) => o.verdict === "certainty_divergence"),
    discrepancies: by((o) => o.verdict === "discrepancy"),
    not_covered: by((o) => o.verdict === "not_covered"),
    criticals_in_review: by((o) => o.critical === "in_review"),
    criticals_missed: by((o) => o.critical === "missed"),
    failed: false,
  };
  report.failed =
    report.not_covered.length +
      report.criticals_in_review.length +
      report.criticals_missed.length +
      report.discrepancies.length >
    0;
  return report;
}
