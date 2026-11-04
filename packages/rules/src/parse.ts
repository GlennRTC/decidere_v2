import { parseDocument, visit } from "yaml";
import { RuleLoadError, type RuleLoadErrorCode } from "./errors.ts";

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++)
    if (text.charCodeAt(i) === 10) line++;
  return line;
}

// Single document, YAML 1.2 core schema, no aliases, anchors or explicit tags, unique keys.
// Only RuleLoadError escapes; nothing from the YAML is copied into an error.
export function parseRuleYaml(text: string): unknown {
  try {
    const doc = parseDocument(text, {
      version: "1.2",
      schema: "core",
      uniqueKeys: true,
      prettyErrors: false,
    });
    const first = doc.errors[0];
    if (first) {
      const code: RuleLoadErrorCode =
        first.code === "DUPLICATE_KEY"
          ? "yaml_duplicate_key"
          : first.code === "MULTIPLE_DOCS"
            ? "yaml_multiple_documents"
            : "yaml_syntax";
      throw new RuleLoadError({ code, line: lineAt(text, first.pos[0]) });
    }
    // Unknown and standard-looking tags only warn and become strings: reject them.
    if (doc.warnings.length > 0) {
      throw new RuleLoadError({
        code: "yaml_tag",
        line: lineAt(text, doc.warnings[0]?.pos[0] ?? 0),
      });
    }
    // Reject aliases before toJS so nothing is ever expanded (toJS ignores the parse-time maxAliasCount).
    // Anchors and every explicit tag (!!int, !<verbatim>, ...) are rejected too: untagged nodes have tag undefined.
    const rejectNode = (
      _key: unknown,
      node: { tag?: string; anchor?: string },
    ) => {
      if (node.anchor !== undefined)
        throw new RuleLoadError({ code: "yaml_alias" });
      if (node.tag !== undefined) throw new RuleLoadError({ code: "yaml_tag" });
    };
    visit(doc, {
      Alias() {
        throw new RuleLoadError({ code: "yaml_alias" });
      },
      Scalar: rejectNode,
      Map: rejectNode,
      Seq: rejectNode,
    });
    return doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    if (err instanceof RuleLoadError) throw err;
    // Includes RangeError from pathological nesting.
    throw new RuleLoadError({ code: "yaml_syntax" });
  }
}
