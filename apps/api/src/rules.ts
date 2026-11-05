import { fileURLToPath } from "node:url";
import {
  type LoadedMappings,
  type LoadedRuleSet,
  loadMappingSet,
  loadRuleSet,
} from "@decidere/rules";
import { DELIVERABLE_VARIABLES, VARIABLE_CATALOG } from "@decidere/schema";

export const DEFAULT_RULES_DIR = fileURLToPath(
  new URL("../../../knowledge/rules/", import.meta.url),
);

// Fail closed on variables the schema cannot deliver (a rule that never fires),
// and: without a severity per rule every POST would end in internal_error.
export function loadActiveRules(dir: string): LoadedRuleSet {
  // A rule on a variable only contract 1.1 can deliver loads, but never fires for a 1.0 message or a 1.1 source whose mapping table lacks the code.
  const loaded = loadRuleSet(dir, { variables: DELIVERABLE_VARIABLES });
  if (
    loaded.meta.length === 0 ||
    loaded.severities.size !== loaded.meta.length
  ) {
    throw Object.assign(new Error("every active rule needs a severity"), {
      code: "missing_severity",
    });
  }
  const ucum = new Map(VARIABLE_CATALOG.map((e) => [e.variable, e.ucum]));
  for (const rule of loaded.ruleSet) {
    for (const c of rule.conditions) {
      if (ucum.get(c.variable) !== c.unit) {
        throw Object.assign(
          new Error("a rule condition unit differs from the catalog"),
          { code: "unit_mismatch" },
        );
      }
    }
  }
  return loaded;
}

export const DEFAULT_MAPPINGS_DIR = fileURLToPath(
  new URL("../../../knowledge/mappings/", import.meta.url),
);

export const loadActiveMappings = (dir: string): LoadedMappings =>
  loadMappingSet(dir, { variables: DELIVERABLE_VARIABLES });
