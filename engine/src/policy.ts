import type { RuleSetResult, TraceEntry, Tri } from "./types.ts";

// PROVISIONAL, team-defined class policy (F039). Pure: no I/O. Never reads `fired`
// (it merges unknown with false); reads `rules[].result` and `rules[].trace`.
export type Severity = "critical" | "watch";
export type ClassId = "critical" | "watch" | "no_alert" | "review";
export type ReasonCode =
  | "rule_true"
  | "partial_criteria"
  | "could_escalate"
  | "incomplete_for_no_alert"
  | "all_criteria_clear";
export type RuleBasis = {
  rule_id: string;
  result: Tri;
  severity: Severity;
  class: ClassId;
  reason_code: ReasonCode;
  reachable: Exclude<ClassId, "review">;
  unknown_leaves: number;
  counts: {
    t: number;
    u: number;
    f: number;
    min: number;
    max: number;
  } | null;
};
export type ClassDecision = {
  class: ClassId;
  reason_code: ReasonCode;
  provisional: true;
  policy_version: string;
  highest_reachable_class: Exclude<ClassId, "review">;
  conflict: boolean;
  basis: RuleBasis[];
};

// Changing the decision table requires bumping this constant.
export const POLICY_VERSION = "policy-provisional-1";

export type PolicyErrorCode =
  | "empty_result"
  | "missing_severity"
  | "invalid_input";

// Fixed message per code: never a rule id or value.
const POLICY_ERROR_MESSAGES: Readonly<Record<PolicyErrorCode, string>> = {
  empty_result: "result has no rules",
  missing_severity: "a rule has no severity",
  invalid_input: "policy input is malformed",
};

export class PolicyError extends Error {
  code: PolicyErrorCode;
  constructor(code: PolicyErrorCode) {
    super(POLICY_ERROR_MESSAGES[code]);
    this.name = "PolicyError";
    this.code = code;
  }
}

const invalid = (): never => {
  throw new PolicyError("invalid_input");
};

// Final-class rank: a possible critical in review must outrank a vigilancia.
const CLASS_RANK: Readonly<Record<ClassId, number>> = {
  no_alert: 0,
  watch: 1,
  review: 2,
  critical: 3,
};
const REACH_RANK: Readonly<Record<Exclude<ClassId, "review">, number>> = {
  no_alert: 0,
  watch: 1,
  critical: 2,
};

// Own data properties only: accessors count as absent, so no user code runs on read.
const own = (o: object, k: string): unknown =>
  Object.getOwnPropertyDescriptor(o, k)?.value;
const isObject = (x: unknown): x is object =>
  typeof x === "object" && x !== null;

function basisFor(rule: unknown, severities: unknown): RuleBasis {
  if (!isObject(rule)) return invalid();
  const rule_id = own(rule, "rule_id");
  const result = own(rule, "result");
  const trace = own(rule, "trace");
  if (typeof rule_id !== "string") return invalid();
  if (result !== true && result !== false && result !== "unknown")
    return invalid();
  if (!Array.isArray(trace)) return invalid();
  if (!(severities instanceof Map)) return invalid();
  const severity: unknown = severities.get(rule_id);
  if (severity === undefined) throw new PolicyError("missing_severity");
  if (severity !== "critical" && severity !== "watch") return invalid();

  let unknown_leaves = 0;
  let leaves = 0;
  // A single-leaf combine has no "combine" entry (the leaf is the root): counts stay null.
  let root: TraceEntry | undefined;
  for (let i = 0; i < trace.length; i++) {
    const e: unknown = own(trace, String(i));
    if (!isObject(e)) return invalid();
    if (own(e, "kind") === "leaf") {
      const lr = own(e, "result");
      if (lr !== true && lr !== false && lr !== "unknown") return invalid();
      leaves++;
      if (lr === "unknown") unknown_leaves++;
    }
    if (own(e, "id") === "combine") root = e as TraceEntry;
  }
  // A false rule with no leaf evidence must never read as all clear.
  if (result === false && leaves === 0) return invalid();

  let counts: RuleBasis["counts"] = null;
  if (root !== undefined && own(root, "kind") === "atLeast") {
    const c = {
      t: own(root, "t"),
      u: own(root, "u"),
      f: own(root, "f"),
      min: own(root, "min"),
      max: own(root, "max"),
    };
    if (
      typeof c.t !== "number" ||
      typeof c.u !== "number" ||
      typeof c.f !== "number" ||
      typeof c.min !== "number" ||
      typeof c.max !== "number"
    )
      return invalid();
    counts = { t: c.t, u: c.u, f: c.f, min: c.min, max: c.max };
  }

  const base = {
    rule_id,
    result: result as Tri,
    severity: severity as Severity,
    unknown_leaves,
    counts,
  };
  if (result === true)
    return {
      ...base,
      class: base.severity,
      reason_code: "rule_true",
      reachable: base.severity,
    };
  if (result === "unknown")
    return {
      ...base,
      class: "review",
      reason_code: "could_escalate",
      reachable: base.severity,
    };
  const crit = severity === "critical";
  if (unknown_leaves > 0)
    return {
      ...base,
      class: "review",
      reason_code: "incomplete_for_no_alert",
      reachable:
        crit && counts !== null && counts.max >= 1 ? "watch" : "no_alert",
    };
  if (crit && counts !== null && counts.t >= 1)
    return {
      ...base,
      class: "watch",
      reason_code: "partial_criteria",
      reachable: "watch",
    };
  return {
    ...base,
    class: "no_alert",
    reason_code: "all_criteria_clear",
    reachable: "no_alert",
  };
}

// Total: any non-PolicyError (getter, Proxy, throwing Map) fails closed as invalid_input.
export function classify(
  result: RuleSetResult,
  severities: ReadonlyMap<string, Severity>,
): ClassDecision {
  try {
    return classifyUnchecked(result, severities);
  } catch (e) {
    if (e instanceof PolicyError) throw e;
    throw new PolicyError("invalid_input");
  }
}

function classifyUnchecked(
  result: RuleSetResult,
  severities: ReadonlyMap<string, Severity>,
): ClassDecision {
  if (!isObject(result)) return invalid();
  const rules: unknown = own(result, "rules");
  if (!Array.isArray(rules)) return invalid();
  if (rules.length === 0) throw new PolicyError("empty_result");

  const basis: RuleBasis[] = [];
  for (let i = 0; i < rules.length; i++)
    basis.push(basisFor(own(rules, String(i)), severities));

  let top = basis[0] as RuleBasis;
  let reach = top.reachable;
  let conflict = false;
  for (let i = 1; i < basis.length; i++) {
    const b = basis[i] as RuleBasis;
    // Tie on class: the rule with the highest reachable class explains the decision.
    if (
      CLASS_RANK[b.class] > CLASS_RANK[top.class] ||
      (b.class === top.class &&
        REACH_RANK[b.reachable] > REACH_RANK[top.reachable])
    )
      top = b;
    if (REACH_RANK[b.reachable] > REACH_RANK[reach]) reach = b.reachable;
    if (b.class !== (basis[0] as RuleBasis).class) conflict = true;
  }
  return {
    class: top.class,
    reason_code: top.reason_code,
    provisional: true,
    policy_version: POLICY_VERSION,
    highest_reachable_class: reach,
    conflict,
    basis,
  };
}
