import assert from "node:assert/strict";
import { test } from "node:test";
import { readTau } from "./config.ts";

const MESSAGE = "CERTAINTY_TAU must be a number greater than 0 and at most 1";

test("unset or empty tau falls back to the provisional default", () => {
  assert.equal(readTau({}), 0.5);
  assert.equal(readTau({ CERTAINTY_TAU: "" }), 0.5);
});

test("valid tau values are parsed", () => {
  for (const [raw, expected] of [
    ["0.5", 0.5],
    ["0.6", 0.6],
    ["1", 1],
    ["0.05", 0.05],
  ] as const) {
    assert.equal(readTau({ CERTAINTY_TAU: raw }), expected);
  }
});

test("invalid tau values throw the fixed message", () => {
  for (const value of [
    "0",
    "-0.1",
    "1.5",
    "abc",
    "0x1",
    "1e-1",
    "NaN",
    "Infinity",
    " 0.5 ",
  ]) {
    assert.throws(
      () => readTau({ CERTAINTY_TAU: value }),
      (e: unknown) =>
        e instanceof Error &&
        e.message === MESSAGE &&
        // "0" is a substring of the fixed message itself; equality above already proves no echo.
        (value === "0" || !e.message.includes(value)),
      value,
    );
  }
});
