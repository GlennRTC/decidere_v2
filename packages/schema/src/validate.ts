import { Ajv, type ErrorObject } from "ajv";
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
  if (!check(input))
    return { ok: false, errors: [mapError(check.errors?.[0])] };
  const message = input as Message;
  const duplicate = findDuplicate(message);
  if (duplicate) return { ok: false, errors: [duplicate] };
  return { ok: true, value: message };
}

export function currentInstances(message: Message): Message["instances"] {
  return message.instances.filter((instance) => instance.kind === "current");
}

// Reports the first later duplicate (same variable + offset in one instance).
// Path carries indices only. Read-only over the input.
function findDuplicate(message: Message): ValidationError | undefined {
  for (const [i, instance] of message.instances.entries()) {
    const seen = new Set<string>();
    for (const [j, v] of instance.variables.entries()) {
      const key = `${v.variable}|${v.t_offset_min}`;
      if (seen.has(key)) {
        return {
          path: `/instances/${i}/variables/${j}`,
          code: "duplicate_measurement",
        };
      }
      seen.add(key);
    }
  }
  return undefined;
}

// Closed mapping table. Output is { path, code } only: never message, params
// (except missingProperty, a schema-defined name), schemaPath or any received
// value or key name. allErrors:false guarantees at most one error.
function mapError(error: ErrorObject | undefined): ValidationError {
  if (!error) return { path: "", code: "invalid" };
  const path = error.instancePath;
  switch (error.keyword) {
    case "required":
      return {
        path: `${path}/${String(error.params.missingProperty)}`,
        code: "required",
      };
    case "additionalProperties":
      // Known parent only; params.additionalProperty is the received key name.
      return { path, code: "unknown_field" };
    case "discriminator": // params carry the received tag: never forwarded
    case "enum":
    case "const":
      return { path, code: "invalid_value" };
    case "type":
      return { path, code: "invalid_type" };
    case "pattern":
      return { path, code: "invalid_format" };
    case "minimum":
    case "maximum":
    case "minItems":
    case "maxItems":
    case "minLength":
    case "maxLength":
      return { path, code: "out_of_range" };
    default:
      return { path, code: "invalid" };
  }
}
