import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { codeFor, errorBody, STATUS } from "./errors.ts";

export type BuildAppOptions = {
  log?: boolean;
  logStream?: Writable;
  bodyLimit?: number;
};

const DEFAULT_BODY_LIMIT = 262144;

const pathOf = (url: string | undefined) => (url ?? "").split("?")[0];

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const logging = options.log === true || options.logStream !== undefined;
  const app = Fastify({
    logger: logging
      ? {
          ...(options.logStream ? { stream: options.logStream } : {}),
          serializers: {
            // Only method and path: no query string, headers or remote address.
            req: (req) => ({ method: req.method, path: pathOf(req.url) }),
          },
        }
      : false,
    bodyLimit: options.bodyLimit ?? DEFAULT_BODY_LIMIT,
    // Never trust an inbound request id; always generate one.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    // Liveness probes are not logged.
    logController: new LogController({
      disableRequestLogging: (req) => pathOf(req.url) === "/health",
    }),
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(errorBody("not_found", request.id)),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    const code = codeFor(error);
    const status = STATUS[code];
    // The thrown value may be any type: read name/code defensively.
    const e = (typeof error === "object" && error !== null ? error : {}) as {
      name?: unknown;
      code?: unknown;
    };
    request.log.error(
      {
        err: {
          name: typeof e.name === "string" ? e.name : undefined,
          code: typeof e.code === "string" ? e.code : undefined,
        },
        apiError: { code, status },
      },
      "request failed",
    );
    return reply.code(status).send(errorBody(code, request.id));
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: { type: "object", properties: { status: { const: "ok" } } },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  return app;
}
