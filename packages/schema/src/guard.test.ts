import assert from "node:assert/strict";
import { test } from "node:test";
import { validQsofa } from "./fixtures.ts";
import { messageSchema } from "./message.schema.ts";
import { validateMessage } from "./validate.ts";

// biome-ignore lint/suspicious/noExplicitAny: schema walker over arbitrary JSON
type Any = any;

const banned = ["not", "anyOf", "allOf", "if", "then", "else"];

// Returns violations (empty = ok). Walks every schema node, not only the
// ones the older walk looked at, so open or unbounded nodes cannot slip in.
function violations(root: Any): string[] {
  const out: string[] = [];
  const node = (n: Any, at: string): void => {
    if (typeof n !== "object" || n === null || Array.isArray(n)) {
      out.push(`non-object (boolean?) schema at ${at}`);
      return;
    }
    if (Object.keys(n).length === 0) out.push(`empty schema at ${at}`);
    for (const k of banned) if (k in n) out.push(`${k} at ${at}`);
    const isVariableUnion =
      n.discriminator?.propertyName === "variable" && Array.isArray(n.oneOf);
    if ("oneOf" in n && !isVariableUnion) out.push(`oneOf at ${at}`);
    const composite = "properties" in n || "items" in n || isVariableUnion;
    if (!composite && !("type" in n || "enum" in n || "const" in n))
      out.push(`untyped leaf at ${at}`);
    const t = n.type === undefined ? [] : [n.type].flat();
    if (t.includes("array") && !("maxItems" in n))
      out.push(`array without maxItems at ${at}`);
    if (t.includes("string") && !("maxLength" in n))
      out.push(`string without maxLength at ${at}`);
    if ("pattern" in n) {
      const p = String(n.pattern);
      if (!p.startsWith("^") || !p.endsWith("$"))
        out.push(`unanchored pattern at ${at}`);
      if (/(^|[^\\])\./.test(p)) out.push(`dot in pattern at ${at}`);
      if (/[*+]|\{\d+,\}/.test(p)) out.push(`unbounded quantifier at ${at}`);
    }
    for (const [k, v] of Object.entries(n.properties ?? {}))
      node(v, `${at}/properties/${k}`);
    if ("items" in n) node(n.items, `${at}/items`);
    if (isVariableUnion)
      n.oneOf.forEach((b: Any, i: number) => {
        node(b, `${at}/oneOf/${i}`);
      });
  };
  node(root, "");
  return out;
}

test("structural guard: messageSchema has no open or unbounded node", () => {
  assert.deepEqual(violations(messageSchema), []);
});

test("structural guard is not vacuous: each mutant is caught", () => {
  const mutate = (f: (s: Any) => void) => {
    const s = structuredClone(messageSchema) as Any;
    f(s);
    return violations(s);
  };
  const mutants: Record<string, (s: Any) => void> = {
    "comment: {}": (s) => {
      s.properties.comment = {};
    },
    "no instances.maxItems": (s) => {
      delete s.properties.instances.maxItems;
    },
    "pattern ^.*$ with maxLength 9999": (s) => {
      s.properties.source = {
        type: "string",
        minLength: 1,
        maxLength: 9999,
        pattern: "^.*$",
      };
    },
    "true as property schema": (s) => {
      s.properties.extra = true;
    },
    anyOf: (s) => {
      s.properties.source.anyOf = [{ type: "string" }];
    },
  };
  for (const [name, f] of Object.entries(mutants))
    assert.notDeepEqual(mutate(f), [], `mutant not caught: ${name}`);
});

test("uppercase UUIDs are rejected (ids are lowercase-only)", () => {
  const m = validQsofa();
  m.message_id = m.message_id.toUpperCase();
  assert.deepEqual(validateMessage(m), {
    ok: false,
    errors: [{ path: "/message_id", code: "invalid_format" }],
  });
  const i = validQsofa();
  i.instances[0].instance_id = i.instances[0].instance_id.toUpperCase();
  assert.deepEqual(validateMessage(i), {
    ok: false,
    errors: [{ path: "/instances/0/instance_id", code: "invalid_format" }],
  });
});

test("a missing variable tag reports invalid_value at the variable", () => {
  const m = validQsofa();
  delete (m.instances[0].variables[0] as Partial<{ variable: string }>)
    .variable;
  assert.deepEqual(validateMessage(m), {
    ok: false,
    errors: [{ path: "/instances/0/variables/0", code: "invalid_value" }],
  });
});
