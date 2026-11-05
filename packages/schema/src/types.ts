import type { FromSchema } from "json-schema-to-ts";
import type { messageSchema, messageSchema11 } from "./message.schema.ts";

export type Message = FromSchema<typeof messageSchema>;

export type MessageV11 = FromSchema<typeof messageSchema11>;

export type ValidationCode =
  | "unsupported_version"
  | "required"
  | "unknown_field"
  | "invalid_type"
  | "invalid_value"
  | "invalid_format"
  | "out_of_range"
  | "duplicate_measurement"
  | "incompatible_unit"
  | "invalid";

export type ValidationError = { path: string; code: ValidationCode };
