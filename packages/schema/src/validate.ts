import { Ajv, type ErrorObject } from "ajv";
import {
  messageSchema,
  messageSchema11,
  SCHEMA_VERSION,
  SCHEMA_VERSION_11,
} from "./message.schema.ts";
import type { Message, MessageV11, ValidationError } from "./types.ts";

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
const check11 = ajv.compile(messageSchema11);

export function validateMessage(
  input: unknown,
):
  | { ok: true; value: Message | MessageV11 }
  | { ok: false; errors: ValidationError[] } {
  const version =
    typeof input === "object" && input !== null && "schema_version" in input
      ? input.schema_version
      : undefined;
  if (
    version !== undefined &&
    version !== SCHEMA_VERSION &&
    version !== SCHEMA_VERSION_11
  ) {
    return {
      ok: false,
      errors: [{ path: "/schema_version", code: "unsupported_version" }],
    };
  }
  const run = version === SCHEMA_VERSION_11 ? check11 : check;
  if (!run(input)) return { ok: false, errors: [mapError(run.errors?.[0])] };
  const message = input as Message | MessageV11;
  const duplicate = findDuplicate(message);
  if (duplicate) return { ok: false, errors: [duplicate] };
  return { ok: true, value: message };
}

export function currentInstances<M extends Message | MessageV11>(
  message: M,
): M["instances"] {
  return message.instances.filter(
    (instance) => instance.kind === "current",
  ) as M["instances"];
}

// Reports the first later duplicate (same variable or code + offset in one instance).
// Path carries indices only. Read-only over the input.
function findDuplicate(
  message: Message | MessageV11,
): ValidationError | undefined {
  for (const [i, instance] of message.instances.entries()) {
    const seen = new Set<string>();
    for (const [j, v] of (
      instance.variables as (
        | Message["instances"][number]["variables"][number]
        | MessageV11["instances"][number]["variables"][number]
      )[]
    ).entries()) {
      const key = `${"code" in v ? v.code : v.variable}|${v.t_offset_min}`;
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
    case "uniqueItems":
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
