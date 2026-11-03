import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";
import { parseRuleYaml } from "./parse.ts";
import { checkRuleDoc } from "./schema.ts";

type Obj = Record<string, any>;

function validDoc(): Obj {
  return {
    format_version: 1,
    id: "demo.rule.v1",
    title: "Demo rule",
    citation: { source: "Demo source", version: "v1", section: "s1" },
    clinical_approval: {
      status: "approved",
      approver: "Reviewer A",
      guideline_version: "g1",
    },
    conditions: [
      { id: "c1", label: "L1", variable: "v1", op: ">=", value: 7, unit: "u1" },
      { id: "c2", label: "L2", variable: "v2", op: "<", value: 3, unit: "u2" },
      { id: "c3", label: "L3", variable: "v3", op: "==", value: 1, unit: "u3" },
    ],
    combine: { all: ["c1", { any: ["c2", "c3"] }] },
  };
}

function fail(doc: unknown): RuleLoadError {
  try {
    checkRuleDoc(doc);
  } catch (err) {
    assert.ok(
      err instanceof RuleLoadError,
      `expected RuleLoadError, got ${String(err)}`,
    );
    return err;
  }
  assert.fail("expected checkRuleDoc to throw");
}

function expectErr(
  doc: unknown,
  code: RuleLoadErrorCode,
  path: string,
): RuleLoadError {
  const err = fail(doc);
  assert.equal(err.code, code);
  assert.equal(err.path, path);
  return err;
}

// Mutate a fresh valid document.
function mut(fn: (d: Obj) => void): Obj {
  const d = validDoc();
  fn(d);
  return d;
}

test("accepts a valid document and returns a copy; enabled defaults to true", () => {
  const input = validDoc();
  const out = checkRuleDoc(input);
  assert.deepEqual(out, { ...validDoc(), enabled: true });
  input.title = "changed";
  input.citation.source = "changed";
  input.conditions[0].value = 99;
  input.combine.all.push("c2");
  assert.equal(out.title, "Demo rule");
  assert.equal(out.citation.source, "Demo source");
  assert.equal((out.conditions[0] as Obj).value, 7);
  assert.equal((out.combine as Obj).all.length, 2);
  assert.notEqual(out.conditions, input.conditions);
  assert.notEqual(out.conditions[0], input.conditions[0]);
});

test("accepts enabled false and pending approval with nulls or strings", () => {
  assert.equal(
    checkRuleDoc(
      mut((d) => {
        d.enabled = false;
      }),
    ).enabled,
    false,
  );
  const nulls = mut((d) => {
    d.clinical_approval = {
      status: "pending",
      approver: null,
      guideline_version: null,
    };
  });
  assert.equal(checkRuleDoc(nulls).clinical_approval.approver, null);
  const strs = mut((d) => {
    d.clinical_approval = {
      status: "pending",
      approver: "X",
      guideline_version: "g",
    };
  });
  assert.equal(checkRuleDoc(strs).clinical_approval.guideline_version, "g");
});

test("path format: positional dot paths; unknown_key reports the PARENT path", () => {
  // Top level: empty path (the parent is the document).
  expectErr(
    mut((d) => {
      d.severity = "x";
    }),
    "unknown_key",
    "",
  );
  expectErr(
    mut((d) => {
      d.Enabled = true;
    }),
    "unknown_key",
    "",
  );
  expectErr(
    mut((d) => {
      d.citation.extra = 1;
    }),
    "unknown_key",
    "citation",
  );
  expectErr(
    mut((d) => {
      d.clinical_approval.extra = 1;
    }),
    "unknown_key",
    "clinical_approval",
  );
  expectErr(
    mut((d) => {
      d.conditions[1].threshhold = 3;
    }),
    "unknown_key",
    "conditions.1",
  );
  expectErr(
    mut((d) => {
      d.combine = { all: ["c1"], any: ["c2"] };
    }),
    "invalid_value",
    "combine",
  );
  expectErr(
    mut((d) => {
      d.combine = { all: ["c1", { xor: ["c2"] }] };
    }),
    "unknown_key",
    "combine.all.1",
  );
  expectErr(
    mut((d) => {
      d.combine = { atLeast: { n: 1, of: ["c1"], extra: 1 } };
    }),
    "unknown_key",
    "combine.atLeast",
  );
  // Child paths for missing/invalid keys.
  expectErr(
    mut((d) => {
      d.conditions[2].op = 5;
    }),
    "invalid_type",
    "conditions.2.op",
  );
  expectErr(
    mut((d) => {
      d.combine = { atLeast: { n: 1, of: ["c1", 5] } };
    }),
    "invalid_type",
    "combine.atLeast.of.1",
  );
  expectErr(
    mut((d) => {
      d.combine = { not: { not: 5 } };
    }),
    "invalid_type",
    "combine.not.not",
  );
});

