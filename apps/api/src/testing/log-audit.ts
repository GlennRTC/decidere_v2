import { isApprovedMessage } from "../log-messages.ts";

// Test support: checks captured log output against the approved field set (F011).
// The set mirrors AGENTS.md "Logging". Arrays flatten with "[]".
export const ALLOWED_LOG_PATHS: ReadonlySet<string> = new Set([
  "level",
  "time",
  "reqId",
  "request_id",
  "msg",
  "req.method",
  "req.path",
  "res.statusCode",
  "responseTime",
  "message_id",
  "historical_ignored",
  "results[].case_id",
  "results[].class",
  "results[].certainty",
  "results[].rules_fired[]",
  "apiError.code",
  "apiError.status",
  "apiError.count",
  "err.name",
  "err.code",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const int = (v: unknown) => Number.isInteger(v);
// Value rules for approved paths: the field name alone is not a contract.
const VALUE_RULES: Record<string, (v: unknown) => boolean> = {
  level: int,
  time: int,
  responseTime: (v) => typeof v === "number" && Number.isFinite(v),
  message_id: (v) => typeof v === "string" && UUID.test(v),
  request_id: (v) => typeof v === "string" && UUID.test(v),
  "results[].case_id": (v) => typeof v === "string" && UUID.test(v),
  "results[].class": (v) =>
    ["crítico", "vigilancia", "sin alerta", "revisión clínica"].includes(
      v as string,
    ),
  "results[].certainty": (v) => v === null || typeof v === "number",
  "results[].rules_fired[]": (v) =>
    typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v),
  "req.method": (v) => typeof v === "string" && /^[A-Z]{3,7}$/.test(v),
  // Only a registered route or the fixed marker; never client-chosen text.
  "req.path": (v) =>
    ["/v1/messages", "/health", "<unmatched>"].includes(v as string),
  "res.statusCode": int,
  historical_ignored: int,
  "apiError.code": (v) => typeof v === "string" && /^[a-z_]{1,40}$/.test(v),
  "apiError.status": int,
  "apiError.count": int,
  "err.name": (v) =>
    typeof v === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v),
  "err.code": (v) => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v),
};

// Numeric leaves that are legitimately arbitrary numbers.
const NUMERIC_EXEMPT = new Set(["time", "responseTime"]);

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path: string, out: Leaf[]): void {
  if (Array.isArray(value)) {
    for (const item of value) leaves(item, `${path}[]`, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.push({ path: path ? `${path}.${key}` : key, value: undefined });
      leaves(item, path ? `${path}.${key}` : key, out);
    }
  } else {
    out.push({ path, value });
  }
}

export function auditLogLines(
  raw: string,
  forbidden: readonly (string | number)[],
  options: { ruleIds?: ReadonlySet<string> } = {},
): { lines: number; problems: string[] } {
  const problems: string[] = [];
  let lines = 0;
  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    lines++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problems.push("non-JSON line");
      continue;
    }
    const found: Leaf[] = [];
    leaves(parsed, "", found);
    const seen = new Set<string>();
    for (const { path, value } of found) {
      // Object keys are reported once as a container with value undefined.
      if (value === undefined) {
        if (!ALLOWED_LOG_PATHS.has(path) && !isContainer(path)) {
          if (!seen.has(path)) problems.push(`unknown path: ${path}`);
          seen.add(path);
        }
        continue;
      }
      if (!ALLOWED_LOG_PATHS.has(path) && !seen.has(path)) {
        problems.push(`unknown path: ${path}`);
        seen.add(path);
      }
      if (
        path === "results[].rules_fired[]" &&
        options.ruleIds &&
        !options.ruleIds.has(String(value))
      )
        problems.push("rule id is not a loaded rule");
      const rule = VALUE_RULES[path];
      if (rule && !rule(value)) problems.push(`bad value shape in ${path}`);
      if (path === "msg") {
        const msg = String(value);
        if (!isApprovedMessage(msg))
          problems.push(`unknown msg: ${msg.slice(0, 40)}`);
      }
      for (const f of forbidden) {
        if (
          typeof f === "string" &&
          typeof value === "string" &&
          value.includes(f)
        )
          problems.push(`forbidden string in ${path}`);
        if (typeof f === "number" && value === f && !NUMERIC_EXEMPT.has(path))
          problems.push(`forbidden number in ${path}`);
        // A clinical number smuggled as text into an allowed field (exact match only,
        // so random UUID digits cannot trip it).
        if (typeof f === "number" && value === String(f))
          problems.push(`forbidden number as text in ${path}`);
      }
    }
  }
  return { lines, problems };
}

// A container path (req, res, results[], apiError, err) is fine when it has an
// allowed descendant; unknown leaves are caught on their own path.
function isContainer(path: string): boolean {
  const prefix = `${path}.`;
  const prefixArr = `${path}[]`;
  for (const allowed of ALLOWED_LOG_PATHS)
    if (allowed.startsWith(prefix) || allowed.startsWith(prefixArr))
      return true;
  return false;
}
