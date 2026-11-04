import { type LoadedRuleSet, loadRuleSet } from "@decidere/rules";
import { CANONICAL_VARIABLES } from "./interpret.ts";

export const DEFAULT_RULES_DIR = new URL(
  "../../../knowledge/rules/",
  import.meta.url,
).pathname;

// Fail closed: without a severity per rule every POST would end in internal_error.
export function loadActiveRules(dir: string): LoadedRuleSet {
  const loaded = loadRuleSet(dir, { variables: CANONICAL_VARIABLES });
  if (
    loaded.meta.length === 0 ||
    loaded.severities.size !== loaded.meta.length
  ) {
    throw new Error("every active rule needs a severity");
  }
  return loaded;
}
