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

export const ALLOWED_MESSAGES: ReadonlySet<string> = new Set([
  "incoming request",
  "request completed",
  "message interpreted",
  "request failed",
  "request error",
]);
const LISTEN_LINE = /^Server listening at http:\/\/127\.0\.0\.1:\d+$/;

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
      if (path === "msg") {
        const msg = String(value);
        if (!ALLOWED_MESSAGES.has(msg) && !LISTEN_LINE.test(msg))
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
