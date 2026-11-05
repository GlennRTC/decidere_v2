import assert from "node:assert/strict";
import { test } from "node:test";
import { readAllowedSources } from "./config.ts";

test("readAllowedSources defaults to sim-1", () => {
  assert.deepEqual([...readAllowedSources({})], ["sim-1"]);
});

test("readAllowedSources trims and splits entries", () => {
  assert.deepEqual(
    [...readAllowedSources({ ALLOWED_SOURCES: " sim-1 , lab-2 " })],
    ["sim-1", "lab-2"],
  );
});

test("readAllowedSources rejects an invalid entry with a fixed message", () => {
  assert.throws(
    () => readAllowedSources({ ALLOWED_SOURCES: "sim-1,Bad Source!" }),
    (e: Error) =>
      e.message === "ALLOWED_SOURCES entries must match ^[a-z0-9-]{1,32}$" &&
      !e.message.includes("Bad"),
  );
});

test("readAllowedSources rejects an empty list", () => {
  assert.throws(() => readAllowedSources({ ALLOWED_SOURCES: " , " }));
});
