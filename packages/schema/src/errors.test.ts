import assert from "node:assert/strict";
import { test } from "node:test";
import { validMinimal, validQsofa } from "./fixtures.ts";
import { messageSchema, validateMessage } from "./index.ts";

const CANARY = "CANARY-7f3a";

function fail(input: unknown) {
  const result = validateMessage(input);
  assert.equal(result.ok, false, "expected rejection");
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.errors.length, 1, "exactly one error");
  assert.ok(!JSON.stringify(result).includes(CANARY), "canary leaked");
  return result.errors[0];
}

// biome-ignore lint/suspicious/noExplicitAny: tests mutate fixtures freely
type Any = any;

test("canary never appears in the result", () => {
  const cases: [string, (m: Any) => void, string][] = [
    [
      "unknown key at root",
      (m) => {
        m[CANARY] = 1;
      },
      "unknown_field",
    ],
    [
      "unknown key in instance",
      (m) => {
        m.instances[0][CANARY] = 1;
      },
      "unknown_field",
    ],
    [
      "unknown key in variable",
      (m) => {
        m.instances[0].variables[0][CANARY] = 1;
      },
      "unknown_field",
    ],
    [
      "wrong-typed value",
      (m) => {
        m.instances[0].variables[0].value = CANARY;
      },
      "invalid_type",
    ],
    [
      "enum field (kind)",
      (m) => {
        m.instances[0].kind = CANARY;
      },
      "invalid_value",
    ],
    [
      "source pattern field",
      (m) => {
        m.source = CANARY.toUpperCase();
      },
      "invalid_format",
    ],
    [
      "message_id",
      (m) => {
        m.message_id = CANARY;
      },
      "out_of_range",
    ],
    [
      "unknown variable value",
      (m) => {
        m.instances[0].variables[0].variable = CANARY;
      },
      "invalid_value",
    ],
    [
      "unit const",
      (m) => {
        m.instances[0].variables[0].unit = CANARY;
      },
      "invalid_value",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    const m = validQsofa();
    mutate(m);
    assert.equal(fail(m).code, code, name);
  }
});

test("missing required field names a known path", () => {
  const paths: [string[], string][] = [
    [[], "/schema_version"],
    [[], "/message_id"],
    [[], "/source"],
    [[], "/instances"],
    [["instances", "0"], "/instances/0/instance_id"],
    [["instances", "0"], "/instances/0/kind"],
    [["instances", "0"], "/instances/0/variables"],
    [["instances", "0", "variables", "0"], "/instances/0/variables/0/value"],
    [["instances", "0", "variables", "0"], "/instances/0/variables/0/unit"],
    [
      ["instances", "0", "variables", "0"],
      "/instances/0/variables/0/t_offset_min",
    ],
  ];
  for (const [parent, expected] of paths) {
    const m: Any = validQsofa();
    let node = m;
    for (const k of parent) node = node[k];
    delete node[expected.split("/").pop() as string];
    const err = fail(m);
    assert.deepEqual(err, { path: expected, code: "required" });
  }
});

test("unknown field is reported at its known parent", () => {
  const m: Any = validQsofa();
  m[CANARY] = 1;
  assert.deepEqual(fail(m), { path: "", code: "unknown_field" });
  const i: Any = validQsofa();
  i.instances[0][CANARY] = 1;
  assert.deepEqual(fail(i), { path: "/instances/0", code: "unknown_field" });
  const v: Any = validQsofa();
  v.instances[0].variables[1][CANARY] = 1;
  assert.deepEqual(fail(v), {
    path: "/instances/0/variables/1",
    code: "unknown_field",
  });
});

test("string, boolean, fractional and empty-string numbers are not coerced", () => {
  for (const bad of ["22", true, 22.5, ""]) {
    const m: Any = validQsofa();
    m.instances[0].variables[0].value = bad;
    assert.equal(fail(m).code, "invalid_type", String(bad));
    const o: Any = validQsofa();
    o.instances[0].variables[0].t_offset_min = bad;
    assert.equal(fail(o).code, "invalid_type", `offset ${String(bad)}`);
  }
});

test("1e999 parses to Infinity and is rejected", () => {
  const m: Any = JSON.parse(JSON.stringify(validQsofa()));
  m.instances[0].variables[0].value = JSON.parse("1e999");
  assert.equal(m.instances[0].variables[0].value, Number.POSITIVE_INFINITY);
  assert.ok(["invalid_type", "out_of_range"].includes(fail(m).code));
});

test("-0 and 22.0 are accepted as integers (JSON numbers, same value as 0 and 22)", () => {
  const a: Any = validQsofa();
  a.instances[0].variables[0].t_offset_min = -0;
  assert.equal(validateMessage(a).ok, true);
  const b: Any = validQsofa();
  b.instances[0].variables[0].value = JSON.parse("22.0");
  assert.equal(validateMessage(b).ok, true);
});

test("__proto__ and constructor as keys are rejected, Object.prototype is untouched", () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const base = JSON.stringify(validQsofa());
  for (const key of ["__proto__", "constructor"]) {
    const root = JSON.parse(`${base.slice(0, -1)},"${key}":{"polluted":1}}`);
    assert.ok(Object.hasOwn(root, key), "own key");
    assert.equal(fail(root).code, "unknown_field", key);
    const nested = JSON.parse(base);
    nested.instances[0].variables[0] = JSON.parse(
      `{"variable":"gcs","value":14,"unit":"{score}","t_offset_min":0,"${key}":{"polluted":1}}`,
    );
    assert.equal(fail(nested).code, "unknown_field", `nested ${key}`);
  }
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
  assert.equal(({} as Any).polluted, undefined);
});

