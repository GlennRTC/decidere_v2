import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { DELIVERABLE_VARIABLES, VARIABLE_CATALOG } from "@decidere/schema";
import { loadRuleSet } from "./load.ts";

const candidateDir = new URL(
  "../../../knowledge/rules-candidate/",
  import.meta.url,
);
const activeDir = new URL("../../../knowledge/rules/", import.meta.url);
const load = () =>
  loadRuleSet(candidateDir.pathname, { variables: DELIVERABLE_VARIABLES });

test("the candidate directory holds exactly the SIRS rule", () => {
  const loaded = load();
  assert.equal(loaded.ruleSet.length, 1);
  assert.equal(loaded.meta[0]?.id, "sepsis.sirs.v1");
});

test("SIRS is a pending watch rule cited to the primary paper", () => {
  const meta = load().meta[0];
  assert.equal(meta?.severity, "watch");
  assert.deepEqual(meta?.clinical_approval, {
    status: "pending",
    approver: null,
    guideline_version: null,
  });
  assert.equal(
    meta?.citation.source,
    "Bone RC, et al. Definitions for sepsis and organ failure (ACCP/SCCM Consensus Conference). Chest. 1992. doi:10.1378/chest.101.6.1644 (PMID 1303622)",
  );
  // Open item for the clinician: the primary criteria table was not read directly.
  assert.equal(
    meta?.citation.version,
    "Chest 1992;101(6):1644-1655; criteria table not read directly",
  );
  assert.equal(
    meta?.citation.section,
    "SIRS criteria; cross-checked against secondary sources only: arXiv 1408.6553 and R package cliot sirs_sepsis_criteria",
  );
});

test("title does not present SIRS as a sepsis diagnosis", () => {
  const title = load().meta[0]?.title ?? "";
  assert.ok(title.length > 0);
  assert.ok(!/sepsis/i.test(title));
});

test("thresholds equal the SIRS criteria", () => {
  // Editing a threshold requires editing this test (clinical review).
  const rule = load().ruleSet[0];
  assert.deepEqual(
    rule?.conditions.map((c) => [c.id, c.variable, c.op, c.value, c.unit]),
    [
      ["temp_alta", "temperature", ">", 38, "Cel"],
      ["temp_baja", "temperature", "<", 36, "Cel"],
      ["fc_alta", "heart_rate", ">", 90, "/min"],
      ["fr_alta", "resp_rate", ">", 20, "/min"],
      ["paco2_baja", "paco2", "<", 32, "mm[Hg]"],
      ["wbc_alto", "wbc", ">", 12, "10*3/uL"],
      ["wbc_bajo", "wbc", "<", 4, "10*3/uL"],
      ["bandas_altas", "bands_pct", ">", 10, "%"],
    ],
  );
  assert.deepEqual(rule?.combine, {
    atLeast: {
      n: 2,
      of: [
        { any: ["temp_alta", "temp_baja"] },
        "fc_alta",
        { any: ["fr_alta", "paco2_baja"] },
        { any: ["wbc_alto", "wbc_bajo", "bandas_altas"] },
      ],
    },
  });
});

test("every condition unit equals the catalog ucum of its variable", () => {
  for (const c of load().ruleSet[0]?.conditions ?? []) {
    const entry = VARIABLE_CATALOG.find((e) => e.variable === c.variable);
    assert.ok(entry, c.variable);
    assert.equal(c.unit, entry.ucum, c.id);
  }
});

test("the active rules directory still holds only qSOFA", () => {
  const loaded = loadRuleSet(activeDir.pathname, {
    variables: new Set(["resp_rate", "sbp", "gcs"]),
  });
  assert.equal(loaded.ruleSet.length, 1);
  assert.equal(loaded.meta[0]?.id, "sepsis.qsofa.v1");
});

test("knowledge/rules lists exactly the qSOFA file", () => {
  assert.deepEqual(readdirSync(activeDir).sort(), ["sepsis.qsofa.v1.yaml"]);
});
