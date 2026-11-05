import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  LogController,
} from "fastify";
import { codeFor, errorBody, STATUS } from "./errors.ts";
import { type IngestDeps, registerIngest } from "./ingest.ts";

export type BuildAppOptions = {
  log?: boolean;
  logStream?: Writable;
  bodyLimit?: number;
  rules?: IngestDeps["rules"];
  allowedSources?: IngestDeps["allowedSources"];
};

const DEFAULT_BODY_LIMIT = 262144;

// Only name and code, strings only, bounded; never message or stack.
const safeField = (read: () => unknown) => {
  try {
    const v = read();
    return typeof v === "string" ? v.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
};

const errSerializer = (err: unknown) => ({
  name: safeField(() => (err as { name?: unknown }).name),
  code: safeField(() => (err as { code?: unknown }).code),
});

const pathOf = (url: string | undefined) => (url ?? "").split("?")[0];

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const logging = options.log === true || options.logStream !== undefined;
  const app = Fastify({
    logger: logging
      ? {
          hooks: {
            // pino fills msg from err.message when no message is given; Fastify does
            // that (e.g. "Reply was already sent ... in <raw url>"). Use a fixed one.
            logMethod(args, method) {
              const first = args[0];
              if (
                first instanceof Error ||
                (typeof first === "object" &&
                  first !== null &&
                  "err" in first &&
                  typeof args[1] !== "string")
              ) {
                const obj = first instanceof Error ? { err: first } : first;
                return method.apply(this, [obj, "request error"] as never);
              }
              return method.apply(this, args);
            },
          },
          ...(options.logStream ? { stream: options.logStream } : {}),
          serializers: {
            // Only method and path: no query string, headers or remote address.
            // Typed as a full error by pino; intentionally narrower (no message/stack).
            err: errSerializer as unknown as (err: FastifyError) => never,
            req: (req) => ({ method: req.method, path: pathOf(req.url) }),
          },
        }
      : false,
    bodyLimit: options.bodyLimit ?? DEFAULT_BODY_LIMIT,
    // Framework errors (e.g. bad URL) would echo the path in Fastify's default body.
    frameworkErrors: (error, request, rawReply) => {
      const reply = rawReply as FastifyReply;
      const code = codeFor(error);
      const status = STATUS[code];
      request.log.error({ apiError: { code, status } }, "request failed");
      // onSend hooks may not run for framework errors: set headers here.
      return reply
        .code(status)
        .header("cache-control", "no-store")
        .header("x-request-id", request.id)
        .send(errorBody(code, request.id));
    },
    // Socket-level rejections (malformed request line, oversized headers) never reach
    // a route handler: answer with the same structured body and count them in the log.
    clientErrorHandler: (error, socket) => {
      try {
        if (
          safeField(() => (error as { code?: unknown }).code) === "ECONNRESET"
        ) {
          socket.destroy();
          return;
        }
        const id = randomUUID();
        app.log.error(
          { apiError: { code: "bad_request", status: STATUS.bad_request } },
          "request failed",
        );
        if (socket.writable && !socket.destroyed) {
          const body = JSON.stringify(errorBody("bad_request", id));
          socket.end(
            `HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\ncache-control: no-store\r\nx-request-id: ${id}\r\nconnection: close\r\n\r\n${body}`,
          );
        } else {
          socket.destroy();
        }
      } catch {
        socket.destroy();
      }
    },
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
    try {
      const code = codeFor(error);
      const status = STATUS[code];
      request.log.error(
        { err: error, apiError: { code, status } },
        "request failed",
      );
      return reply.code(status).send(errorBody(code, request.id));
    } catch {
      // Last resort: the handler must never throw.
      request.log.error(
        { apiError: { code: "internal_error", status: 500 } },
        "request failed",
      );
      return reply.code(500).send(errorBody("internal_error", request.id));
    }
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

  if (options.rules) {
    registerIngest(app, {
      rules: options.rules,
      allowedSources: options.allowedSources ?? new Set(),
    });
  }

  return app;
}
