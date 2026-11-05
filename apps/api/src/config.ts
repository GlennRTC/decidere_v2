import { TAU_PROVISIONAL } from "@decidere/engine";

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

export const SOURCE_PATTERN = /^[a-z0-9-]{1,32}$/;

// Provisional global allowlist (F040); per-tenant allowlists arrive with F054.
export function readAllowedSources(env: Env): ReadonlySet<string> {
  const entries = (env.ALLOWED_SOURCES ?? "sim-1")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (entries.length === 0 || !entries.every((s) => SOURCE_PATTERN.test(s))) {
    throw new Error("ALLOWED_SOURCES entries must match ^[a-z0-9-]{1,32}$");
  }
  return new Set(entries);
}

// Certainty threshold for routing to review (F048). Decimal only: no hex,
// exponent, whitespace, NaN or Infinity; 0 and negatives would disable routing.
export function readTau(env: Env): number {
  const raw = env.CERTAINTY_TAU;
  if (raw === undefined || raw === "") return TAU_PROVISIONAL;
  const tau = /^(0|1)(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(tau > 0 && tau <= 1)) {
    throw new Error(
      "CERTAINTY_TAU must be a number greater than 0 and at most 1",
    );
  }
  return tau;
}
