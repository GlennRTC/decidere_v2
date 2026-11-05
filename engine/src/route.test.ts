import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeByCertainty } from "./certainty.ts";
import type { ClassId } from "./policy.ts";

const CLASSES: ClassId[] = ["critical", "watch", "no_alert", "review"];

describe("routeByCertainty", () => {
  it("watch and no_alert below tau go to review and report where they came from", () => {
    for (const cls of ["watch", "no_alert"] as const) {
      assert.deepEqual(routeByCertainty(cls, { below_tau: true }), {
        class: "review",
        routed_from: cls,
      });
    }
  });

  it("a critical is never rerouted", () => {
    assert.deepEqual(routeByCertainty("critical", { below_tau: true }), {
      class: "critical",
      routed_from: null,
    });
  });

  it("above tau nothing changes", () => {
    for (const cls of CLASSES) {
      assert.deepEqual(routeByCertainty(cls, { below_tau: false }), {
        class: cls,
        routed_from: null,
      });
    }
  });

  it("review stays review with no routed_from", () => {
    assert.deepEqual(routeByCertainty("review", { below_tau: true }), {
      class: "review",
      routed_from: null,
    });
  });

  it("the function is total over the four classes and both flags", () => {
    for (const cls of CLASSES) {
      for (const below_tau of [true, false]) {
        const out = routeByCertainty(cls, { below_tau });
        assert.ok(CLASSES.includes(out.class));
        assert.equal(out.class === "critical", cls === "critical");
      }
    }
  });
});
