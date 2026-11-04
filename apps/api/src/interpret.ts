import { randomUUID } from "node:crypto";
import {
  type ClassId,
  classify,
  evaluateRuleSet,
  POLICY_VERSION,
  type RuleResult,
} from "@decidere/engine";
import type { LoadedRuleSet } from "@decidere/rules";
import { currentInstances, type Message } from "@decidere/schema";

// Replaced by the F042 canonical catalog.
export const CANONICAL_VARIABLES: ReadonlySet<string> = new Set([
  "resp_rate",
  "sbp",
  "gcs",
]);

export const CLASS_NAMES: Record<ClassId, string> = {
  critical: "crítico",
  watch: "vigilancia",
  no_alert: "sin alerta",
  review: "revisión clínica",
};

export type CaseResult = {
  case_id: string;
  class: string;
  reason_code: string;
  highest_reachable_class: ClassId;
  conflict: boolean;
  certainty: null; // F047
  rules_fired: string[];
  trace: RuleResult[];
};

export type Interpretation = {
  message_id: string;
  rule_set: { version: string; approval: "pending" | "approved" };
  policy: { version: string; provisional: true };
  historical_ignored: number;
  results: CaseResult[];
};

type Instance = Message["instances"][number];

// Provisional (clinical question open): per variable, the measurement closest to
// now (largest t_offset_min) wins. null means missing, so the leaf is `unknown`.
function engineInput(instance: Instance): Record<string, number> {
  const latest = new Map<string, { t: number; value: number | null }>();
  for (const v of instance.variables) {
    const prev = latest.get(v.variable);
    if (!prev || v.t_offset_min > prev.t)
      latest.set(v.variable, { t: v.t_offset_min, value: v.value });
  }
  const input: Record<string, number> = {};
  for (const [name, { value }] of latest)
    if (value !== null) input[name] = value;
  return input;
}

export function interpretMessage(
  message: Message,
  loaded: LoadedRuleSet,
  newCaseId: () => string = randomUUID,
): Interpretation {
  const current = currentInstances(message);
  const results = current.map((instance): CaseResult => {
    const evaluated = evaluateRuleSet(loaded.ruleSet, engineInput(instance));
    const decision = classify(evaluated, loaded.severities);
    return {
      case_id: newCaseId(),
      class: CLASS_NAMES[decision.class],
      reason_code: decision.reason_code,
      highest_reachable_class: decision.highest_reachable_class,
      conflict: decision.conflict,
      certainty: null,
      rules_fired: evaluated.fired,
      trace: evaluated.rules,
    };
  });
  return {
    message_id: message.message_id,
    rule_set: { version: loaded.rule_set_version, approval: loaded.approval },
    policy: { version: POLICY_VERSION, provisional: true },
    historical_ignored: message.instances.length - current.length,
    results,
  };
}
