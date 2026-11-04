type Env = Record<string, string | undefined>;

export function readPort(env: Env): number {
  const raw = env.PORT;
  if (raw === undefined) return 3000;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function readHost(env: Env): string {
  return env.API_HOST || "127.0.0.1";
}

const SOURCE = /^[a-z0-9-]{1,32}$/;

// Provisional global allowlist (F040); per-tenant allowlists arrive with F054.
export function readAllowedSources(env: Env): ReadonlySet<string> {
  const entries = (env.ALLOWED_SOURCES ?? "sim-1")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (entries.length === 0 || !entries.every((s) => SOURCE.test(s))) {
    throw new Error("ALLOWED_SOURCES entries must match ^[a-z0-9-]{1,32}$");
  }
  return new Set(entries);
}
