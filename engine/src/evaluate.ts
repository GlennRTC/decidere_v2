import type {
  Condition,
  Input,
  Node,
  Op,
  Rule,
  RuleResult,
  RuleSet,
  RuleSetResult,
  TraceEntry,
  Tri,
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

// Kleene three-valued walk (ADR-007 Apéndice C). Evaluates every child, no short-circuit;
// combinator entries are appended in post-order with positional ids.
function evaluateNode(
  node: Node,
  path: string,
  byId: ReadonlyMap<string, Tri>,
  trace: TraceEntry[],
): Tri {
  if (typeof node === "string") return byId.get(node) ?? "unknown";
  if ("not" in node) {
    const r = evaluateNode(node.not, `${path}.0`, byId, trace);
    const result: Tri = r === "unknown" ? r : !r;
    trace.push({ id: path, kind: "not", result });
    return result;
  }
  const isAtLeast = "atLeast" in node;
  const isAll = "all" in node;
  const list = isAtLeast
    ? node.atLeast.of
    : "all" in node
      ? node.all
      : node.any;
  const rs = list.map((child, i) =>
    evaluateNode(child, `${path}.${i}`, byId, trace),
  );
  const t = rs.filter((r) => r === true).length;
  const u = rs.filter((r) => r === "unknown").length;
  const f = rs.length - t - u;
  if (isAtLeast) {
    const need = node.atLeast.n;
    const result: Tri = t >= need ? true : t + u < need ? false : "unknown";
    trace.push({
      id: path,
      kind: "atLeast",
      result,
      t,
      u,
      f,
      min: t,
      max: t + u,
    });
    return result;
  }
  const result: Tri = isAll
    ? f > 0
      ? false
      : u > 0
        ? "unknown"
        : true
    : t > 0
      ? true
      : u > 0
        ? "unknown"
        : false;
  trace.push({ id: path, kind: isAll ? "all" : "any", result });
  return result;
}

function evaluateRule(rule: Readonly<Rule>, input: Input): RuleResult {
  const trace: TraceEntry[] = rule.conditions.map((c) =>
    evaluateCondition(c, input),
  );
  const byId = new Map(trace.map((e) => [e.id, e.result] as const));
  const result = evaluateNode(rule.combine, "combine", byId, trace);
  return { rule_id: rule.id, result, trace };
}

export function evaluateRuleSet(ruleSet: RuleSet, input: Input): RuleSetResult {
  const rules = ruleSet.map((r) => evaluateRule(r, input));
  return {
    rules,
    fired: rules.filter((r) => r.result === true).map((r) => r.rule_id),
  };
}
