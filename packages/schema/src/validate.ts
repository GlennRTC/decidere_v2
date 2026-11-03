import { Ajv } from "ajv";
import { messageSchema, SCHEMA_VERSION } from "./message.schema.ts";
import type { Message, ValidationError } from "./types.ts";

// Own instance (never Fastify's): no coercion, no stripping, no defaults.
// Compiled once at module load. Never exported.
const ajv = new Ajv({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  discriminator: true,
});
const check = ajv.compile(messageSchema);

export function validateMessage(
  input: unknown,
): { ok: true; value: Message } | { ok: false; errors: ValidationError[] } {
  if (
    typeof input === "object" &&
    input !== null &&
    "schema_version" in input &&
    input.schema_version !== SCHEMA_VERSION
  ) {
    return {
      ok: false,
      errors: [{ path: "/schema_version", code: "unsupported_version" }],
    };
  }
  if (check(input)) return { ok: true, value: input as Message };
  // Placeholder: safe mapping of Ajv errors lands in the next task.
  return { ok: false, errors: [{ path: "", code: "invalid" }] };
}
