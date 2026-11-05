import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const lines = readFileSync(
  fileURLToPath(new URL("../.env.example", import.meta.url)),
  "utf8",
).split("\n");
const assignments = lines.filter((l) => /^[A-Z_]+=/.test(l));

test(".env.example names the variables the API reads, with non-empty safe values", () => {
  const byName = new Map(
    assignments.map((l) => l.split("=") as [string, string]),
  );
  for (const name of ["API_HOST", "ALLOWED_SOURCES", "CERTAINTY_TAU"])
    assert.ok((byName.get(name) ?? "") !== "", `${name} must have a value`);
  assert.equal(byName.get("CERTAINTY_TAU"), "0.5");
});

test(".env.example carries no secret-looking values", () => {
  for (const l of assignments)
    assert.ok(
      !/(KEY|TOKEN|SECRET|PASSWORD)=/i.test(l),
      "no secrets in the template",
    );
});
