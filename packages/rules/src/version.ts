import { createHash } from "node:crypto";
import type { RuleSet } from "@decidere/engine";
import type { Citation, ClinicalApproval } from "./schema.ts";

export type RuleMeta = {
  id: string;
  title: string;
  citation: Citation;
  clinical_approval: ClinicalApproval;
};

// Sorted keys (plain code-unit order, no locale), arrays in order, no whitespace.
// Only called with plain data (frozen engine rules and meta).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ruleSet and meta share one order; the hash is over rules sorted by id.
export function computeRuleSetVersion(
  ruleSet: RuleSet,
  meta: readonly RuleMeta[],
): string {
  const rules = ruleSet
    .map((rule, i) => ({ rule, meta: meta[i] }))
    .sort((a, b) =>
      a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0,
    );
  const digest = createHash("sha256")
    .update(canonicalJson({ v: 1, rules }))
    .digest("hex");
  return `rs-${digest.slice(0, 16)}`;
}
