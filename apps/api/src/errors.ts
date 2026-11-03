import type { ValidationError } from "@decidere/schema";

export type ErrorCode =
  | "not_found"
  | "bad_request"
  | "invalid_json"
  | "payload_too_large"
  | "unsupported_media_type"
  | "validation_failed"
  | "internal_error";

export const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  bad_request: 400,
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
export function codeFor(error: unknown): ErrorCode {
  if (typeof error !== "object" || error === null) return "internal_error";
  const { statusCode, code } = error as {
    statusCode?: unknown;
    code?: unknown;
  };
  if (typeof code === "string" && Object.hasOwn(BY_FASTIFY_CODE, code)) {
    return BY_FASTIFY_CODE[code] as ErrorCode;
  }
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return "bad_request";
  }
  return "internal_error";
}
