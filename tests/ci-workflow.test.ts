import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const workflow = () => read("../.github/workflows/ci.yml");

test("workflow triggers on pull_request and on push to main", () => {
  const text = workflow();
  assert.match(text, /^on:/m);
  assert.match(text, /^\s+pull_request:/m);
  assert.match(text, /^\s+push:\s*\n\s+branches:\s*\[\s*main\s*\]/m);
});

test("workflow token is read-only", () => {
  const text = workflow();
  assert.match(text, /^permissions:\s*\n\s+contents: read$/m);
  assert.doesNotMatch(text, /:\s*write\b/);
});

test("every uses reference is pinned to a 40-hex commit SHA", () => {
  const uses = workflow()
    .split(/\r?\n/)
    .filter((line) => /^\s*-?\s*uses:/.test(line));
  assert.ok(uses.length >= 2);
  for (const line of uses) assert.match(line, /@[0-9a-f]{40}(\s|$)/, line);
});

test("workflow pins the node floor from engines", () => {
  assert.match(workflow(), /node-version: "22\.18"/);
  assert.equal(JSON.parse(read("../package.json")).engines.node, ">=22.18");
});

test("verification step is exactly npm run verify, followed by the PHI scan", () => {
  const lines = workflow()
    .split(/\r?\n/)
    .map((line) => line.trim());
  const verify = lines.indexOf("run: npm run verify");
  const scan = lines.indexOf("run: npm run scan:phi");
  assert.ok(verify >= 0, "missing verify step");
  assert.ok(scan > verify, "scan:phi must come after verify");
});

test("checkout fetches full history for secret scanning", () => {
  assert.match(workflow(), /^\s+fetch-depth: 0$/m);
});

test("gitleaks download is verified by sha256 before it runs", () => {
  const text = workflow();
  const check = text.search(/sha256sum -c/);
  const run = text.search(/gitleaks git\b/);
  assert.match(text, /8\.30\.1/);
  assert.ok(check >= 0, "missing sha256sum -c");
  assert.ok(run > check, "gitleaks must run after checksum verification");
});
