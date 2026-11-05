export const SCHEMA_VERSION = "1.0";

const uuidV4 = {
  type: "string",
  minLength: 36,
  maxLength: 36,
  pattern:
    "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

// Shared by all three variable shapes. Bounds are provisional (structural, not
// clinical); the clinician must confirm them.
const offset = {
  type: "integer",
  minimum: -10080, // provisional
  maximum: 0,
} as const;

function variableShape<
  const V extends string,
  const U extends string,
  const Min extends number,
  const Max extends number,
>(variable: V, unit: U, min: Min, max: Max) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["variable", "value", "unit", "t_offset_min"],
    properties: {
      variable: { const: variable },
      value: {
        // null = not measured; never 0/-1 as "unknown"
        type: ["integer", "null"],
        minimum: min,
        maximum: max,
      },
      unit: { const: unit },
      t_offset_min: offset,
    },
  } as const;
}

export const messageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "message_id", "source", "instances"],
  properties: {
    schema_version: { const: SCHEMA_VERSION },
    message_id: uuidV4,
    source: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: "^[a-z0-9-]{1,32}$",
    },
    instances: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["instance_id", "kind", "variables"],
        properties: {
          instance_id: uuidV4,
          kind: { enum: ["current", "historical"] },
          variables: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              discriminator: { propertyName: "variable" },
              oneOf: [
                variableShape("resp_rate", "/min", 0, 200), // provisional
                variableShape("sbp", "mm[Hg]", 0, 400), // provisional
                variableShape("gcs", "{score}", 3, 15),
              ],
            },
          },
        },
      },
    },
  },
} as const;