test("rejects unknown keys (typos, severity, Enabled) with fixed message", () => {
  for (const key of ["severity", "threshhold", "Enabled", "enabled "]) {
    const err = fail(
      mut((d) => {
        d[key] = 1;
      }),
    );
    assert.equal(err.code, "unknown_key");
    assert.equal(err.message, "rule file has an unknown key");
  }
  // A typo replacing a required key is still reported (unknown first).
  const typo = mut((d) => {
    const c = d.conditions[0];
    c.threshhold = c.value;
    delete c.value;
  });
  expectErr(typo, "unknown_key", "conditions.0");
});

test("rejects missing required keys with the child path", () => {
  for (const key of [
    "format_version",
    "id",
    "title",
    "citation",
    "clinical_approval",
    "conditions",
    "combine",
  ]) {
    expectErr(
      mut((d) => {
        delete d[key];
      }),
      "missing_key",
      key,
    );
  }
  for (const key of ["source", "version", "section"]) {
    expectErr(
      mut((d) => {
        delete d.citation[key];
      }),
      "missing_key",
      `citation.${key}`,
    );
  }
  for (const key of ["status", "approver", "guideline_version"]) {
    expectErr(
      mut((d) => {
        delete d.clinical_approval[key];
      }),
      "missing_key",
      `clinical_approval.${key}`,
    );
  }
  for (const key of ["id", "label", "variable", "op", "value", "unit"]) {
    expectErr(
      mut((d) => {
        delete d.conditions[1][key];
      }),
      "missing_key",
      `conditions.1.${key}`,
    );
  }
  expectErr(
    mut((d) => {
      d.combine = { atLeast: { n: 1 } };
    }),
    "missing_key",
    "combine.atLeast.of",
  );
  expectErr(
    mut((d) => {
      d.combine = { atLeast: { of: ["c1"] } };
    }),
    "missing_key",
    "combine.atLeast.n",
  );
});

test("inherited keys do not count as present (own keys only)", () => {
  const proto = { title: "inherited" };
  const doc = Object.create(proto) as Obj;
  Object.assign(
    doc,
    mut((d) => {
      delete d.title;
    }),
  );
  expectErr(doc, "missing_key", "title");
});

