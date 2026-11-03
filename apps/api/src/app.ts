import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  LogController,
} from "fastify";

export type BuildAppOptions = { log?: boolean; logStream?: Writable };

const MESSAGES = {
  not_found: "Resource not found.",
  bad_request: "The request is invalid.",
  internal_error: "Internal server error.",
} as const;

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

  const errorBody = (code: keyof typeof MESSAGES, requestId: string) => ({
    error: { code, message: MESSAGES[code], request_id: requestId },
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(errorBody("not_found", request.id)),
  );

  app.setErrorHandler((error, request, reply) => {
    const { name, code, statusCode } = error as FastifyError;
    request.log.error({ err: { name, code } }, "request failed");
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(errorBody("bad_request", request.id));
    }
    return reply.code(500).send(errorBody("internal_error", request.id));
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
