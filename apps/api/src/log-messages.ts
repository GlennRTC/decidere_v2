// The only log messages the API may emit (AGENTS.md "Logging"). Anything else that a
// library tries to log is replaced by "request error" so client text cannot ride in msg.
export const APPROVED_MESSAGES: ReadonlySet<string> = new Set([
  "incoming request",
  "request completed",
  "message interpreted",
  "request failed",
  "request error",
  "rules failed to load",
  "invalid configuration",
  "unhandled rejection",
  "uncaught exception",
  "shutdown failed",
  "listen failed",
]);

// Fastify's own listen line; carries host and port only.
export const LISTEN_LINE = /^Server listening at http:\/\/[0-9a-f.:[\]]+:\d+$/;

export const isApprovedMessage = (msg: unknown): boolean =>
  typeof msg === "string" &&
  (APPROVED_MESSAGES.has(msg) || LISTEN_LINE.test(msg));
