import assert from "node:assert/strict";
import { test } from "node:test";
import { auditLogLines } from "./log-audit.ts";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const base = {
  level: 30,
  time: 1793845597155,
  reqId: "r1",
  msg: "request completed",
};

test("accepts a success line", () => {
  const raw = line({
    ...base,
    msg: "message interpreted",
    message_id: "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863",
    historical_ignored: 0,
    results: [
      {
        case_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
        class: "crítico",
        certainty: null,
        rules_fired: ["sepsis.qsofa.v1"],
      },
    ],
  });
  assert.deepEqual(auditLogLines(raw, []).problems, []);
});

test("allows certainty null and a number", () => {
  for (const certainty of [null, 0.8]) {
    const raw = line({
      ...base,
      msg: "message interpreted",
      results: [
        {
          case_id: "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26",
          class: "vigilancia",
          certainty,
          rules_fired: [],
        },
      ],
    });
    assert.deepEqual(auditLogLines(raw, []).problems, []);
  }
});

test("rejects an extra field (observed)", () => {
  const raw = line({ ...base, observed: 24 });
  assert.equal(auditLogLines(raw, []).problems.length, 1);
});

test("rejects hostname and pid", () => {
  const raw = line({ ...base, pid: 1, hostname: "h" });
  assert.equal(auditLogLines(raw, []).problems.length, 2);
});

test("rejects a forbidden string inside a value", () => {
  const raw = line({
    ...base,
    req: { method: "POST", path: "/v1/messages/sentinelq7" },
  });
  assert.ok(auditLogLines(raw, ["sentinelq7"]).problems.length >= 1);
});

test("rejects a forbidden number as a value but ignores time and responseTime", () => {
  const ok = line({ ...base, time: 197, responseTime: 197 });
  assert.deepEqual(auditLogLines(ok, [197]).problems, []);
  const bad = line({
    ...base,
    res: { statusCode: 200 },
    historical_ignored: 197,
  });
  assert.equal(auditLogLines(bad, [197]).problems.length, 1);
});

test("rejects an unknown msg", () => {
  const raw = line({ ...base, msg: "payload received" });
  assert.equal(auditLogLines(raw, []).problems.length, 1);
});

test("accepts the listen line", () => {
  const raw = line({
    ...base,
    msg: "Server listening at http://127.0.0.1:41233",
  });
  assert.deepEqual(auditLogLines(raw, []).problems, []);
});

test("rejects a non-JSON line", () => {
  assert.equal(auditLogLines("not json\n", []).problems.length, 1);
});

test("counts lines", () => {
  assert.equal(auditLogLines(line(base) + line(base), []).lines, 2);
});

const ok = {
  level: 30,
  time: 1793845597155,
  reqId: "r1",
  msg: "request completed",
};
const UUID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";

test("rejects a message_id or case_id that is not a UUID", () => {
  const a = line({
    ...ok,
    msg: "message interpreted",
    message_id: "sentinel-src",
  });
  assert.equal(auditLogLines(a, []).problems.length, 1);
  const b = line({
    ...ok,
    msg: "message interpreted",
    results: [
      {
        case_id: "MRN-12345",
        class: "crítico",
        certainty: null,
        rules_fired: [],
      },
    ],
  });
  assert.equal(auditLogLines(b, []).problems.length, 1);
  const good = line({
    ...ok,
    msg: "message interpreted",
    message_id: UUID,
    results: [
      {
        case_id: UUID,
        class: "crítico",
        certainty: null,
        rules_fired: ["sepsis.qsofa.v1"],
      },
    ],
  });
  assert.deepEqual(auditLogLines(good, []).problems, []);
});

test("rejects a rule id with unexpected characters or an unknown class", () => {
  const raw = line({
    ...ok,
    msg: "message interpreted",
    results: [
      {
        case_id: UUID,
        class: "Juan Perez",
        certainty: null,
        rules_fired: ["has space"],
      },
    ],
  });
  assert.equal(auditLogLines(raw, []).problems.length, 2);
});

test("rejects req.path other than a registered route or <unmatched>", () => {
  for (const path of ["/v1/messages", "/health", "<unmatched>"])
    assert.deepEqual(
      auditLogLines(line({ ...ok, req: { method: "POST", path } }), [])
        .problems,
      [],
    );
  assert.equal(
    auditLogLines(
      line({ ...ok, req: { method: "GET", path: "/patients/Juan" } }),
      [],
    ).problems.length,
    1,
  );
});

test("rejects err.code that is not a bounded identifier, and err.name that is not an identifier", () => {
  assert.equal(
    auditLogLines(
      line({ ...ok, err: { name: "Error", code: "patient name here" } }),
      [],
    ).problems.length,
    1,
  );
  assert.equal(
    auditLogLines(line({ ...ok, err: { name: "Juan Perez" } }), []).problems
      .length,
    1,
  );
  assert.deepEqual(
    auditLogLines(
      line({
        ...ok,
        err: { name: "Error", code: "FST_ERR_CTP_INVALID_JSON_BODY" },
      }),
      [],
    ).problems,
    [],
  );
});

test("rejects a non-integer time and a non-numeric responseTime", () => {
  assert.equal(
    auditLogLines(line({ ...ok, time: "24" }), []).problems.length,
    1,
  );
  assert.equal(
    auditLogLines(line({ ...ok, time: 1.5 }), []).problems.length,
    1,
  );
  assert.equal(
    auditLogLines(line({ ...ok, responseTime: "x" }), []).problems.length,
    1,
  );
});

test("accepts the listen line on any interface and the server.ts messages", () => {
  for (const msg of [
    "Server listening at http://0.0.0.0:3000",
    "Server listening at http://127.0.0.1:3000",
    "rules failed to load",
    "invalid configuration",
    "unhandled rejection",
    "uncaught exception",
    "shutdown failed",
    "listen failed",
  ])
    assert.deepEqual(auditLogLines(line({ ...ok, msg }), []).problems, [], msg);
});

test("rejects a clinical number passed as a string in an allowed field", () => {
  const rules = line({
    ...ok,
    msg: "message interpreted",
    results: [
      {
        case_id: UUID,
        class: "crítico",
        certainty: null,
        rules_fired: ["197"],
      },
    ],
  });
  assert.equal(auditLogLines(rules, [197]).problems.length, 1);
  const code = line({ ...ok, err: { name: "Error", code: "197" } });
  assert.equal(auditLogLines(code, [197]).problems.length, 1);
  // Exact equality only: a longer string that merely contains the digits is fine.
  const fine = line({ ...ok, err: { name: "Error", code: "E1970" } });
  assert.deepEqual(auditLogLines(fine, [197]).problems, []);
});

test("rejects a rule id that is not one of the loaded ids when a set is given", () => {
  const raw = line({
    ...ok,
    msg: "message interpreted",
    results: [
      {
        case_id: UUID,
        class: "crítico",
        certainty: null,
        rules_fired: ["sepsis.sirs.v9"],
      },
    ],
  });
  assert.deepEqual(auditLogLines(raw, []).problems, []);
  assert.equal(
    auditLogLines(raw, [], { ruleIds: new Set(["sepsis.qsofa.v1"]) }).problems
      .length,
    1,
  );
});
