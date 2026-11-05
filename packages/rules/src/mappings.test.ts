import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { loadMappingSet } from "./mappings.ts";

const roots: string[] = [];
function dirWith(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rules-map-"));
  roots.push(d);
  for (const [n, c] of Object.entries(files))
    fs.writeFileSync(path.join(d, n), c);
  return d;
}
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const opts = { variables: new Set(["resp_rate", "sbp", "gcs"]) };
const repoDir = path.resolve(
  import.meta.dirname,
  "../../../knowledge/mappings",
);

function table(
  over: { source?: string; entries?: string; extra?: string } = {},
): string {
  return `format_version: 1
source: ${over.source ?? "lab-a"}
source_note: "note"
${over.extra ?? ""}entries:
${over.entries ?? "  - code: RR\n    variable: resp_rate\n"}`;
}

function fails(dir: string, code: RuleLoadErrorCode, at?: string): void {
  assert.throws(
    () => loadMappingSet(dir, opts),
    (e) =>
      e instanceof RuleLoadError &&
      e.code === code &&
      (at === undefined || e.path === at),
  );
}

test("loads sim-1 from the repo with the verified kPa factor", () => {
  const m = loadMappingSet(repoDir, opts);
  const sbp = m.tables.get("sim-1")?.get("SBP");
  assert.equal(sbp?.variable, "sbp");
  const c = sbp?.conversions.get("kPa");
  assert.ok(c);
  assert.ok(Math.abs(c.factor - 1000 / 133.322) < 1e-4);
  assert.equal(c.offset, 0);
  assert.equal(m.tables.get("sim-1")?.get("RR")?.variable, "resp_rate");
  assert.equal(m.tables.get("sim-1")?.get("GCS")?.conversions.size, 0);
  assert.match(m.version, /^map-[0-9a-f]{16}$/);
});

test("empty directory is valid", () => {
  const m = loadMappingSet(dirWith({}), opts);
  assert.equal(m.tables.size, 0);
  assert.match(m.version, /^map-[0-9a-f]{16}$/);
});

const sbpEntry = (factor: number) =>
  `  - code: SBP\n    variable: sbp\n    units:\n      - unit: kPa\n        factor: ${factor}\n        offset: 0\n`;

test("version is stable, order-free and sensitive to a factor", () => {
  const a = table({ source: "a", entries: sbpEntry(7.5) });
  const b = table({ source: "b" });
  const v1 = loadMappingSet(
    dirWith({ "a.yaml": a, "b.yaml": b }),
    opts,
  ).version;
  const v2 = loadMappingSet(
    dirWith({ "b.yaml": b, "a.yaml": a }),
    opts,
  ).version;
  const v3 = loadMappingSet(
    dirWith({
      "a.yaml": table({ source: "a", entries: sbpEntry(7.6) }),
      "b.yaml": b,
    }),
    opts,
  ).version;
  assert.equal(v1, v2);
  assert.notEqual(v1, v3);
});

test("file name must equal source", () => {
  fails(dirWith({ "x.yaml": table() }), "file_id_mismatch");
});

test("variable outside the catalog", () => {
  fails(
    dirWith({
      "lab-a.yaml": table({ entries: "  - code: RR\n    variable: nope\n" }),
    }),
    "invalid_value",
    "entries.0.variable",
  );
});

test("duplicate code and duplicate unit", () => {
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries:
          "  - code: RR\n    variable: resp_rate\n  - code: RR\n    variable: sbp\n",
      }),
    }),
    "invalid_value",
    "entries.1.code",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries:
          "  - code: SBP\n    variable: sbp\n    units:\n      - {unit: kPa, factor: 7, offset: 0}\n      - {unit: kPa, factor: 8, offset: 0}\n",
      }),
    }),
    "invalid_value",
    "entries.0.units.1.unit",
  );
});

test("zero and non-finite factor", () => {
  fails(
    dirWith({ "lab-a.yaml": table({ entries: sbpEntry(0) }) }),
    "invalid_value",
    "entries.0.units.0.factor",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries: sbpEntry(0).replace("factor: 0", "factor: .inf"),
      }),
    }),
    "invalid_value",
    "entries.0.units.0.factor",
  );
});

test("code, unit and source patterns", () => {
  fails(
    dirWith({
      "lab-a.yaml": table({ entries: "  - code: 'a b'\n    variable: sbp\n" }),
    }),
    "invalid_value",
    "entries.0.code",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries:
          "  - code: SBP\n    variable: sbp\n    units:\n      - {unit: 'k Pa', factor: 7, offset: 0}\n",
      }),
    }),
    "invalid_value",
    "entries.0.units.0.unit",
  );
  fails(
    dirWith({ "Lab.yaml": table({ source: "Lab" }) }),
    "invalid_value",
    "source",
  );
});

test("unknown key at every level, missing key, wrong type", () => {
  fails(
    dirWith({ "lab-a.yaml": table({ extra: "zz: 1\n" }) }),
    "unknown_key",
    "",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries: "  - code: RR\n    variable: resp_rate\n    zz: 1\n",
      }),
    }),
    "unknown_key",
    "entries.0",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({
        entries:
          "  - code: SBP\n    variable: sbp\n    units:\n      - {unit: kPa, factor: 7, offset: 0, zz: 1}\n",
      }),
    }),
    "unknown_key",
    "entries.0.units.0",
  );
  fails(
    dirWith({ "lab-a.yaml": table({ entries: "  - code: RR\n" }) }),
    "missing_key",
    "entries.0.variable",
  );
  fails(
    dirWith({
      "lab-a.yaml": table({ entries: "  []\n" }).replace(
        "entries:\n  []",
        "entries: 1",
      ),
    }),
    "invalid_type",
    "entries",
  );
});

test("a symlinked table is rejected", () => {
  const d = dirWith({ "lab-a.yaml": table() });
  fs.symlinkSync(path.join(d, "lab-a.yaml"), path.join(d, "lab-b.yaml"));
  fails(d, "unsupported_entry");
});
