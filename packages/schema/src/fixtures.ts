// Synthetic fixtures only. UUIDs are made up (random-looking v4 strings).
export const MESSAGE_ID = "3b1f6c52-8d4e-4a97-b2c1-5e07d9a4f863";
export const INSTANCE_ID = "9c2e7a14-61bd-4f08-a3d5-0b8e41c97f26";
export const HISTORICAL_ID = "e47d0b93-2a5c-4c61-9f18-d36a85b02e4f";

type Variable = {
  variable: string;
  value: number | null;
  unit: string;
  t_offset_min: number;
};

export function validMinimal() {
  return {
    schema_version: "1.0",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: [] as Variable[],
      },
    ],
  };
}

export function validQsofa() {
  const message = validMinimal();
  message.instances[0].variables = [
    {
      variable: "resp_rate",
      value: 24,
      unit: "/min",
      t_offset_min: 0,
    },
    {
      variable: "sbp",
      value: 95,
      unit: "mm[Hg]",
      t_offset_min: -5,
    },
    {
      variable: "gcs",
      value: 14,
      unit: "{score}",
      t_offset_min: -30,
    },
  ];
  return message;
}

export function withHistorical() {
  const message = validQsofa();
  message.instances.push({
    instance_id: HISTORICAL_ID,
    kind: "historical",
    variables: [
      {
        variable: "resp_rate",
        value: 18,
        unit: "/min",
        t_offset_min: -240,
      },
    ],
  });
  return message;
}

// Contract 1.1: sender-local codes, decimals allowed.
export function validLocal() {
  return {
    schema_version: "1.1",
    message_id: MESSAGE_ID,
    source: "sim-1",
    instances: [
      {
        instance_id: INSTANCE_ID,
        kind: "current",
        variables: [
          { code: "RR", value: 24.5, unit: "/min", t_offset_min: 0 },
          { code: "SBP", value: null, unit: "kPa", t_offset_min: -5 },
        ] as {
          code: string;
          value: number | null;
          unit: string;
          t_offset_min: number;
        }[],
      },
    ],
  };
}

// Contract 1.1 with per-instance context: synthetic orders and ICD-10 codes.
export function validLocalWithContext() {
  const message = validLocal();
  return {
    ...message,
    instances: [
      {
        ...message.instances[0],
        orders: [
          { type: "blood_culture", t_offset_min: -30 },
          { type: "antibiotic", t_offset_min: 0 },
        ] as { type: string; t_offset_min: number }[],
        diagnoses_icd10: ["A41.9", "J18.9"] as string[],
      },
    ],
  };
}
