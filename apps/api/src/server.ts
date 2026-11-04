// Config (environment): PORT (default 3000), API_HOST (default 127.0.0.1),
// ALLOWED_SOURCES (comma-separated, default sim-1), RULES_DIR (default knowledge/rules).
import { buildApp } from "./app.ts";
import { readAllowedSources, readHost, readPort } from "./config.ts";
import { DEFAULT_RULES_DIR, loadActiveRules } from "./rules.ts";

// Log only the error's name and code, never its message or stack (same convention as app.ts).
const errInfo = (err: unknown): { name?: string; code?: unknown } => {
  const { name, code } = (err ?? {}) as { name?: string; code?: unknown };
  return { name, code };
};

async function main(): Promise<void> {
  const port = readPort(process.env);
  const host = readHost(process.env);
  const allowedSources = readAllowedSources(process.env);
  // Rules load before listening; a bad rule set aborts startup (name/code only logged).
  let rules: ReturnType<typeof loadActiveRules>;
  try {
    rules = loadActiveRules(process.env.RULES_DIR || DEFAULT_RULES_DIR);
  } catch (err) {
    console.error(
      JSON.stringify({ msg: "rules failed to load", err: errInfo(err) }),
    );
    process.exit(1);
  }
  const app = buildApp({ log: true, rules, allowedSources });

  const shutdown = (): void => {
    setTimeout(() => process.exit(1), 5000).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err: errInfo(err) }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("unhandledRejection", (err) => {
    app.log.error({ err: errInfo(err) }, "unhandled rejection");
    process.exit(1);
  });

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error({ err: errInfo(err) }, "listen failed");
    process.exit(1);
  }
}

await main();
