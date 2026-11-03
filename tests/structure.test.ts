import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const pkg = () => JSON.parse(read("../package.json"));

test("root declares the agreed workspaces", () => {
  assert.deepEqual(pkg().workspaces, [
    "apps/*",
    "packages/*",
    "engine",
    "tests",
  ]);
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

test("root defines lint", () => {
  assert.equal(pkg().scripts.lint, "biome check .");
});

test("verify chains lint, typecheck, test and build with &&", () => {
  assert.equal(
    pkg().scripts.verify,
    "npm run lint && npm run typecheck && npm test && npm run build",
  );
});

test("test runs through the workspaces", () => {
  assert.ok(pkg().scripts.test.includes("--workspaces"));
});
