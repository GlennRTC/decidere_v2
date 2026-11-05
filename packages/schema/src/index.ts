export type { CatalogEntry } from "./catalog.ts";
export {
  CANONICAL_VARIABLES,
  CATALOG_VERSION,
  VARIABLE_CATALOG,
} from "./catalog.ts";
export { messageSchema, SCHEMA_VERSION } from "./message.schema.ts";
export type {
  Message,
  ValidationCode,
  ValidationError,
} from "./types.ts";
export { currentInstances, validateMessage } from "./validate.ts";