test("rejects wrong types with invalid_type", () => {
  expectErr(
    mut((d) => {
      d.enabled = "false";
    }),
    "invalid_type",
    "enabled",
  );
  expectErr(
    mut((d) => {
      d.conditions[0].value = "22";
    }),
    "invalid_type",
    "conditions.0.value",
  );
  expectErr(
    mut((d) => {
      d.format_version = "1";
    }),
    "invalid_type",
    "format_version",
  );
  expectErr(
    mut((d) => {
      d.conditions = {};
    }),
    "invalid_type",
    "conditions",
  );
  expectErr(
    mut((d) => {
      d.title = 5;
    }),
    "invalid_type",
    "title",
  );
  expectErr(
    mut((d) => {
      d.citation = "x";
    }),
    "invalid_type",
    "citation",
  );
  expectErr(
    mut((d) => {
      d.clinical_approval = null;
    }),
    "invalid_type",
    "clinical_approval",
  );
  expectErr(
    mut((d) => {
      d.conditions[1] = "c";
    }),
    "invalid_type",
    "conditions.1",
  );
  expectErr(
    mut((d) => {
      d.combine = 5;
    }),
    "invalid_type",
    "combine",
  );
  expectErr(
    mut((d) => {
      d.combine = null;
    }),
    "invalid_type",
    "combine",
  );
  expectErr(
    mut((d) => {
      d.combine = [];
    }),
    "invalid_type",
    "combine",
  );
  expectErr(
    mut((d) => {
      d.combine = { all: "c1" };
    }),
    "invalid_type",
    "combine.all",
  );
  expectErr(
    mut((d) => {
      d.combine = { atLeast: { n: 1, of: "c1" } };
    }),
    "invalid_type",
    "combine.atLeast.of",
  );
  expectErr(
    mut((d) => {
      d.combine = { atLeast: "c1" };
    }),
    "invalid_type",
    "combine.atLeast",
  );
  expectErr(
    mut((d) => {
      d.clinical_approval.approver = 5;
    }),
    "invalid_type",
    "clinical_approval.approver",
  );
  expectErr(
    mut((d) => {
      d.clinical_approval.status = 1;
    }),
    "invalid_type",
    "clinical_approval.status",
  );
  expectErr(null, "invalid_type", "");
  expectErr([], "invalid_type", "");
  expectErr("x", "invalid_type", "");
});

