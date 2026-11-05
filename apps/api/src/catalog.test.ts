import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_VARIABLES as FROM_SCHEMA } from "@decidere/schema";
import { CANONICAL_VARIABLES } from "./interpret.ts";

test("the API uses the schema catalog as canonical variables", () => {
  assert.equal(CANONICAL_VARIABLES, FROM_SCHEMA);
});
