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
