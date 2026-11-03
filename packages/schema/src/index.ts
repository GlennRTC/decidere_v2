export { messageSchema, SCHEMA_VERSION } from "./message.schema.ts";
export type {
  Message,
  ValidationCode,
  ValidationError,
} from "./types.ts";
export { currentInstances, validateMessage } from "./validate.ts";
