// Config (environment): PORT (default 3000), API_HOST (default 127.0.0.1),
// ALLOWED_SOURCES (comma-separated, default sim-1), RULES_DIR (default knowledge/rules),
// MAPPINGS_DIR (default knowledge/mappings).
import { buildApp, errSerializer } from "./app.ts";
import { readAllowedSources, readHost, readPort } from "./config.ts";
import {
  DEFAULT_MAPPINGS_DIR,
  DEFAULT_RULES_DIR,
  loadActiveMappings,
  loadActiveRules,
} from "./rules.ts";

// Same bounded serializer as the request logs: name and code only, strings, 64 chars.
const errInfo = errSerializer;

async function main(): Promise<void> {
  let port: number;
  let host: string;
  let allowedSources: ReturnType<typeof readAllowedSources>;
  try {
    port = readPort(process.env);
    host = readHost(process.env);
    allowedSources = readAllowedSources(process.env);
  } catch {
    // The config messages are fixed strings, but a raw stack would print paths.
    console.error(JSON.stringify({ msg: "invalid configuration" }));
    process.exit(1);
  }
  // Rules load before listening; a bad rule set aborts startup (name/code only logged).
  let rules: ReturnType<typeof loadActiveRules>;
  let mappings: ReturnType<typeof loadActiveMappings>;
  try {
    rules = loadActiveRules(process.env.RULES_DIR || DEFAULT_RULES_DIR);
    // Same fixed message: the log-message list is closed.
    mappings = loadActiveMappings(
      process.env.MAPPINGS_DIR || DEFAULT_MAPPINGS_DIR,
    );
  } catch (err) {
    console.error(
      JSON.stringify({ msg: "rules failed to load", err: errInfo(err) }),
    );
    process.exit(1);
  }
  const app = buildApp({ log: true, rules, mappings, allowedSources });

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
  process.on("uncaughtException", (err) => {
    app.log.error({ err: errInfo(err) }, "uncaught exception");
    process.exit(1);
  });
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
