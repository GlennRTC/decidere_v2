import assert from "node:assert/strict";
import { test } from "node:test";
import { errSerializer } from "./app.ts";

test("errSerializer keeps only bounded string name and code", () => {
  assert.deepEqual(
    errSerializer({
      name: "Error",
      code: "ECONNRESET",
      message: "secret",
      stack: "s",
    }),
    {
      name: "Error",
      code: "ECONNRESET",
    },
  );
  assert.equal(errSerializer({ name: "E", code: 42 }).code, undefined);
  assert.equal(
    errSerializer({ name: "E", code: "x".repeat(200) }).code?.length,
    64,
  );
  assert.deepEqual(errSerializer(null), { name: undefined, code: undefined });
});
