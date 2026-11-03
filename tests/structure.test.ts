import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const pkg = () => JSON.parse(read("../package.json"));

test("root declares the agreed workspaces", () => {
  assert.deepEqual(pkg().workspaces, ["apps/*", "packages/*", "engine", "tests"]);
});

test("root is private and pins the node engine", () => {
  assert.equal(pkg().private, true);
  assert.equal(pkg().engines.node, ">=22.18");
});

test("gitignore excludes node_modules, dist and .env", () => {
  const lines = read("../.gitignore").split(/\r?\n/);
  for (const entry of ["node_modules/", "dist/", ".env"]) {
    assert.ok(lines.includes(entry), `missing ${entry}`);
  }
  assert.ok(!lines.includes(".env.example"));
});

test("tests workspace has a test script", () => {
  assert.equal(JSON.parse(read("./package.json")).scripts.test, "node --test");
});

test("root defines typecheck", () => {
  assert.equal(pkg().scripts.typecheck, "tsc -p tsconfig.json --noEmit");
});
