import type {
  Condition,
  Input,
  Op,
  Rule,
  RuleResult,
  RuleSet,
  RuleSetResult,
  TraceEntry,
} from "./types.ts";

const OPERATORS: ReadonlyMap<Op, (a: number, b: number) => boolean> = new Map<
  Op,
  (a: number, b: number) => boolean
>([
  [">", (a, b) => a > b],
  [">=", (a, b) => a >= b],
  ["<", (a, b) => a < b],
  ["<=", (a, b) => a <= b],
  ["==", (a, b) => a === b],
]);

type Leaf = Extract<TraceEntry, { kind: "leaf" }>;

// Reads only own properties; the raw value is never copied into the trace.
function evaluateCondition(c: Condition, input: Input): Leaf {
  const base = {
    id: c.id,
    kind: "leaf" as const,
    op: c.op,
    threshold: c.value,
    unit: c.unit,
    label: c.label,
  };
  const raw = Object.hasOwn(input, c.variable) ? input[c.variable] : undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const compare = OPERATORS.get(c.op) as (a: number, b: number) => boolean;
    return { ...base, result: compare(raw, c.value), observed: raw };
  }
  const reason = raw === undefined || raw === null ? "missing" : "invalid";
  return { ...base, result: "unknown", observed: null, reason };
}

function evaluateRule(rule: Readonly<Rule>, input: Input): RuleResult {
  const trace: TraceEntry[] = rule.conditions.map((c) =>
    evaluateCondition(c, input),
  );
  // Combinators arrive in Task 3.
  if (typeof rule.combine !== "string") throw new Error("not implemented");
  const root = rule.combine;
  const leaf = trace.find((t) => t.id === root);
  return { rule_id: rule.id, result: leaf?.result ?? "unknown", trace };
}

export function evaluateRuleSet(ruleSet: RuleSet, input: Input): RuleSetResult {
  const rules = ruleSet.map((r) => evaluateRule(r, input));
  return {
    rules,
    fired: rules.filter((r) => r.result === true).map((r) => r.rule_id),
  };
}
