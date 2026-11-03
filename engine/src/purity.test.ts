import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dir = new URL("./", import.meta.url);
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({
    name: f,
    // Comments are stripped so prose may mention the forbidden words.
    text: readFileSync(new URL(f, dir), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1"),
  }));

const FORBIDDEN: [string, RegExp][] = [
  ["process", /\bprocess\b/],
  ["Date", /\bDate\b/],
  ["Math.random", /\bMath\.random\b/],
  ["fetch", /\bfetch\b/],
  ["eval", /\beval\b/],
  ["Function(", /\bFunction\s*\(/],
  ["new Function", /\bnew\s+Function\b/],
  ["require", /\brequire\b/],
  ["dynamic import", /\bimport\s*\(/],
];

describe("engine purity", () => {
  it("scans at least the known source files", () => {
    for (const f of ["define.ts", "evaluate.ts", "types.ts", "index.ts"])
      assert.ok(
        sources.some((s) => s.name === f),
        f,
      );
  });

  it("imports only relative ./*.ts specifiers", () => {
    for (const { name, text } of sources) {
      const specs = [
        ...text.matchAll(/\bfrom\s*["']([^"']+)["']/g),
        ...text.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ].map((m) => m[1] as string);
      for (const spec of specs)
        assert.match(spec, /^\.\/[\w.-]+\.ts$/, `${name}: ${spec}`);
    }
  });

  for (const [label, re] of FORBIDDEN) {
    it(`uses no ${label}`, () => {
      for (const { name, text } of sources)
        assert.ok(!re.test(text), `${name} uses ${label}`);
    });
  }

  it("package.json declares no dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.ok(!("dependencies" in pkg));
  });
});
