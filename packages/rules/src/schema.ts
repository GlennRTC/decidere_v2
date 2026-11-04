import type { Severity } from "@decidere/engine";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";

export type Citation = { source: string; version: string; section: string };
export type ClinicalApproval = {
  status: "pending" | "approved";
  approver: string | null;
  guideline_version: string | null;
};
export type RuleDoc = {
  format_version: 1;
  id: string;
  title: string;
  severity?: Severity;
  citation: Citation;
  clinical_approval: ClinicalApproval;
  enabled: boolean;
  conditions: unknown[];
  combine: unknown;
};

const MAX_DEPTH = 64; // same bound as the engine; root combinator is depth 0
const MAX_STRING = 200;
const RULE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const COMBINATORS: ReadonlySet<string> = new Set([
  "all",
  "any",
  "not",
  "atLeast",
]);

// Paths are positional dot paths built only from our own schema names and indexes.
// An unknown key reports the PARENT path; a missing/invalid key reports its own path.
const join = (path: string, key: string | number): string =>
  path === "" ? String(key) : `${path}.${key}`;

const fail = (code: RuleLoadErrorCode, path: string): never => {
  throw new RuleLoadError({ code, path });
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(o, key) ? o[key] : undefined;

// Exact key set: unknown keys first (so a typo is reported as such), then missing ones.
function exactKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    if (!required.includes(k) && !optional.includes(k))
      fail("unknown_key", path);
  }
  for (let i = 0; i < required.length; i++) {
    const k = required[i] as string;
    if (!Object.hasOwn(obj, k)) fail("missing_key", join(path, k));
  }
}

function object(x: unknown, path: string): Record<string, unknown> {
  return isObject(x) ? x : fail("invalid_type", path);
}

function str(x: unknown, path: string): string {
  if (typeof x !== "string") return fail("invalid_type", path);
  if (x === "" || x.length > MAX_STRING) return fail("invalid_value", path);
  return x;
}

function num(x: unknown, path: string): number {
  if (typeof x !== "number") return fail("invalid_type", path);
  if (!Number.isFinite(x)) return fail("invalid_value", path);
  return x === 0 ? 0 : x; // -0 -> 0
}

function array(x: unknown, path: string): unknown[] {
  return Array.isArray(x) ? x : fail("invalid_type", path);
}

function checkCondition(raw: unknown, path: string): Record<string, unknown> {
  const c = object(raw, path);
  exactKeys(c, ["id", "label", "variable", "op", "value", "unit"], path);
  return {
    id: str(own(c, "id"), join(path, "id")),
    label: str(own(c, "label"), join(path, "label")),
    variable: str(own(c, "variable"), join(path, "variable")),
    op: str(own(c, "op"), join(path, "op")),
    value: num(own(c, "value"), join(path, "value")),
    unit: str(own(c, "unit"), join(path, "unit")),
  };
}

function checkList(raw: unknown, path: string, depth: number): unknown[] {
  const list = array(raw, path);
  if (list.length === 0) return fail("invalid_value", path);
  const out: unknown[] = [];
  for (let i = 0; i < list.length; i++)
    out.push(checkNode(list[i], join(path, i), depth + 1));
  return out;
}

// Structure only (closed key sets, shapes, bounds); the engine validates references later.
// Recursion is bounded: the depth check runs before descending.
function checkNode(raw: unknown, path: string, depth: number): unknown {
  if (depth > MAX_DEPTH) return fail("invalid_value", path);
  if (typeof raw === "string") return str(raw, path);
  const node = object(raw, path);
  const keys = Object.keys(node);
  const kind = keys[0];
  if (kind === undefined || keys.length !== 1) {
    // Several keys: an unknown one is reported as such, otherwise a shape error.
    for (let i = 0; i < keys.length; i++)
      if (!COMBINATORS.has(keys[i] as string)) fail("unknown_key", path);
    return fail("invalid_value", path);
  }
  if (!COMBINATORS.has(kind)) return fail("unknown_key", path);
  const body = own(node, kind);
  const at = join(path, kind);
  if (kind === "not") return { not: checkNode(body, at, depth + 1) };
  if (kind === "all") return { all: checkList(body, at, depth) };
  if (kind === "any") return { any: checkList(body, at, depth) };
  const spec = object(body, at);
  exactKeys(spec, ["n", "of"], at);
  const of = checkList(own(spec, "of"), join(at, "of"), depth);
  const n = num(own(spec, "n"), join(at, "n"));
  if (!Number.isInteger(n) || n < 1 || n > of.length)
    return fail("invalid_value", join(at, "n"));
  return { atLeast: { n, of } };
}

