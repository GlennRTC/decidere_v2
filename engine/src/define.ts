import type {
  Condition,
  Node,
  Op,
  Rule,
  RuleErrorCode,
  RuleSet,
} from "./types.ts";
import { RuleError } from "./types.ts";

const OPS: ReadonlySet<string> = new Set([">", ">=", "<", "<=", "=="]);
const MAX_DEPTH = 64; // root combinator is depth 0 (ADR-007, por confirmar)

const fail = (code: RuleErrorCode, path: string): never => {
  throw new RuleError(code, path);
};
const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(o, key) ? o[key] : undefined;
const nonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x !== "";

function buildCondition(
  raw: unknown,
  path: string,
  variables: ReadonlySet<string> | undefined,
): Condition {
  if (!isObject(raw)) return fail("invalid_condition", path);
  const { id, label, variable, op, value, unit } = {
    id: own(raw, "id"),
    label: own(raw, "label"),
    variable: own(raw, "variable"),
    op: own(raw, "op"),
    value: own(raw, "value"),
    unit: own(raw, "unit"),
  };
  if (
    !nonEmptyString(id) ||
    typeof label !== "string" ||
    typeof variable !== "string" ||
    typeof unit !== "string"
  )
    return fail("invalid_condition", path);
  if (typeof op !== "string" || !OPS.has(op))
    return fail("invalid_condition", path);
  if (typeof value !== "number" || !Number.isFinite(value))
    return fail("invalid_condition", path);
  if (variables && !variables.has(variable))
    return fail("unknown_variable", path);
  return Object.freeze({ id, label, variable, op: op as Op, value, unit });
}

// Recursion is bounded: the depth check runs before descending, so at most MAX_DEPTH + 1 frames.
function buildNode(
  raw: unknown,
  path: string,
  depth: number,
  ids: ReadonlySet<string>,
): Node {
  if (depth > MAX_DEPTH) return fail("too_deep", path);
  if (typeof raw === "string")
    return ids.has(raw) ? raw : fail("unknown_reference", path);
  if (!isObject(raw)) return fail("invalid_combinator", path);
  const keys = Object.keys(raw);
  const kind = keys[0];
  if (keys.length !== 1 || kind === undefined)
    return fail("invalid_combinator", path);
  const body = own(raw, kind);
  const children = (list: unknown): Node[] => {
    if (!Array.isArray(list) || list.length === 0)
      return fail("invalid_combinator", path);
    return Object.freeze(
      list.map((child, i) => buildNode(child, `${path}.${i}`, depth + 1, ids)),
    ) as Node[];
  };
  if (kind === "not")
    return Object.freeze({ not: buildNode(body, `${path}.0`, depth + 1, ids) });
  if (kind === "all" || kind === "any")
    return Object.freeze({ [kind]: children(body) }) as Node;
  if (kind === "atLeast") {
    if (!isObject(body)) return fail("invalid_combinator", path);
    const n = own(body, "n");
    const of = children(own(body, "of"));
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > of.length)
      return fail("invalid_combinator", path);
    return Object.freeze({ atLeast: Object.freeze({ n, of }) });
  }
  return fail("invalid_combinator", path);
}

function buildRule(
  raw: unknown,
  index: number,
  variables: ReadonlySet<string> | undefined,
): Rule {
  const path = `rules.${index}`;
  if (!isObject(raw)) return fail("invalid_rule", path);
  const id = own(raw, "id");
  if (!nonEmptyString(id)) return fail("invalid_rule", `${path}.id`);
  const rawConditions = own(raw, "conditions");
  if (!Array.isArray(rawConditions))
    return fail("invalid_rule", `${path}.conditions`);
  const ids = new Set<string>();
  const conditions = rawConditions.map((c, i) => {
    const cond = buildCondition(c, `${path}.conditions.${i}`, variables);
    if (ids.has(cond.id)) fail("duplicate_id", `${path}.conditions.${i}`);
    ids.add(cond.id);
    return cond;
  });
  const combine = buildNode(own(raw, "combine"), `${path}.combine`, 0, ids);
  return Object.freeze({
    id,
    conditions: Object.freeze(conditions) as Condition[],
    combine,
  });
}

// Validates and deep-freezes a copy of `rules`. Only RuleError escapes.
export function defineRuleSet(
  rules: unknown,
  options?: { variables?: ReadonlySet<string> },
): RuleSet {
  try {
    if (!Array.isArray(rules) || rules.length === 0)
      return fail("invalid_rule_set", "rules");
    const seen = new Set<string>();
    const built = rules.map((r, i) => {
      const rule = buildRule(r, i, options?.variables);
      if (seen.has(rule.id)) fail("duplicate_id", `rules.${i}`);
      seen.add(rule.id);
      return rule;
    });
    return Object.freeze(built);
  } catch (e) {
    if (e instanceof RuleError) throw e;
    // Hostile objects (throwing getters, proxies) must not leak other error types.
    throw new RuleError("invalid_rule_set", "rules");
  }
}
