import assert from "node:assert/strict";
import { test } from "node:test";
import { readHost, readPort } from "./config.ts";

test("readPort defaults to 3000", () => {
  assert.equal(readPort({}), 3000);
});

test("readPort accepts a valid port", () => {
  assert.equal(readPort({ PORT: "8080" }), 8080);
});

for (const bad of [
  "abc",
  "0",
  "70000",
  "",
  "80.5",
  "0x50",
  "1e3",
  " 80",
  "-1",
  "+80",
]) {
  test(`readPort rejects ${JSON.stringify(bad)} without echoing it`, () => {
    assert.throws(
      () => readPort({ PORT: bad }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("PORT"));
        if (bad !== "") assert.ok(!err.message.includes(bad));
        return true;
      },
    );
  });
}

test("readHost defaults to 127.0.0.1", () => {
  assert.equal(readHost({}), "127.0.0.1");
  assert.equal(readHost({ API_HOST: "" }), "127.0.0.1");
});

test("readHost returns the configured value", () => {
  assert.equal(readHost({ API_HOST: "0.0.0.0" }), "0.0.0.0");
});
