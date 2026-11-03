import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/scan_phi.py", import.meta.url),
);
// Assembled at runtime so no sensitive-looking literal lives in the repo.
const emailLike = () => ["user", "host.org"].join("@");

const scan = (files: Record<string, string>, args?: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "phi-scan-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return spawnSync("python3", [script, ...(args ?? Object.keys(files))], {
    cwd: dir,
    encoding: "utf8",
  });
};

test("clean file exits 0 and reports one scanned file", () => {
  const r = scan({ "sample.txt": "nothing sensitive here\n" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /scanned 1 files, skipped 0, hits 0/);
});

test("file with an email-like string exits 1, names the file and the pattern, and never prints the value", () => {
  const value = emailLike();
  const r = scan({ "sample.txt": `contact ${value}\n` });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("sample.txt"));
  assert.ok(r.stdout.includes("email_en_texto_plano"));
  assert.ok(!r.stdout.includes(value));
  assert.ok(!r.stderr.includes(value));
});

test("no arguments exits 2", () => {
  const r = scan({}, []);
  assert.equal(r.status, 2);
});

test("allowlisted path is skipped and counted", () => {
  const r = scan({ "readme.md": `contact ${emailLike()}\n` });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped 1/);
});

test("seeds path is scanned", () => {
  const r = scan({ "seeds/case-a.json": `{"x": "${emailLike()}"}\n` });
  assert.equal(r.status, 1);
});

test("package.json defines scan:phi", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    pkg.scripts["scan:phi"],
    "python3 scripts/scan_phi.py $(git ls-files)",
  );
});

for (const name of [
  "seeds/test-case-1.json",
  "seeds/latest.json",
  "knowledge/example-rule.yaml",
]) {
  test(`${name} is always scanned despite allowlist substrings`, () => {
    const r = scan({ [name]: `x ${emailLike()}\n` });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes(name));
    assert.ok(r.stdout.includes("email_en_texto_plano"));
  });
}

test("nonexistent file exits 1 and reports the path and errors 1", () => {
  const r = scan({}, ["missing.txt"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("missing.txt: read error"));
  assert.match(r.stdout, /errors 1/);
  assert.match(r.stdout, /scanned 0 files, skipped 0, hits 0/);
});
