export type RuleLoadErrorCode =
  | "file_too_large"
  | "too_many_files"
  | "unsupported_entry"
  | "not_utf8"
  | "file_id_mismatch"
  | "yaml_syntax"
  | "yaml_duplicate_key"
  | "yaml_alias"
  | "yaml_tag"
  | "yaml_multiple_documents"
  | "unknown_key"
  | "missing_key"
  | "invalid_type"
  | "invalid_value"
  | "duplicate_rule_id"
  | "no_active_rules"
  | "invalid_rule"
  | "unreadable_entry"
  | "invalid_options";

// Fixed message per code: never a YAML value, key name or parser message.
export const RULE_LOAD_ERROR_MESSAGES: Readonly<
  Record<RuleLoadErrorCode, string>
> = {
  file_too_large: "rule file exceeds the size limit",
  too_many_files: "rule directory has too many files",
  unsupported_entry: "rule directory contains an unsupported entry",
  not_utf8: "rule file is not valid UTF-8",
  file_id_mismatch: "rule file name does not match its id",
  yaml_syntax: "rule file is not valid YAML",
  yaml_duplicate_key: "rule file has a duplicate key",
  yaml_alias: "rule file uses a YAML alias",
  yaml_tag: "rule file uses a YAML tag",
  yaml_multiple_documents: "rule file has more than one YAML document",
  unknown_key: "rule file has an unknown key",
  missing_key: "rule file is missing a required key",
  invalid_type: "rule file has a value of the wrong type",
  invalid_value: "rule file has an invalid value",
  duplicate_rule_id: "two rule files share the same rule id",
  no_active_rules: "no active rules were found",
  invalid_rule: "rule is rejected by the engine",
  unreadable_entry: "rule directory or file could not be read",
  invalid_options: "invalid loader options",
};

export class RuleLoadError extends Error {
  readonly code: RuleLoadErrorCode;
  readonly file?: string;
  readonly path: string;
  readonly line?: number;
  readonly detail?: string;
  constructor(options: {
    code: RuleLoadErrorCode;
    path?: string;
    line?: number;
    detail?: string;
    file?: string;
  }) {
    super(RULE_LOAD_ERROR_MESSAGES[options.code]);
    this.name = "RuleLoadError";
    this.code = options.code;
    this.path = options.path ?? "";
    if (options.file !== undefined) this.file = options.file;
    if (options.line !== undefined) this.line = options.line;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}
