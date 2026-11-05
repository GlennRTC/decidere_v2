import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { buildApp } from "./app.ts";
import {
  DEFAULT_MAPPINGS_DIR,
  DEFAULT_RULES_DIR,
  loadActiveMappings,
  loadActiveRules,
} from "./rules.ts";

// Hash of the active qSOFA rule set. Update deliberately, and only when a rule
// in knowledge/rules changes; a silent change here means a rule moved.
const QSOFA_RULE_SET_VERSION = "rs-810ea5889733ed08";

const rules = loadActiveRules(DEFAULT_RULES_DIR);
const mappings = loadActiveMappings(DEFAULT_MAPPINGS_DIR);
const JSON_CT = { "content-type": "application/json" };
const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
const ICD_SENTINEL = "Z99.9";

type Item = { code: string; value: number; unit: string };
const QSOFA: Item[] = [
  { code: "RR", value: 24, unit: "/min" },
  { code: "SBP", value: 13.3, unit: "kPa" },
  { code: "GCS", value: 15, unit: "{score}" },
];
const SIRS_EXTRAS: Item[] = [
  { code: "HR", value: 110, unit: "/min" },
  { code: "TEMP", value: 38.6, unit: "Cel" },
  { code: "WBC", value: 13.5, unit: "10*9/L" },
  { code: "PACO2", value: 30, unit: "mm[Hg]" },
  { code: "BANDS", value: 12, unit: "%" },
];
const CONTEXT = {
  orders: [
    { type: "blood_culture", t_offset_min: -30 },
    { type: "antibiotic", t_offset_min: -10 },
  ],
  diagnoses_icd10: [ICD_SENTINEL],
};

const message = (variables: Item[], extra: object = {}, source = "sim-1") => ({
  schema_version: "1.1",
  message_id: MESSAGE_ID,
  source,
  instances: [
    {
      instance_id: INSTANCE_ID,
      kind: "current",
      variables: variables.map((v) => ({ ...v, t_offset_min: 0 })),
      ...extra,
    },
  ],
});

function setup(sources = ["sim-1"]) {
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const app = buildApp({
    logStream,
    rules,
    mappings,
    allowedSources: new Set(sources),
  });
  return { app, logs: () => chunks.join("") };
}
const post = (app: ReturnType<typeof setup>["app"], payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: JSON_CT,
    payload: JSON.stringify(payload),
  });

test("SIRS variables and context do not change the qSOFA result", async () => {
  const { app } = setup();
  const base = await post(app, message(QSOFA));
  const full = await post(app, message([...QSOFA, ...SIRS_EXTRAS], CONTEXT));
  assert.equal(base.statusCode, 200);
  assert.equal(full.statusCode, 200);
  const a = base.json().results[0];
  const b = full.json().results[0];
  assert.equal(b.class, "crítico");
  assert.equal(b.class, a.class);
  assert.deepEqual(b.rules_fired, a.rules_fired);
  assert.match(full.json().mapping_version, /^map-[0-9a-f]{16}$/);
  assert.deepEqual(b.unmapped, []);
});

test("orders and ICD-10 codes are validated but never echoed", async () => {
  const { app, logs } = setup();
  const res = await post(app, message([...QSOFA, ...SIRS_EXTRAS], CONTEXT));
  assert.equal(res.statusCode, 200);
  assert.ok(logs().includes("message interpreted"));
  for (const text of [res.body, logs()]) {
    assert.ok(!text.includes(ICD_SENTINEL));
    assert.ok(!text.includes("blood_culture"));
    assert.ok(!text.includes("antibiotic"));
  }
});

test("the same context in a 1.0 message is 422 unknown_field", async () => {
  const { app } = setup();
  const res = await post(app, {
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: [
          { variable: "resp_rate", value: 24, unit: "/min", t_offset_min: 0 },
        ],
        ...CONTEXT,
      },
    ],
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, "validation_failed");
  assert.ok(
    res
      .json()
      .error.details.some((d: { code: string }) => d.code === "unknown_field"),
  );
  assert.ok(!res.body.includes(ICD_SENTINEL));
});

test("heart_rate as a 1.0 variable is 422 invalid_value", async () => {
  const { app } = setup();
  const res = await post(app, {
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: [
          { variable: "heart_rate", value: 110, unit: "/min", t_offset_min: 0 },
        ],
      },
    ],
  });
  assert.equal(res.statusCode, 422);
  assert.ok(
    res
      .json()
      .error.details.some((d: { code: string }) => d.code === "invalid_value"),
  );
});

test("only the five SIRS codes from a source without a table go to review", async () => {
  const { app } = setup(["sim-1", "no-table"]);
  const res = await post(app, message(SIRS_EXTRAS, {}, "no-table"));
  assert.equal(res.statusCode, 200);
  const r = res.json().results[0];
  assert.deepEqual(r.unmapped, ["HR", "TEMP", "WBC", "PACO2", "BANDS"]);
  assert.equal(r.class, "revisión clínica");
  assert.equal(r.highest_reachable_class, "critical");
});

test("the active rule set version is the recorded qSOFA baseline", () => {
  assert.equal(rules.rule_set_version, QSOFA_RULE_SET_VERSION);
});