test("boundary pairs for every bound", () => {
  const offset = (t: number) => {
    const m: Any = validQsofa();
    m.instances[0].variables[0].t_offset_min = t;
    return validateMessage(m).ok;
  };
  assert.deepEqual([offset(0), offset(1)], [true, false]);
  assert.deepEqual([offset(-10080), offset(-10081)], [true, false]);

  const value = (variable: string, unit: string, v: number) => {
    const m: Any = validMinimal();
    m.instances[0].variables = [{ variable, value: v, unit, t_offset_min: 0 }];
    return validateMessage(m).ok;
  };
  assert.deepEqual(
    [value("gcs", "{score}", 2), value("gcs", "{score}", 3)],
    [false, true],
  );
  assert.deepEqual(
    [value("gcs", "{score}", 15), value("gcs", "{score}", 16)],
    [true, false],
  );
  assert.deepEqual(
    [value("resp_rate", "/min", 0), value("resp_rate", "/min", -1)],
    [true, false],
  );
  assert.deepEqual(
    [value("resp_rate", "/min", 200), value("resp_rate", "/min", 201)],
    [true, false],
  );
  assert.deepEqual(
    [value("sbp", "mm[Hg]", 0), value("sbp", "mm[Hg]", -1)],
    [true, false],
  );
  assert.deepEqual(
    [value("sbp", "mm[Hg]", 400), value("sbp", "mm[Hg]", 401)],
    [true, false],
  );

  const instances = (n: number) => {
    const m: Any = validMinimal();
    m.instances = Array.from({ length: n }, () =>
      structuredClone(m.instances[0]),
    );
    return validateMessage(m).ok;
  };
  assert.deepEqual(
    [instances(20), instances(21), instances(0)],
    [true, false, false],
  );

  const variables = (n: number) => {
    const m: Any = validMinimal();
    m.instances[0].variables = Array.from({ length: n }, (_, i) => ({
      variable: "gcs",
      value: 14,
      unit: "{score}",
      t_offset_min: -i,
    }));
    return validateMessage(m).ok;
  };
  assert.deepEqual([variables(50), variables(51)], [true, false]);

  const source = (s: string) => {
    const m: Any = validMinimal();
    m.source = s;
    return validateMessage(m).ok;
  };
  assert.deepEqual(
    [source("a".repeat(32)), source("a".repeat(33)), source("")],
    [true, false, false],
  );

  const id = (s: string) => {
    const m: Any = validMinimal();
    m.message_id = s;
    return validateMessage(m).ok;
  };
  assert.equal(id("3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863"), true);
  // v7-shaped: version nibble 7
  assert.equal(id("3b1f6c52-8d4e-7a97-b2c1-5e07d9a4f863"), false);
  // v4 with a bad variant nibble
  assert.equal(id("3b1f6c52-8d4e-4a97-c2c1-5e07d9a4f863"), false);
});

