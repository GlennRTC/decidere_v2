import type { RuleSet, Severity } from "@decidere/engine";
import { defineRuleSet, RuleError } from "@decidere/engine";
import { RuleLoadError } from "./errors.ts";
import { inFile, readYamlFiles } from "./files.ts";
import { checkRuleDoc, type RuleDoc } from "./schema.ts";
import { computeRuleSetVersion, type RuleMeta } from "./version.ts";

export type { RuleMeta } from "./version.ts";
export type LoadedRuleSet = {
  ruleSet: RuleSet;
  meta: readonly RuleMeta[];
  rule_set_version: string;
  severities: ReadonlyMap<string, Severity>;
  approval: "pending" | "approved";
};

// Loads every <id>.yaml in `dir` (non-recursive). Fails closed: any problem in any file,
// including disabled ones, rejects the whole load.
export function loadRuleSet(
  dir: string,
  options: { variables: ReadonlySet<string> },
): LoadedRuleSet {
  if (
    typeof options !== "object" ||
    options === null ||
    !(options.variables instanceof Set)
  )
    throw new RuleLoadError({ code: "invalid_options" });
  const docs: { file: string; doc: RuleDoc }[] = [];
  const seen = new Set<string>();
  for (const { file, value } of readYamlFiles(dir)) {
    const doc = inFile(file, () => {
      const checked = checkRuleDoc(value);
      if (seen.has(checked.id))
        throw new RuleLoadError({ code: "duplicate_rule_id", path: "id" });
      seen.add(checked.id);
      if (file !== `${checked.id}.yaml`)
        throw new RuleLoadError({ code: "file_id_mismatch", path: "id" });
      return checked;
    });
    docs.push({ file, doc });
  }

  const active = docs
    .filter((d) => d.doc.enabled)
    .sort((a, b) => (a.doc.id < b.doc.id ? -1 : a.doc.id > b.doc.id ? 1 : 0));
  if (active.length === 0) throw new RuleLoadError({ code: "no_active_rules" });

  let ruleSet: RuleSet;
  try {
    ruleSet = defineRuleSet(
      active.map(({ doc }) => ({
        id: doc.id,
        conditions: doc.conditions,
        combine: doc.combine,
      })),
      { variables: options.variables },
    );
  } catch (err) {
    if (!(err instanceof RuleError)) throw err;
    const m = /^rules\.(\d+)\.?/.exec(err.path);
    const file = m ? active[Number(m[1])]?.file : undefined;
    throw new RuleLoadError({
      code: "invalid_rule",
      path: err.path.replace(/^rules\.\d+\.?/, ""),
      detail: err.code,
      ...(file !== undefined && { file }),
    });
  }

  const meta: RuleMeta[] = active.map(({ doc }) => ({
    id: doc.id,
    title: doc.title,
    ...(doc.severity !== undefined && { severity: doc.severity }),
    citation: doc.citation,
    clinical_approval: doc.clinical_approval,
  }));
  // Only active rules that declare severity; a copy. Direct mutators are blocked below,
  // but Map.prototype.set.call can still mutate the copy; classify re-validates values.
  const severities = new Map<string, Severity>();
  for (const m of meta)
    if (m.severity !== undefined) severities.set(m.id, m.severity);
  // Object.freeze does not stop Map mutation: block the mutators on the instance.
  for (const op of ["set", "delete", "clear"] as const)
    Object.defineProperty(severities, op, {
      value: () => {
        throw new TypeError("severities is read-only");
      },
    });
  Object.freeze(severities);
  return {
    ruleSet,
    severities,
    meta,
    rule_set_version: computeRuleSetVersion(ruleSet, meta),
    approval: meta.every((m) => m.clinical_approval.status === "approved")
      ? "approved"
      : "pending",
  };
}
