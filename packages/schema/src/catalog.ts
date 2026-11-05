export const CATALOG_VERSION = "catalog-1";

export type CatalogEntry = {
  variable: string;
  loinc: string;
  loinc_name: string;
  ucum: string;
  source: string;
  verified_on: string;
};

// LOINC names checked against the NLM Clinical Tables LOINC API; UCUM codes
// checked against the HL7 terminology server (tx.fhir.org, UCUM 2.2). Nothing
// here is written from memory: add `source` and `verified_on` with every row.
const NLM = "NLM Clinical Tables LOINC API; tx.fhir.org (UCUM 2.2)";
const VERIFIED = "2026-11-05";

function entry(
  variable: string,
  loinc: string,
  loinc_name: string,
  ucum: string,
): CatalogEntry {
  return {
    variable,
    loinc,
    loinc_name,
    ucum,
    source: NLM,
    verified_on: VERIFIED,
  };
}

export const VARIABLE_CATALOG: readonly CatalogEntry[] = [
  entry("resp_rate", "9279-1", "Respiratory rate", "/min"),
  entry("sbp", "8480-6", "Systolic blood pressure", "mm[Hg]"),
  entry("gcs", "9269-2", "Glasgow coma score total", "{score}"),
  entry("heart_rate", "8867-4", "Heart rate", "/min"),
  entry("temperature", "8310-5", "Body temperature", "Cel"),
  entry(
    "wbc",
    "6690-2",
    "Leukocytes [#/volume] in Blood by Automated count",
    "10*3/uL",
  ),
  entry(
    "paco2",
    "2019-8",
    "Carbon dioxide [Partial pressure] in Arterial blood",
    "mm[Hg]",
  ),
  entry(
    "bands_pct",
    "764-1",
    "Band form neutrophils/Leukocytes in Blood by Manual count",
    "%",
  ),
];

export const CANONICAL_VARIABLES: ReadonlySet<string> = new Set(
  VARIABLE_CATALOG.map((e) => e.variable),
);
