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
        case_id: "c1",
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
        { case_id: "c", class: "vigilancia", certainty, rules_fired: [] },
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
  assert.equal(auditLogLines(raw, ["sentinelq7"]).problems.length, 1);
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
