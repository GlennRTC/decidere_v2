import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { evaluateRuleSet, type TraceEntry } from "@decidere/engine";
import { messageSchema } from "@decidere/schema";
import { loadRuleSet } from "./load.ts";

const dir = new URL("../../../knowledge/rules/", import.meta.url);
// Provisional variable catalog; replaced by the real one in F042/F043.
const variables = new Set(["resp_rate", "sbp", "gcs"]);

function evalQsofa(input: Record<string, unknown>) {
  const loaded = loadRuleSet(dir.pathname, { variables });
  return evaluateRuleSet(loaded.ruleSet, input).rules[0];
}
function leaf(trace: TraceEntry[], id: string) {
  const entry = trace.find((e) => e.id === id);
  assert.ok(entry);
  return entry.result;
}

test("loads the real knowledge/rules directory", () => {
  const loaded = loadRuleSet(dir.pathname, { variables });
  assert.equal(loaded.ruleSet.length, 1);
  assert.match(loaded.rule_set_version, /^rs-[0-9a-f]{16}$/);
});

test("qSOFA is pending and cited", () => {
  const loaded = loadRuleSet(dir.pathname, { variables });
  assert.equal(loaded.approval, "pending");
  const meta = loaded.meta[0];
  assert.equal(meta?.id, "sepsis.qsofa.v1");
  assert.deepEqual(meta?.clinical_approval, {
    status: "pending",
    approver: null,
    guideline_version: null,
  });
  assert.ok(meta?.citation.source.includes("Sepsis-3"));
  assert.ok(meta?.citation.source.includes("10.1001/jama.2016.0287"));
  assert.equal(meta?.citation.version, "JAMA 2016;315(8):801-810");
  assert.ok(meta?.citation.section.includes("Box 4"));
});

test("thresholds equal the published qSOFA criteria", () => {
  // Editing a threshold requires editing this test (clinical review).
  const rule = loadRuleSet(dir.pathname, { variables }).ruleSet[0];
  assert.deepEqual(
    rule?.conditions.map((c) => [c.variable, c.op, c.value, c.unit]),
    [
      ["resp_rate", ">=", 22, "/min"],
      ["sbp", "<=", 100, "mm[Hg]"],
      ["gcs", "<", 15, "{score}"],
    ],
  );
  assert.deepEqual(rule?.combine, {
    atLeast: { n: 2, of: ["fr_alta", "ta_baja", "gcs_bajo"] },
  });
});

test("knowledge/rules holds only rule files", () => {
  assert.deepEqual(fs.readdirSync(dir), ["sepsis.qsofa.v1.yaml"]);
});

test("variables and units match the message contract", () => {
  const shapes = messageSchema.properties.instances.items.properties.variables
    .items.oneOf as readonly {
    properties: { variable: { const: string }; unit: { const: string } };
  }[];
  const rule = loadRuleSet(dir.pathname, { variables }).ruleSet[0];
  assert.ok(rule);
  for (const c of rule.conditions) {
    const shape = shapes.find(
      (s) => s.properties.variable.const === c.variable,
    );
    assert.ok(shape, c.variable);
    assert.equal(shape.properties.unit.const, c.unit);
  }
});

test("boundary table", () => {
  const rows: [string, string, number, boolean][] = [
    ["resp_rate", "fr_alta", 21, false],
    ["resp_rate", "fr_alta", 22, true],
    ["sbp", "ta_baja", 101, false],
    ["sbp", "ta_baja", 100, true],
    ["gcs", "gcs_bajo", 15, false],
    ["gcs", "gcs_bajo", 14, true],
    ["gcs", "gcs_bajo", 3, true],
  ];
  for (const [variable, id, value, expected] of rows) {
    const r = evalQsofa({
      resp_rate: 12,
      sbp: 120,
      gcs: 15,
      [variable]: value,
    });
    assert.ok(r);
    assert.equal(leaf(r.trace, id), expected, `${variable}=${value}`);
  }
});

test("truth table of the three criteria", () => {
  const t = { resp_rate: 22, sbp: 100, gcs: 14 };
  const f = { resp_rate: 12, sbp: 120, gcs: 15 };
  for (let mask = 0; mask < 8; mask++) {
    const pick = (bit: number, k: keyof typeof t) =>
      mask & (1 << bit) ? t[k] : f[k];
    const input = {
      resp_rate: pick(0, "resp_rate"),
      sbp: pick(1, "sbp"),
      gcs: pick(2, "gcs"),
    };
    const count = [mask & 1, mask & 2, mask & 4].filter(Boolean).length;
    assert.equal(evalQsofa(input)?.result, count >= 2, `mask=${mask}`);
  }
});

test("one missing criterion", () => {
  assert.equal(evalQsofa({ resp_rate: 22, sbp: 120 })?.result, "unknown");
  assert.equal(evalQsofa({ resp_rate: 22, sbp: 100 })?.result, true);
  assert.equal(evalQsofa({ resp_rate: 12, sbp: 120 })?.result, false);
  assert.equal(
    evalQsofa({ resp_rate: 22, sbp: 120, gcs: null })?.result,
    "unknown",
  );
});

test("all missing", () => {
  assert.equal(evalQsofa({})?.result, "unknown");
});
