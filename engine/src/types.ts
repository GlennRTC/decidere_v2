export type Tri = boolean | "unknown";
export type Op = ">" | ">=" | "<" | "<=" | "==";
export type Condition = {
  id: string;
  label: string;
  variable: string;
  op: Op;
  value: number;
  unit: string;
};
export type Node =
  | string
  | { all: Node[] }
  | { any: Node[] }
  | { not: Node }
  | { atLeast: { n: number; of: Node[] } };
export type Rule = { id: string; conditions: Condition[]; combine: Node };
declare const brand: unique symbol;
// Deep-frozen, produced only by defineRuleSet (also enforced at runtime by evaluateRuleSet).
export type RuleSet = readonly Readonly<Rule>[] & { readonly [brand]: true };

export type RuleErrorCode =
  | "invalid_rule_set"
  | "invalid_rule"
  | "invalid_condition"
  | "invalid_combinator"
  | "duplicate_id"
  | "unknown_reference"
  | "unknown_variable"
  | "too_deep";

// Fixed message per code: never a rule value, key name or input value. `path` holds positions only.
export const RULE_ERROR_MESSAGES: Readonly<Record<RuleErrorCode, string>> = {
  invalid_rule_set: "rule set must be a non-empty array",
  invalid_rule: "rule is malformed",
  invalid_condition: "condition is malformed",
  invalid_combinator: "combinator is malformed",
  duplicate_id: "duplicate id",
  unknown_reference: "combinator references an unknown condition",
  unknown_variable: "condition uses a variable outside the allowed set",
  too_deep: "combinator nesting is too deep",
};

export class RuleError extends Error {
  code: RuleErrorCode;
  path: string;
  constructor(code: RuleErrorCode, path: string) {
    super(RULE_ERROR_MESSAGES[code]);
    this.name = "RuleError";
    this.code = code;
    this.path = path;
  }
}

export type Input = Readonly<Record<string, unknown>>;
export type TraceEntry =
  | {
      id: string;
      kind: "leaf";
      result: Tri;
      observed: number | null;
      op: Op;
      threshold: number;
      unit: string;
      label: string;
      reason?: "missing" | "invalid";
    }
  | { id: string; kind: "all" | "any" | "not"; result: Tri }
  | {
      id: string;
      kind: "atLeast";
      result: Tri;
      t: number;
      u: number;
      f: number;
      min: number;
      max: number;
    };
export type RuleResult = { rule_id: string; result: Tri; trace: TraceEntry[] };
export type RuleSetResult = { rules: RuleResult[]; fired: string[] };
