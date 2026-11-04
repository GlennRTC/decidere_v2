import type { ValidationError } from "@decidere/schema";
import type { FastifyReply, FastifyRequest } from "fastify";

export type ErrorCode =
  | "not_found"
  | "bad_request"
  | "forbidden"
  | "invalid_json"
  | "payload_too_large"
  | "unsupported_media_type"
  | "validation_failed"
  | "internal_error";

export const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  bad_request: 400,
  forbidden: 403,
  invalid_json: 400,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation_failed: 422,
  internal_error: 500,
};

// Fixed strings only: never Fastify, Ajv or V8 text.
export const MESSAGES: Record<ErrorCode, string> = {
  not_found: "Resource not found.",
  bad_request: "The request is invalid.",
  forbidden: "The source is not allowed.",
  invalid_json: "The request body is not valid JSON.",
  payload_too_large: "The request body is too large.",
  unsupported_media_type: "The content type is not supported.",
  validation_failed: "The message failed validation.",
  internal_error: "Internal server error.",
};

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    details?: ValidationError[];
  };
};

export function errorBody(
  code: ErrorCode,
  requestId: string,
  details?: ValidationError[],
): ErrorBody {
  return {
    error: {
      code,
      message: MESSAGES[code],
      request_id: requestId,
      ...(details ? { details } : {}),
    },
  };
}

const BY_FASTIFY_CODE: Record<string, ErrorCode> = {
  FST_ERR_CTP_INVALID_JSON_BODY: "invalid_json",
  FST_ERR_CTP_EMPTY_JSON_BODY: "invalid_json",
  FST_ERR_CTP_BODY_TOO_LARGE: "payload_too_large",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "unsupported_media_type",
};

// Reads only `statusCode` (number) and `code` (string); never `message`.
// Total: getters or Proxies that throw end in internal_error.
export function codeFor(error: unknown): ErrorCode {
  try {
    if (typeof error !== "object" || error === null) return "internal_error";
    const { statusCode, code } = error as {
      statusCode?: unknown;
      code?: unknown;
    };
    if (typeof code === "string" && Object.hasOwn(BY_FASTIFY_CODE, code)) {
      return BY_FASTIFY_CODE[code] as ErrorCode;
    }
    if (
      typeof statusCode === "number" &&
      Number.isInteger(statusCode) &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return "bad_request";
    }
  } catch {
    // fall through
  }
  return "internal_error";
}

// Details are rebuilt as { path, code } pairs: extra properties never leave.
// Logs only counts, never paths, body or values.
// Always `return replyValidationFailed(...)` from async handlers.
export function replyValidationFailed(
  request: FastifyRequest,
  reply: FastifyReply,
  errors: ValidationError[],
): FastifyReply {
  const details = errors.map(({ path, code }) => ({ path, code }));
  const status = STATUS.validation_failed;
  request.log.warn(
    { apiError: { code: "validation_failed", status, count: details.length } },
    "request failed",
  );
  return reply
    .code(status)
    .send(errorBody("validation_failed", request.id, details));
}
