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
import { isApprovedMessage } from "./log-messages.ts";

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

export const errSerializer = (err: unknown) => ({
  name: safeField(() => (err as { name?: unknown }).name),
  code: safeField(() => (err as { code?: unknown }).code),
});

// Registered route pattern, or a marker for 404s (the raw path can hold identifiers).
const routeOf = (req: { routeOptions?: { url?: string } }) =>
  req.routeOptions?.url ?? "<unmatched>";

const pathOf = (url: string | undefined) => (url ?? "").split("?")[0];

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const logging = options.log === true || options.logStream !== undefined;
  const app = Fastify({
    logger: logging
      ? {
          // No pid/hostname: infrastructure identifiers are not in the approved log fields (F011).
          base: null,
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
              // Library lines (drain refusal, "Reply was already sent ... <url>") can
              // carry client text or unlisted wording: keep only approved messages.
              if (typeof first === "string") {
                return method.apply(this, [
                  isApprovedMessage(first) ? first : "request error",
                ] as never);
              }
              if (typeof args[1] === "string" && !isApprovedMessage(args[1])) {
                return method.apply(this, [first, "request error"] as never);
              }
              return method.apply(this, args);
            },
          },
          ...(options.logStream ? { stream: options.logStream } : {}),
          serializers: {
            // Only method and path: no query string, headers or remote address.
            // Typed as a full error by pino; intentionally narrower (no message/stack).
            err: errSerializer as unknown as (err: FastifyError) => never,
            req: (req) => ({
              method: req.method,
              // Never client-chosen text: a registered route or a fixed marker.
              path: routeOf(req),
            }),
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
        // Only HTTP parse errors are rejections. Transport errors (ECONNRESET,
        // EPIPE, ETIMEDOUT, ...) just close the socket: no response, no count.
        const code = safeField(() => (error as { code?: unknown }).code) ?? "";
        if (!code.startsWith("HPE_") && !code.startsWith("ERR_HTTP_")) {
          socket.destroy();
          return;
        }
        const id = randomUUID();
        // Parse errors, header overflow (431) and header timeout (408) are all
        // answered 400 bad_request: the error-code list is closed (ADR-008).
        app.log.warn(
          {
            request_id: id,
            apiError: { code: "bad_request", status: STATUS.bad_request },
          },
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
