import fs from "node:fs";
import path from "node:path";
import { RuleLoadError } from "./errors.ts";
import { parseRuleYaml } from "./parse.ts";

const MAX_FILES = 200;
const MAX_BYTES = 65536;

// Re-throws a stage error with the file name attached (file is readonly).
export function inFile<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof RuleLoadError) || err.file !== undefined) throw err;
    throw new RuleLoadError({
      code: err.code,
      path: err.path,
      ...(err.line !== undefined && { line: err.line }),
      ...(err.detail !== undefined && { detail: err.detail }),
      file,
    });
  }
}

// Any fs failure becomes a closed error: the errno text and the path never leave.
function io<T>(file: string | undefined, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RuleLoadError) throw err;
    throw new RuleLoadError({
      code: "unreadable_entry",
      ...(file !== undefined && { file }),
    });
  }
}

// Bounded read: no symlink following, regular files only, never more than MAX_BYTES + 1 bytes.
// O_NONBLOCK keeps a FIFO swapped in after readdir from blocking open; fstat then rejects it.
function readBounded(dir: string, name: string): Buffer {
  const fd = io(name, () =>
    fs.openSync(
      path.join(dir, name),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    ),
  );
  try {
    if (!io(name, () => fs.fstatSync(fd).isFile()))
      throw new RuleLoadError({ code: "unsupported_entry", file: name });
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    for (;;) {
      const r = io(name, () => fs.readSync(fd, buf, n, buf.length - n, null));
      if (r === 0) break;
      n += r;
      if (n > MAX_BYTES)
        throw new RuleLoadError({ code: "file_too_large", file: name });
    }
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Reads and parses every <name>.yaml in `dir` (non-recursive), sorted by name. Fails closed.
export function readYamlFiles(dir: string): { file: string; value: unknown }[] {
  const entries = io(undefined, () =>
    fs.readdirSync(dir, { withFileTypes: true }),
  );
  if (entries.length > MAX_FILES)
    throw new RuleLoadError({ code: "too_many_files" });
  const names = entries.map((e) => e.name).sort();
  for (const e of entries)
    if (!e.isFile() || !e.name.endsWith(".yaml") || e.name === ".yaml")
      throw new RuleLoadError({ code: "unsupported_entry", file: e.name });
  // All sizes are enforced before any content is read.
  for (const name of names)
    if (io(name, () => fs.lstatSync(path.join(dir, name)).size) > MAX_BYTES)
      throw new RuleLoadError({ code: "file_too_large", file: name });

  const decoder = new TextDecoder("utf-8", { fatal: true });
  return names.map((file) => ({
    file,
    value: inFile(file, () => {
      const bytes = readBounded(dir, file);
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        throw new RuleLoadError({ code: "not_utf8" });
      }
      return parseRuleYaml(text);
    }),
  }));
}
