import { createHash } from "node:crypto";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { inFile, readYamlFiles } from "./files.ts";
import { canonicalJson } from "./version.ts";

export type Conversion = { factor: number; offset: number };
export type MappingEntry = {
  variable: string;
  conversions: ReadonlyMap<string, Conversion>;
};
export type LoadedMappings = {
  version: string;
  tables: ReadonlyMap<string, ReadonlyMap<string, MappingEntry>>;
};

// Same patterns as schema contract 1.1.
const CODE = /^[A-Za-z0-9._-]{1,32}$/;
const UNIT = /^[A-Za-z0-9/%*[\]{}._^-]{1,16}$/;
const SOURCE = /^[a-z0-9-]{1,32}$/;
const MAX_NOTE = 500;

const join = (path: string, key: string | number): string =>
  path === "" ? String(key) : `${path}.${key}`;
const fail = (code: RuleLoadErrorCode, path: string): never => {
  throw new RuleLoadError({ code, path });
};
const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(o, key) ? o[key] : undefined;
const object = (x: unknown, path: string): Record<string, unknown> =>
  isObject(x) ? x : fail("invalid_type", path);

function exactKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  for (const k of Object.keys(obj))
    if (!required.includes(k) && !optional.includes(k))
      fail("unknown_key", path);
  for (const k of required)
    if (!Object.hasOwn(obj, k)) fail("missing_key", join(path, k));
}

function pattern(x: unknown, re: RegExp, path: string): string {
  if (typeof x !== "string") return fail("invalid_type", path);
  return re.test(x) ? x : fail("invalid_value", path);
}

function num(x: unknown, path: string): number {
  if (typeof x !== "number") return fail("invalid_type", path);
  if (!Number.isFinite(x)) return fail("invalid_value", path);
  return x === 0 ? 0 : x;
}

type EntryDoc = {
  code: string;
  variable: string;
  units: { unit: string; factor: number; offset: number }[];
};

function checkEntry(
  raw: unknown,
  path: string,
  variables: ReadonlySet<string>,
): EntryDoc {
  const e = object(raw, path);
  exactKeys(e, ["code", "variable"], path, ["units"]);
  const code = pattern(own(e, "code"), CODE, join(path, "code"));
  const variable = pattern(
    own(e, "variable"),
    /^.{1,64}$/,
    join(path, "variable"),
  );
  if (!variables.has(variable)) fail("invalid_value", join(path, "variable"));
  const units: EntryDoc["units"] = [];
  if (Object.hasOwn(e, "units")) {
    const raws = own(e, "units");
    const up = join(path, "units");
    if (!Array.isArray(raws)) fail("invalid_type", up);
    const seen = new Set<string>();
    (raws as unknown[]).forEach((r, i) => {
      const p = join(up, i);
      const u = object(r, p);
      exactKeys(u, ["unit", "factor", "offset"], p);
      const unit = pattern(own(u, "unit"), UNIT, join(p, "unit"));
      if (seen.has(unit)) fail("invalid_value", join(p, "unit"));
      seen.add(unit);
      const factor = num(own(u, "factor"), join(p, "factor"));
      if (factor === 0) fail("invalid_value", join(p, "factor"));
      units.push({
        unit,
        factor,
        offset: num(own(u, "offset"), join(p, "offset")),
      });
    });
  }
  return { code, variable, units };
}

function checkTable(
  doc: unknown,
  variables: ReadonlySet<string>,
): { source: string; entries: EntryDoc[] } {
  const d = object(doc, "");
  exactKeys(d, ["format_version", "source", "source_note", "entries"], "");
  const fv = own(d, "format_version");
  if (typeof fv !== "number") fail("invalid_type", "format_version");
  if (fv !== 1) fail("invalid_value", "format_version");
  const source = pattern(own(d, "source"), SOURCE, "source");
  const note = own(d, "source_note");
  if (typeof note !== "string") fail("invalid_type", "source_note");
  if (note === "" || (note as string).length > MAX_NOTE)
    fail("invalid_value", "source_note");
  const raws = own(d, "entries");
  if (!Array.isArray(raws)) fail("invalid_type", "entries");
  const seen = new Set<string>();
  const entries = (raws as unknown[]).map((r, i) => {
    const e = checkEntry(r, join("entries", i), variables);
    if (seen.has(e.code))
      fail("invalid_value", join(join("entries", i), "code"));
    seen.add(e.code);
    return e;
  });
  return { source, entries };
}

export function loadMappingSet(
  dir: string,
  options: { variables: ReadonlySet<string> },
): LoadedMappings {
  const tables = new Map<string, Map<string, MappingEntry>>();
  const plain: Record<string, EntryDoc[]> = {};
  for (const { file, value } of readYamlFiles(dir)) {
    inFile(file, () => {
      const { source, entries } = checkTable(value, options.variables);
      if (file !== `${source}.yaml`) fail("file_id_mismatch", "source");
      const t = new Map<string, MappingEntry>();
      for (const e of entries)
        t.set(e.code, {
          variable: e.variable,
          conversions: new Map(
            e.units.map((u) => [
              u.unit,
              { factor: u.factor, offset: u.offset },
            ]),
          ),
        });
      tables.set(source, t);
      plain[source] = entries;
    });
  }
  const hash = createHash("sha256")
    .update(canonicalJson({ v: 1, tables: plain }))
    .digest("hex");
  return { version: `map-${hash.slice(0, 16)}`, tables };
}
