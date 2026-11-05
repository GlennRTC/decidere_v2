export type { CatalogEntry } from "./catalog.ts";
export {
  CANONICAL_VARIABLES,
  CATALOG_VERSION,
  VARIABLE_CATALOG,
} from "./catalog.ts";
export {
  CANONICAL_BOUNDS,
  DELIVERABLE_VARIABLES,
  MESSAGE_VARIABLES,
  messageSchema,
  messageSchema11,
  SCHEMA_VERSION,
  SCHEMA_VERSION_11,
} from "./message.schema.ts";
export type {
  Message,
  MessageV11,
  ValidationCode,
  ValidationError,
} from "./types.ts";
export { currentInstances, validateMessage } from "./validate.ts";
