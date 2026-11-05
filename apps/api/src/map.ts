import type { LoadedMappings } from "@decidere/rules";
import {
  CANONICAL_BOUNDS,
  type Message,
  type MessageV11,
  SCHEMA_VERSION,
  VARIABLE_CATALOG,
  type ValidationError,
} from "@decidere/schema";

export type Mapped = {
  message: Message;
  mapping_version: string;
  unmapped: string[][];
};

const CANONICAL_UNIT = new Map(
  VARIABLE_CATALOG.map((e) => [e.variable, e.ucum]),
);

type MappedVariable = {
  variable: string;
  value: number | null;
  unit: string;
  t_offset_min: number;
};

// Translates sender-local codes and units (contract 1.1) to canonical
// variables. Pure: never mutates the input; reports the first error only.
export function mapMessage(
  input: Message | MessageV11,
  mappings: LoadedMappings,
): { ok: true; value: Mapped } | { ok: false; errors: ValidationError[] } {
  if (input.schema_version === SCHEMA_VERSION) {
    return {
      ok: true,
      value: {
        message: input as Message,
        mapping_version: mappings.version,
        unmapped: input.instances.map(() => []),
      },
    };
  }
  const table = mappings.tables.get(input.source);
  const unmapped: string[][] = [];
  const instances = [];
  for (const [i, instance] of input.instances.entries()) {
    const variables: MappedVariable[] = [];
    const seen = new Set<string>();
    const skipped = new Set<string>();
    for (const [j, item] of instance.variables.entries()) {
      const entry = table?.get(item.code);
      if (!entry) {
        skipped.add(item.code);
        continue;
      }
      const path = `/instances/${i}/variables/${j}`;
      const canonical = CANONICAL_UNIT.get(entry.variable);
      let value = item.value;
      if (item.unit !== canonical) {
        const conv = entry.conversions.get(item.unit);
        if (!conv || canonical === undefined) {
          return { ok: false, errors: [{ path, code: "incompatible_unit" }] };
        }
        if (value !== null) value = value * conv.factor + conv.offset;
      }
      const bounds = CANONICAL_BOUNDS.get(entry.variable);
      if (
        value !== null &&
        (!Number.isFinite(value) ||
          (bounds && (value < bounds.min || value > bounds.max)))
      ) {
        return { ok: false, errors: [{ path, code: "out_of_range" }] };
      }
      const key = `${entry.variable}@${item.t_offset_min}`;
      if (seen.has(key)) {
        return { ok: false, errors: [{ path, code: "duplicate_measurement" }] };
      }
      seen.add(key);
      variables.push({
        variable: entry.variable,
        value,
        unit: canonical as string,
        t_offset_min: item.t_offset_min,
      });
    }
    unmapped.push([...skipped]);
    instances.push({
      instance_id: instance.instance_id,
      kind: instance.kind,
      variables,
    });
  }
  // ponytail: canonical values may be decimals; the 1.0 type already allows
  // number, but its variable-name enum is wider than a plain string here.
  const message = {
    schema_version: SCHEMA_VERSION,
    message_id: input.message_id,
    source: input.source,
    instances,
  } as unknown as Message;
  return {
    ok: true,
    value: { message, mapping_version: mappings.version, unmapped },
  };
}