test("an own __proto__ key is unknown_key at every level, never a prototype write", () => {
  const withProto = (host: (d: Obj) => Obj): Obj => {
    const d = validDoc();
    Object.defineProperty(host(d), "__proto__", {
      value: { x: 1 },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return d;
  };
  expectErr(
    withProto((d) => d),
    "unknown_key",
    "",
  );
  expectErr(
    withProto((d) => d.citation),
    "unknown_key",
    "citation",
  );
  expectErr(
    withProto((d) => d.clinical_approval),
    "unknown_key",
    "clinical_approval",
  );
  expectErr(
    withProto((d) => d.conditions[0]),
    "unknown_key",
    "conditions.0",
  );
  expectErr(
    mut((d) => {
      d.combine = {};
      Object.defineProperty(d.combine, "__proto__", {
        value: ["c1"],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }),
    "unknown_key",
    "combine",
  );
  // Same through the real parser path.
  const parsed = parseRuleYaml("__proto__: 1\n");
  expectErr(parsed, "unknown_key", "");
  assert.equal(({} as Obj).x, undefined);
});

test("rejects invalid values with invalid_value", () => {
  expectErr(
    mut((d) => {
      d.format_version = 2;
    }),
    "invalid_value",
    "format_version",
  );
  for (const id of [
    "",
    "Upper",
    "-lead",
    "a b",
    "a/b",
    "x".repeat(65),
    ".dot",
  ]) {
    expectErr(
      mut((d) => {
        d.id = id;
      }),
      "invalid_value",
      "id",
    );
  }
  assert.equal(
    checkRuleDoc(
      mut((d) => {
        d.id = "a".repeat(64);
      }),
    ).id.length,
    64,
  );
  assert.equal(
    checkRuleDoc(
      mut((d) => {
        d.id = "0a.b_c-d";
      }),
    ).id,
    "0a.b_c-d",
  );
  expectErr(
    mut((d) => {
      d.title = "";
    }),
    "invalid_value",
    "title",
  );
  expectErr(
    mut((d) => {
      d.title = "x".repeat(201);
    }),
    "invalid_value",
    "title",
  );
  assert.equal(
    checkRuleDoc(
      mut((d) => {
        d.title = "x".repeat(200);
      }),
    ).title.length,
    200,
  );
  expectErr(
    mut((d) => {
      d.citation.version = "";
    }),
    "invalid_value",
    "citation.version",
  );
  expectErr(
    mut((d) => {
      d.conditions[0].unit = "x".repeat(201);
    }),
    "invalid_value",
    "conditions.0.unit",
  );
  expectErr(
    mut((d) => {
      d.conditions[0].id = "";
    }),
    "invalid_value",
    "conditions.0.id",
  );
  expectErr(
    mut((d) => {
      d.clinical_approval.status = "rejected";
    }),
    "invalid_value",
    "clinical_approval.status",
  );
  for (const key of ["approver", "guideline_version"]) {
    for (const bad of [null, ""]) {
      expectErr(
        mut((d) => {
          d.clinical_approval[key] = bad;
        }),
        "invalid_value",
        `clinical_approval.${key}`,
      );
    }
  }
  expectErr(
    mut((d) => {
      d.clinical_approval = {
        status: "pending",
        approver: "",
        guideline_version: null,
      };
    }),
    "invalid_value",
    "clinical_approval.approver",
  );
});

test("condition id is not subject to the rule id regex, only length", () => {
  const out = checkRuleDoc(
    mut((d) => {
      d.conditions[0].id = "Cond One";
      d.combine = { all: ["Cond One", "c2", "c3"] };
    }),
  );
  assert.equal((out.conditions[0] as Obj).id, "Cond One");
});

test("number surprises: nan, inf, 1e400, string, -0, hex", () => {
  const withValue = (v: unknown) =>
    mut((d) => {
      d.conditions[0].value = v;
    });
  for (const v of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    expectErr(withValue(v), "invalid_value", "conditions.0.value");
  }
  // Through the real parser: .nan, .inf, 1e400 are numbers that are not finite.
  for (const lit of [".nan", ".inf", "-.inf", "1e400"]) {
    const doc = parseRuleYaml(
      `format_version: 1\nid: a\ntitle: t\ncitation: {source: s, version: v, section: x}\nclinical_approval: {status: pending, approver: null, guideline_version: null}\nconditions:\n  - {id: c1, label: l, variable: v1, op: ">", value: ${lit}, unit: u}\ncombine: c1\n`,
    );
    expectErr(doc, "invalid_value", "conditions.0.value");
  }
  expectErr(withValue("22"), "invalid_type", "conditions.0.value");
  expectErr(withValue(null), "invalid_type", "conditions.0.value");
  expectErr(withValue(true), "invalid_type", "conditions.0.value");
  const neg = checkRuleDoc(withValue(-0)).conditions[0] as Obj;
  assert.ok(Object.is(neg.value, 0), "-0 is normalized to +0");
  // 0x16 is 22 and 010 is 10 under YAML 1.2 core (documented, accepted).
  const hex = parseRuleYaml(
    "format_version: 1\nid: a\ntitle: t\ncitation: {source: s, version: v, section: x}\nclinical_approval: {status: pending, approver: null, guideline_version: null}\nconditions:\n  - {id: c1, label: l, variable: v1, op: '>', value: 0x16, unit: u}\ncombine: c1\n",
  );
  assert.equal((checkRuleDoc(hex).conditions[0] as Obj).value, 22);
});

test("combine shapes accepted", () => {
  for (const combine of [
    "c1",
    { all: ["c1", "c2"] },
    { any: ["c1"] },
    { not: "c1" },
    { not: { all: ["c1", { not: "c2" }] } },
    { atLeast: { n: 2, of: ["c1", "c2", "c3"] } },
    { atLeast: { n: 1, of: ["c1"] } },
  ]) {
    const out = checkRuleDoc(
      mut((d) => {
        d.combine = combine;
        d.conditions = d.conditions.filter((c: Obj) =>
          JSON.stringify(combine).includes(`"${c.id}"`),
        );
      }),
    );
    assert.deepEqual(out.combine, combine);
    assert.notEqual(out.combine, combine === "c1" ? null : combine);
  }
});

test("combine shapes rejected with closed codes (no TypeError)", () => {
  const cases: [unknown, RuleLoadErrorCode, string][] = [
    [{}, "invalid_value", "combine"],
    [{ all: ["c1"], any: ["c2"] }, "invalid_value", "combine"],
    [{ all: [] }, "invalid_value", "combine.all"],
    [{ any: [] }, "invalid_value", "combine.any"],
    [{ not: "c1", extra: 1 }, "unknown_key", "combine"],
    [{ atLeast: { n: 1, of: [] } }, "invalid_value", "combine.atLeast.of"],
    [{ atLeast: { n: 0, of: ["c1"] } }, "invalid_value", "combine.atLeast.n"],
    [
      { atLeast: { n: 1.5, of: ["c1", "c2"] } },
      "invalid_value",
      "combine.atLeast.n",
    ],
    [
      { atLeast: { n: 3, of: ["c1", "c2"] } },
      "invalid_value",
      "combine.atLeast.n",
    ],
    [
      { atLeast: { n: Number.NaN, of: ["c1"] } },
      "invalid_value",
      "combine.atLeast.n",
    ],
    [{ atLeast: { n: "1", of: ["c1"] } }, "invalid_type", "combine.atLeast.n"],
    [
      { atLeast: { n: 1, of: { 0: "c1" } } },
      "invalid_type",
      "combine.atLeast.of",
    ],
    [
      { atLeast: { n: 1, of: ["c1"], extra: 1 } },
      "unknown_key",
      "combine.atLeast",
    ],
    [{ all: [""] }, "invalid_value", "combine.all.0"],
  ];
  for (const [combine, code, path] of cases) {
    expectErr(
      mut((d) => {
        d.combine = combine;
      }),
      code,
      path,
    );
  }
});

test("combine depth: root is 0, 64 is allowed, 65 is invalid_value", () => {
  const nest = (levels: number): unknown => {
    let node: unknown = "c1";
    for (let i = 0; i < levels; i++) node = { not: node };
    return node;
  };
  assert.doesNotThrow(() =>
    checkRuleDoc(
      mut((d) => {
        d.combine = nest(64);
        d.conditions = d.conditions.slice(0, 1);
      }),
    ),
  );
  expectErr(
    mut((d) => {
      d.combine = nest(65);
      d.conditions = d.conditions.slice(0, 1);
    }),
    "invalid_value",
    `combine${".not".repeat(65)}`,
  );
  // Far beyond the bound: still a closed error, never a stack overflow.
  const err = fail(
    mut((d) => {
      d.combine = nest(20000);
      d.conditions = d.conditions.slice(0, 1);
    }),
  );
  assert.equal(err.code, "invalid_value");
});

test("sparse arrays and own iterators on input arrays do not change validation", () => {
  const sparse = mut((d) => {
    d.conditions = new Array(2);
  });
  expectErr(sparse, "invalid_type", "conditions.0");
  const evil = mut((d) => {
    d.combine = { all: ["c1", "c2"] };
    d.conditions = d.conditions.slice(0, 2);
    Object.defineProperty(d.combine.all, Symbol.iterator, {
      value: function* () {
        yield "zzz";
      },
    });
  });
  assert.deepEqual((checkRuleDoc(evil).combine as Obj).all, ["c1", "c2"]);
});

test("errors never contain the offending value or key name", () => {
  const canary = "CANARY_7f3a";
  const docs: unknown[] = [
    mut((d) => {
      d[canary] = canary;
    }),
    mut((d) => {
      d.citation[canary] = 1;
    }),
    mut((d) => {
      d.conditions[0][canary] = 1;
    }),
    mut((d) => {
      d.combine = { [canary]: ["c1"] };
    }),
    mut((d) => {
      d.combine = { atLeast: { n: 1, of: ["c1"], [canary]: 1 } };
    }),
    mut((d) => {
      d.title = canary.repeat(40);
    }),
    mut((d) => {
      d.id = canary;
    }),
    mut((d) => {
      d.clinical_approval.status = canary;
    }),
    mut((d) => {
      d.conditions[0].value = canary;
    }),
    mut((d) => {
      d.enabled = canary;
    }),
    mut((d) => {
      d.combine = { all: [canary + canary + canary.repeat(20)] };
    }),
  ];
  for (const doc of docs) {
    const err = fail(doc);
    const blob = JSON.stringify({
      message: err.message,
      path: err.path,
      detail: err.detail,
      file: err.file,
      stack: err.stack?.split("\n")[0],
    });
    assert.ok(!blob.includes("CANARY"), blob);
    assert.ok(!blob.includes("zzz"), blob);
  }
});