// Format v1 rule: each condition is referenced exactly once in combine. An unused condition
// would show a met input in the trace with no effect; a repeated one makes Kleene logic return
// "unknown" where the value is defined. References to missing ids are the engine's job.
function checkReferences(
  conditions: readonly unknown[],
  combine: unknown,
): void {
  const index = new Map<string, number>();
  conditions.forEach((c, i) => {
    const id = (c as { id: string }).id;
    if (!index.has(id)) index.set(id, i);
  });
  const used = new Set<string>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      if (used.has(node)) fail("invalid_value", path);
      used.add(node);
      return;
    }
    const n = node as Record<string, unknown>;
    if ("not" in n) {
      walk(n.not, join(path, "not"));
      return;
    }
    const kind = "all" in n ? "all" : "any" in n ? "any" : "atLeast";
    const body = n[kind];
    const list = (
      kind === "atLeast" ? (body as { of: unknown[] }).of : body
    ) as unknown[];
    const at =
      kind === "atLeast" ? join(join(path, kind), "of") : join(path, kind);
    for (let i = 0; i < list.length; i++) walk(list[i], join(at, i));
  };
  walk(combine, "combine");
  for (const [id, i] of index)
    if (!used.has(id)) fail("invalid_value", join("conditions", i));
}

// Closed structural check of a parsed rule file. Reads own keys only, rejects every
// unknown key at every level (the engine would silently drop them), and returns fresh
// plain objects that share nothing with the input.
export function checkRuleDoc(doc: unknown): RuleDoc {
  const d = object(doc, "");
  exactKeys(
    d,
    [
      "format_version",
      "id",
      "title",
      "citation",
      "clinical_approval",
      "conditions",
      "combine",
    ],
    "",
    ["enabled", "severity"],
  );

  const version = own(d, "format_version");
  if (typeof version !== "number") fail("invalid_type", "format_version");
  if (version !== 1) fail("invalid_value", "format_version");

  const id = str(own(d, "id"), "id");
  if (!RULE_ID.test(id)) fail("invalid_value", "id");
  const title = str(own(d, "title"), "title");

  let severity: Severity | undefined;
  if (Object.hasOwn(d, "severity")) {
    const s = own(d, "severity");
    if (s !== "critical" && s !== "watch") fail("invalid_value", "severity");
    severity = s as Severity;
  }

  let enabled = true;
  if (Object.hasOwn(d, "enabled")) {
    const e = own(d, "enabled");
    if (typeof e !== "boolean") fail("invalid_type", "enabled");
    enabled = e as boolean;
  }

  const cit = object(own(d, "citation"), "citation");
  exactKeys(cit, ["source", "version", "section"], "citation");
  const citation: Citation = {
    source: str(own(cit, "source"), "citation.source"),
    version: str(own(cit, "version"), "citation.version"),
    section: str(own(cit, "section"), "citation.section"),
  };

  const app = object(own(d, "clinical_approval"), "clinical_approval");
  exactKeys(
    app,
    ["status", "approver", "guideline_version"],
    "clinical_approval",
  );
  const status = str(own(app, "status"), "clinical_approval.status");
  if (status !== "pending" && status !== "approved")
    fail("invalid_value", "clinical_approval.status");
  const person = (key: "approver" | "guideline_version"): string | null => {
    const v = own(app, key);
    const p = `clinical_approval.${key}`;
    if (v === null)
      return status === "approved" ? fail("invalid_value", p) : null;
    return str(v, p);
  };
  const clinical_approval: ClinicalApproval = {
    status: status as "pending" | "approved",
    approver: person("approver"),
    guideline_version: person("guideline_version"),
  };

  const rawConditions = array(own(d, "conditions"), "conditions");
  const conditions: unknown[] = [];
  for (let i = 0; i < rawConditions.length; i++)
    conditions.push(checkCondition(rawConditions[i], join("conditions", i)));

  const combine = checkNode(own(d, "combine"), "combine", 0);
  checkReferences(conditions, combine);

  return {
    format_version: 1,
    id,
    title,
    ...(severity !== undefined && { severity }),
    citation,
    clinical_approval,
    enabled,
    conditions,
    combine,
  };
}
