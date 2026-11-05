import type { ClassDecision } from "./policy.ts";
import { PolicyError } from "./policy.ts";
import type { RuleSet, RuleSetResult } from "./types.ts";

// PROVISIONAL, team-defined certainty (F047, ADR-003): min of three components in [0,1].
// Pure: no I/O, no clock. Never changes the decided class; only flags a critical below tau.
export const CERTAINTY_VERSION = "certainty-provisional-2";
export const TAU_PROVISIONAL = 0.5;

// Distance from a threshold, in the variable's unit, that counts as full margin.
// Provisional: needs clinical review and calibration (F049).
export const VARIABLE_BANDS: Readonly<Record<string, number>> = Object.freeze({
  resp_rate: 4, // /min
  sbp: 10, // mm[Hg]
  gcs: 1, // {score}
  heart_rate: 10, // /min
  temperature: 0.5, // Cel
  wbc: 2, // 10*3/uL
  paco2: 4, // mm[Hg]
  bands_pct: 2, // %
});

// PROVISIONAL: variables on an integer scale. Their margin is measured to the
// half-integer boundary between the last true and first false value (F047).
const INTEGER_SCALE: ReadonlySet<string> = new Set(["gcs"]);

// Boundary between true and false integers: `x < 15` is true up to 14, so 14.5.
const halfIntegerBoundary = (op: unknown, threshold: number): number =>
  op === "<" || op === ">="
    ? threshold - 0.5
    : op === "<=" || op === ">"
      ? threshold + 0.5
      : threshold;

export type CertaintyBreakdown = {
  completeness: number;
  margin: number;
  conflict: number;
  value: number;
  tau: number;
  below_tau: boolean;
  requires_confirmation: boolean;
  provisional: true;
  version: string;
};

const invalid = (): never => {
  throw new PolicyError("invalid_input");
};
const own = (o: object, k: string): unknown =>
  Object.getOwnPropertyDescriptor(o, k)?.value;
const isObject = (x: unknown): x is object =>
  typeof x === "object" && x !== null;
const num = (x: unknown): number =>
  typeof x === "number" && Number.isFinite(x) ? x : (invalid() as never);
const list = (x: unknown): unknown[] =>
  Array.isArray(x) ? x : (invalid() as never);

export function computeCertainty(
  ruleSet: RuleSet,
  result: RuleSetResult,
  decision: ClassDecision,
  tau: number = TAU_PROVISIONAL,
): CertaintyBreakdown {
  try {
    return compute(ruleSet, result, decision, tau);
  } catch (e) {
    if (e instanceof PolicyError) throw e;
    throw new PolicyError("invalid_input");
  }
}

function compute(
  ruleSet: RuleSet,
  result: RuleSetResult,
  decision: ClassDecision,
  tau: number,
): CertaintyBreakdown {
  if (!isObject(result) || !isObject(decision)) return invalid();
  if (typeof tau !== "number" || Number.isNaN(tau)) return invalid();
  const defs = list(ruleSet);
  const rules = list(own(result, "rules"));
  const basis = list(own(decision, "basis"));
  if (rules.length === 0 || basis.length === 0) return invalid();

  let completeness = 1;
  let margin = 1;
  for (const rule of rules) {
    if (!isObject(rule)) return invalid();
    const def = defs.find(
      (d) => isObject(d) && own(d, "id") === own(rule, "rule_id"),
    );
    if (!isObject(def)) return invalid();
    const conditions = list(own(def, "conditions"));
    let leaves = 0;
    let known = 0;
    let rootCounts: number | null = null;
    for (const e of list(own(rule, "trace"))) {
      if (!isObject(e)) return invalid();
      const kind = own(e, "kind");
      if (kind === "atLeast" && own(e, "id") === "combine") {
        const t = num(own(e, "t"));
        const u = num(own(e, "u"));
        const f = num(own(e, "f"));
        rootCounts = t + u + f === 0 ? 1 : 1 - u / (t + u + f);
      }
      if (kind !== "leaf") continue;
      leaves++;
      if (own(e, "result") === "unknown") continue;
      known++;
      const cd = conditions.find(
        (c) => isObject(c) && own(c, "id") === own(e, "id"),
      );
      if (!isObject(cd)) return invalid();
      const variable = own(cd, "variable");
      if (typeof variable !== "string") return invalid();
      const band = Object.hasOwn(VARIABLE_BANDS, variable)
        ? (VARIABLE_BANDS[variable] as number)
        : 0;
      const threshold = num(own(e, "threshold"));
      const edge = INTEGER_SCALE.has(variable)
        ? halfIntegerBoundary(own(e, "op"), threshold)
        : threshold;
      const m =
        band > 0
          ? Math.min(1, Math.abs(num(own(e, "observed")) - edge) / band)
          : 0;
      margin = Math.min(margin, m);
    }
    if (leaves === 0) return invalid();
    completeness = Math.min(completeness, rootCounts ?? known / leaves);
  }

  let same = 0;
  for (const b of basis) {
    if (!isObject(b)) return invalid();
    if (own(b, "class") === own(decision, "class")) same++;
  }
  const conflict = same / basis.length;

  const value = Math.min(completeness, margin, conflict);
  const below_tau = value < tau;
  return {
    completeness,
    margin,
    conflict,
    value,
    tau,
    below_tau,
    requires_confirmation: own(decision, "class") === "critical" && below_tau,
    provisional: true,
    version: CERTAINTY_VERSION,
  };
}
