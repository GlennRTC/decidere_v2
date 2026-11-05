import { createHash } from "node:crypto";
import type { MessageV11 } from "@decidere/schema";

export type SeedClass = "critical" | "watch" | "no_alert" | "review";
export type SeedCategory =
  | "clear_positive"
  | "clear_negative"
  | "boundary"
  | "missing_data"
  | "contradictory";
export type SeedVital = {
  code: "RR" | "SBP" | "GCS";
  value: number | null;
  unit: string;
  t_offset_min?: number;
};
export type SeedInstance = {
  kind: "current" | "historical";
  vitals: SeedVital[];
};
// expected_class is for the first current instance; one current per case.
export type SeedCase = {
  id: string;
  category: SeedCategory;
  expected_class: SeedClass;
  criterion: string;
  note?: string;
  instances: SeedInstance[];
};
export type SeedFile = {
  labeling: "provisional";
  labelers: { a: string; b: string; adjudicator: string | null };
  clinical_approval: {
    status: "pending" | "approved";
    approver: string | null;
  };
  cases: SeedCase[];
};

// Deterministic UUID v4-shaped id derived from the case id (not random).
export function opaqueId(
  kind: "message" | "instance",
  caseId: string,
  index?: number,
): string {
  const bytes = createHash("sha256")
    .update(`${kind}:${caseId}:${index ?? 0}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildMessage(c: SeedCase): MessageV11 {
  return {
    schema_version: "1.1",
    message_id: opaqueId("message", c.id),
    source: "sim-1",
    instances: c.instances.map((instance, index) => ({
      instance_id: opaqueId("instance", c.id, index),
      kind: instance.kind,
      variables: instance.vitals.map((v) => ({
        code: v.code,
        value: v.value,
        unit: v.unit,
        t_offset_min: v.t_offset_min ?? 0,
      })),
    })),
  };
}
