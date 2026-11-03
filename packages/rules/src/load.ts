import fs from "node:fs";
import path from "node:path";
import type { RuleSet } from "@decidere/engine";
import { defineRuleSet, RuleError } from "@decidere/engine";
import { RuleLoadError } from "./errors.ts";
import { parseRuleYaml } from "./parse.ts";
import { checkRuleDoc, type RuleDoc } from "./schema.ts";
import { computeRuleSetVersion, type RuleMeta } from "./version.ts";

export type { RuleMeta } from "./version.ts";
export type LoadedRuleSet = {
  ruleSet: RuleSet;
  meta: readonly RuleMeta[];
  rule_set_version: string;
  approval: "pending" | "approved";
};

const MAX_FILES = 200;
const MAX_BYTES = 65536;

// Re-throws a stage error with the file name attached (file is readonly).
function inFile<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof RuleLoadError) || err.file !== undefined) throw err;
    throw new RuleLoadError({
      code: err.code,
      path: err.path,
      ...(err.line !== undefined && { line: err.line }),
      ...(err.detail !== undefined && { detail: err.detail }),
      file,
    });
  }
}

// Bounded read: no symlink following, regular files only, never more than MAX_BYTES + 1 bytes.
function readBounded(dir: string, name: string): Buffer {
  const fd = fs.openSync(
    path.join(dir, name),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    for (;;) {
      const r = fs.readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
      if (n > MAX_BYTES)
        throw new RuleLoadError({ code: "file_too_large", file: name });
    }
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Loads every <id>.yaml in `dir` (non-recursive). Fails closed: any problem in any file,
// including disabled ones, rejects the whole load.
export function loadRuleSet(
  dir: string,
  options: { variables: ReadonlySet<string> },
): LoadedRuleSet {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length > MAX_FILES)
    throw new RuleLoadError({ code: "too_many_files" });
  const names = entries.map((e) => e.name).sort();
  for (const e of entries)
    if (!e.isFile() || !e.name.endsWith(".yaml") || e.name === ".yaml")
      throw new RuleLoadError({ code: "unsupported_entry", file: e.name });
  // All sizes are enforced before any content is read.
  for (const name of names)
    if (fs.lstatSync(path.join(dir, name)).size > MAX_BYTES)
      throw new RuleLoadError({ code: "file_too_large", file: name });

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const docs: { file: string; doc: RuleDoc }[] = [];
  const seen = new Set<string>();
  for (const file of names) {
    const doc = inFile(file, () => {
      const bytes = readBounded(dir, file);
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        throw new RuleLoadError({ code: "not_utf8" });
      }
      const checked = checkRuleDoc(parseRuleYaml(text));
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
    citation: doc.citation,
    clinical_approval: doc.clinical_approval,
  }));
  return {
    ruleSet,
    meta,
    rule_set_version: computeRuleSetVersion(ruleSet, meta),
    approval: meta.every((m) => m.clinical_approval.status === "approved")
      ? "approved"
      : "pending",
  };
}
