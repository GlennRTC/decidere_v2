export const SCHEMA_VERSION = "1.0";
export const SCHEMA_VERSION_11 = "1.1";

// Canonical bounds: the single copy, used by the 1.0 shapes and exported for
// the mapper (applied after unit conversion).
const RESP_RATE = { min: 0, max: 200 } as const; // provisional
const SBP = { min: 0, max: 400 } as const; // provisional
const GCS = { min: 3, max: 15 } as const;
const HEART_RATE = { min: 0, max: 350 } as const; // provisional
const TEMPERATURE = { min: 25, max: 45 } as const; // provisional
const WBC = { min: 0, max: 1000 } as const; // provisional
const PACO2 = { min: 0, max: 300 } as const; // provisional
const BANDS_PCT = { min: 0, max: 100 } as const; // provisional

export const CANONICAL_BOUNDS: ReadonlyMap<
  string,
  { min: number; max: number }
> = new Map<string, { min: number; max: number }>([
  ["resp_rate", RESP_RATE],
  ["sbp", SBP],
  ["gcs", GCS],
  ["heart_rate", HEART_RATE],
  ["temperature", TEMPERATURE],
  ["wbc", WBC],
  ["paco2", PACO2],
  ["bands_pct", BANDS_PCT],
]);

// Variables the mapper may deliver: every one with canonical bounds.
export const DELIVERABLE_VARIABLES: ReadonlySet<string> = new Set(
  CANONICAL_BOUNDS.keys(),
);

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
                variableShape(
                  "resp_rate",
                  "/min",
                  RESP_RATE.min,
                  RESP_RATE.max,
                ),
                variableShape("sbp", "mm[Hg]", SBP.min, SBP.max),
                variableShape("gcs", "{score}", GCS.min, GCS.max),
              ],
            },
          },
        },
      },
    },
  },
} as const;

// Contract 1.1: sender-local codes; the mapper resolves them to canonical
// variables. No free text: code and unit are pattern-bound.
const variableShape11 = {
  type: "object",
  additionalProperties: false,
  required: ["code", "value", "unit", "t_offset_min"],
  properties: {
    code: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: "^[A-Za-z0-9._-]{1,32}$",
    },
    value: { type: ["number", "null"], minimum: -1e6, maximum: 1e6 },
    unit: {
      type: "string",
      minLength: 1,
      maxLength: 16,
      pattern: "^[A-Za-z0-9/%*\\[\\]{}._^-]{1,16}$",
    },
    t_offset_min: offset,
  },
} as const;

export const messageSchema11 = {
  ...messageSchema,
  properties: {
    ...messageSchema.properties,
    schema_version: { const: SCHEMA_VERSION_11 },
    instances: {
      ...messageSchema.properties.instances,
      items: {
        ...messageSchema.properties.instances.items,
        properties: {
          ...messageSchema.properties.instances.items.properties,
          variables: {
            type: "array",
            maxItems: 50,
            items: variableShape11,
          },
          orders: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "t_offset_min"],
              properties: {
                type: { enum: ["blood_culture", "antibiotic"] },
                t_offset_min: offset,
              },
            },
          },
          diagnoses_icd10: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: {
              type: "string",
              // Source: CMS ICD-10-CM Official Guidelines FY2025, Section I.A.2
              // (read 2026-11-05): codes are 3-7 characters, each a letter or
              // digit; with the decimal point at most 8. NOT confirmed by that
              // document: letter first, digit second (kept from WHO ICD-10
              // convention; a stricter-than-source choice, reviewable).
              // No maxLength: Ajv checks it before pattern, so over-long free
              // text would be out_of_range; the pattern already caps it at 8.
              pattern: "^[A-Z][0-9][0-9A-Z](\\.[0-9A-Z]{1,4})?$",
            },
          },
        },
      },
    },
  },
} as const;

// Variables contract 1.0 accepts by name (frozen at qSOFA, ADR-012; catalog-schema.test.ts depends on this set). Rules and mapping tables may reference DELIVERABLE_VARIABLES.
export const MESSAGE_VARIABLES: ReadonlySet<string> = new Set(
  messageSchema.properties.instances.items.properties.variables.items.oneOf.map(
    (shape) => shape.properties.variable.const,
  ),
);