test("wrong schema_version has its own code", () => {
  for (const v of ["2.0", "", 1, null, CANARY]) {
    const m: Any = validMinimal();
    m.schema_version = v;
    assert.deepEqual(fail(m), {
      path: "/schema_version",
      code: "unsupported_version",
    });
  }
});

test("non-object inputs are rejected with invalid_type", () => {
  for (const bad of [null, 1, "x", [], undefined]) {
    const r = validateMessage(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.errors, [{ path: "", code: "invalid_type" }]);
  }
});

test("result contains no Ajv internals (error keys are exactly path and code)", () => {
  const mutations: ((m: Any) => void)[] = [
    (m) => delete m.source,
    (m) => {
      m.extra = 1;
    },
    (m) => {
      m.source = 5;
    },
    (m) => {
      m.instances[0].variables[0].value = 999;
    },
    (m) => {
      m.instances[0].variables[0].variable = "zzz";
    },
  ];
  for (const mutate of mutations) {
    const m: Any = validQsofa();
    mutate(m);
    const r = validateMessage(m);
    assert.equal(r.ok, false);
    if (!r.ok)
      for (const e of r.errors)
        assert.deepEqual(Object.keys(e).sort(), ["code", "path"]);
  }
});

test("schema walk: closed objects, no forbidden keywords, bounded strings and numbers", () => {
  const forbidden = [
    "patternProperties",
    "propertyNames",
    "dependentRequired",
    "dependencies",
    "$data",
    "$ref",
    "format",
    "default",
  ];
  const types = (n: Any): string[] =>
    n.type === undefined ? [] : [n.type].flat();
  const walk = (node: Any, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        walk(n, `${at}/${i}`);
      });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const k of forbidden)
      assert.ok(!(k in node), `forbidden keyword ${k} at ${at}`);
    const t = types(node);
    if (t.includes("object")) {
      // A discriminated oneOf wrapper is closed if every branch is closed.
      const closed =
        node.additionalProperties === false ||
        (Array.isArray(node.oneOf) &&
          node.oneOf.every((b: Any) => b.additionalProperties === false));
      assert.ok(closed, `open object at ${at}`);
    } else
      assert.ok(
        typeof node.additionalProperties !== "object",
        `additionalProperties schema at ${at}`,
      );
    if (t.includes("string"))
      assert.ok(
        "enum" in node ||
          "const" in node ||
          ("pattern" in node && "minLength" in node && "maxLength" in node),
        `unbounded string at ${at}`,
      );
    if (t.includes("integer") || t.includes("number"))
      assert.ok(
        "minimum" in node && "maximum" in node,
        `unbounded number at ${at}`,
      );
    for (const [k, v] of Object.entries(node)) walk(v, `${at}/${k}`);
  };
  walk(messageSchema, "#");
});

test("ReDoS guard: a 1 MB string in source is rejected in under 100 ms", () => {
  const m: Any = validMinimal();
  m.source = "a".repeat(1024 * 1024);
  const start = performance.now();
  const err = fail(m);
  assert.ok(performance.now() - start < 100);
  assert.equal(err.code, "out_of_range");
});
