// Config: PORT (default 3000) and API_HOST (default 127.0.0.1), read from the environment.
import { buildApp } from "./app.ts";
import { readHost, readPort } from "./config.ts";

async function main(): Promise<void> {
  const port = readPort(process.env);
  const host = readHost(process.env);
  const app = buildApp({ log: true });

  const shutdown = (): void => {
    setTimeout(() => process.exit(1), 5000).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("unhandledRejection", (err) => {
    app.log.error({ err }, "unhandled rejection");
    process.exit(1);
  });

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error({ err }, "listen failed");
    process.exit(1);
  }
}

await main();
