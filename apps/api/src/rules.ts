import { fileURLToPath } from "node:url";
import {
  type LoadedMappings,
  type LoadedRuleSet,
  loadMappingSet,
  loadRuleSet,
} from "@decidere/rules";
import { MESSAGE_VARIABLES } from "@decidere/schema";

export const DEFAULT_RULES_DIR = fileURLToPath(
  new URL("../../../knowledge/rules/", import.meta.url),
);

// Fail closed on variables the schema cannot deliver (a rule that never fires),
// and: without a severity per rule every POST would end in internal_error.
export function loadActiveRules(dir: string): LoadedRuleSet {
  const loaded = loadRuleSet(dir, { variables: MESSAGE_VARIABLES });
  if (
    loaded.meta.length === 0 ||
    loaded.severities.size !== loaded.meta.length
  ) {
    throw Object.assign(new Error("every active rule needs a severity"), {
      code: "missing_severity",
    });
  }
  return loaded;
}

export const DEFAULT_MAPPINGS_DIR = fileURLToPath(
  new URL("../../../knowledge/mappings/", import.meta.url),
);

export const loadActiveMappings = (dir: string): LoadedMappings =>
  loadMappingSet(dir, { variables: MESSAGE_VARIABLES });
