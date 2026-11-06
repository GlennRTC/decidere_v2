import assert from "node:assert/strict";
import { test } from "node:test";
import { validateMessage } from "@decidere/schema";
import { buildMessage, opaqueId, type SeedCase } from "../seeds/build.ts";

const inline: SeedCase = {
  id: "inline-case-01",
  category: "contradictory",
  expected_class: "critical",
  criterion: "qSOFA >= 2 (Singer 2016, Box 4); inline criterion text",
  note: "inline note text",
  instances: [
    {
      kind: "historical",
      vitals: [{ code: "RR", value: 18, unit: "/min", t_offset_min: -60 }],
    },
    {
      kind: "current",
      vitals: [
        { code: "RR", value: 24, unit: "/min" },
        { code: "SBP", value: null, unit: "mm[Hg]", t_offset_min: -5 },
      ],
    },
  ],
};

test("opaqueId is deterministic, v4-shaped and distinct per input", () => {
  const v4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const base = opaqueId("instance", "c1", 0);
  assert.match(base, v4);
  assert.equal(base, opaqueId("instance", "c1", 0));
  assert.equal(opaqueId("message", "c1"), opaqueId("message", "c1", 0));
  assert.notEqual(base, opaqueId("message", "c1", 0));
  assert.notEqual(base, opaqueId("instance", "c2", 0));
  assert.notEqual(base, opaqueId("instance", "c1", 1));
});

test("buildMessage emits a valid 1.1 message for the sim-1 source", () => {
  const message = buildMessage(inline);
  assert.equal(validateMessage(message).ok, true);
  assert.equal(message.schema_version, "1.1");
  assert.equal(message.source, "sim-1");
});

test("buildMessage keeps null values and defaults t_offset_min to 0", () => {
  const vars = buildMessage(inline).instances[1].variables;
  assert.equal(vars[0].t_offset_min, 0);
  assert.equal(vars[1].value, null);
  assert.equal(vars[1].t_offset_min, -5);
});

test("buildMessage gives each instance its own id and the message its own id", () => {
  const message = buildMessage(inline);
  const ids = [
    message.message_id,
    ...message.instances.map((i) => i.instance_id),
  ];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, [
    opaqueId("message", inline.id),
    opaqueId("instance", inline.id, 0),
    opaqueId("instance", inline.id, 1),
  ]);
});

test("buildMessage contains no text from the case beyond codes, units and numbers", () => {
  const json = JSON.stringify(buildMessage(inline));
  for (const text of [inline.id, inline.criterion, inline.note as string])
    assert.ok(!json.includes(text));
});
