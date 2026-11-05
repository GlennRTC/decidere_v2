import { randomUUID } from "node:crypto";
import {
  type CertaintyBreakdown,
  type ClassId,
  classify,
  computeCertainty,
  evaluateRuleSet,
  POLICY_VERSION,
  type RuleResult,
  routeByCertainty,
  TAU_PROVISIONAL,
} from "@decidere/engine";
import type { LoadedRuleSet } from "@decidere/rules";
import { currentInstances, type Message } from "@decidere/schema";

// Re-exported so existing imports keep working; the source is the F042 catalog.
export { CANONICAL_VARIABLES } from "@decidere/schema";

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
  routed_from: string | null;
  highest_reachable_class: ClassId;
  conflict: boolean;
  requires_confirmation: boolean;
  certainty: CertaintyBreakdown;
  rules_fired: string[];
  trace: RuleResult[];
  unmapped: string[];
};

export type Interpretation = {
  message_id: string;
  mapping_version: string;
  rule_set: { version: string; approval: "pending" | "approved" };
  policy: { version: string; provisional: true };
  historical_ignored: number;
  results: CaseResult[];
};

type Instance = Message["instances"][number];

// Provisional (clinical question open): per variable, the measurement closest to
// now (largest t_offset_min) wins among non-null values; none means `unknown`.
function engineInput(instance: Instance): Record<string, number> {
  const latest = new Map<string, { t: number; value: number | null }>();
  for (const v of instance.variables) {
    // A null entry never hides a real measurement (a missed critical is the
    // unacceptable error); a variable with only nulls stays missing.
    if (v.value === null) continue;
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
  mapping: { version: string; unmapped: string[][] } = {
    version: "identity",
    unmapped: [],
  },
  tau: number = TAU_PROVISIONAL,
): Interpretation {
  const current = currentInstances(message);
  const results = current.map((instance): CaseResult => {
    const evaluated = evaluateRuleSet(loaded.ruleSet, engineInput(instance));
    const decision = classify(evaluated, loaded.severities);
    const certainty = computeCertainty(
      loaded.ruleSet,
      evaluated,
      decision,
      tau,
    );
    const routed = routeByCertainty(decision.class, certainty);
    return {
      case_id: newCaseId(),
      class: CLASS_NAMES[routed.class],
      reason_code: routed.routed_from ? "low_certainty" : decision.reason_code,
      routed_from: routed.routed_from ? CLASS_NAMES[routed.routed_from] : null,
      highest_reachable_class: decision.highest_reachable_class,
      conflict: decision.conflict,
      requires_confirmation: certainty.requires_confirmation,
      certainty,
      rules_fired: evaluated.fired,
      trace: evaluated.rules,
      unmapped: mapping.unmapped[message.instances.indexOf(instance)] ?? [],
    };
  });
  return {
    message_id: message.message_id,
    mapping_version: mapping.version,
    rule_set: { version: loaded.rule_set_version, approval: loaded.approval },
    policy: { version: POLICY_VERSION, provisional: true },
    historical_ignored: message.instances.length - current.length,
    results,
  };
}
