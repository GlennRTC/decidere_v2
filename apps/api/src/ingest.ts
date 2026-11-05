import type { LoadedMappings, LoadedRuleSet } from "@decidere/rules";
import { validateMessage } from "@decidere/schema";
import type { FastifyInstance } from "fastify";
import { SOURCE_PATTERN } from "./config.ts";
import { errorBody, replyValidationFailed, STATUS } from "./errors.ts";
import { interpretMessage } from "./interpret.ts";
import { mapMessage } from "./map.ts";
import { strictJsonParse } from "./strict-json.ts";

export type IngestDeps = {
  rules: LoadedRuleSet;
  mappings: LoadedMappings;
  allowedSources: ReadonlySet<string>;
};

// Payload, source, instance_id and clinical values are never logged. message_id is
// logged only on the success branch, after the schema validated its format.
const UTF8 = new Set(["utf-8", "utf8"]);
const BODY_LIMIT = 131072; // 20 instances x 50 variables is about 100 KB

export function registerIngest(app: FastifyInstance, deps: IngestDeps): void {
  // Encapsulated: the parsers below apply to this route only.
  app.register(async (scope) => {
    scope.removeContentTypeParser("text/plain"); // -> 415
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (request, body, done) => {
        const charset = /;\s*charset=([^;]+)/i.exec(
          request.headers["content-type"] ?? "",
        )?.[1];
        if (
          charset &&
          !UTF8.has(charset.trim().replace(/^"|"$/g, "").toLowerCase())
        ) {
          done(
            Object.assign(new Error("Unsupported media type."), {
              code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
              statusCode: 415,
            }),
          );
          return;
        }
        try {
          done(null, strictJsonParse(body as string));
        } catch (err) {
          done(err as Error);
        }
      },
    );
    registerRoute(scope, deps);
  });
}

function registerRoute(app: FastifyInstance, deps: IngestDeps): void {
  app.post(
    "/v1/messages",
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const body = request.body;
      if (body === undefined) {
        // No content-type and no body: same answer as an empty JSON body.
        request.log.warn(
          { apiError: { code: "invalid_json", status: STATUS.invalid_json } },
          "request failed",
        );
        return reply
          .code(STATUS.invalid_json)
          .send(errorBody("invalid_json", request.id));
      }
      const source =
        typeof body === "object" && body !== null
          ? (body as { source?: unknown }).source
          : undefined;
      // A well-formed source outside the allowlist is 403; an absent or malformed
      // one falls through to validation (422). The value is never echoed.
      if (
        typeof source === "string" &&
        SOURCE_PATTERN.test(source) &&
        !deps.allowedSources.has(source)
      ) {
        request.log.warn(
          { apiError: { code: "forbidden", status: STATUS.forbidden } },
          "request failed",
        );
        return reply
          .code(STATUS.forbidden)
          .send(errorBody("forbidden", request.id));
      }
      const checked = validateMessage(body);
      if (!checked.ok)
        return replyValidationFailed(request, reply, checked.errors);
      const mapped = mapMessage(checked.value, deps.mappings);
      if (!mapped.ok)
        return replyValidationFailed(request, reply, mapped.errors);
      // mapped.message may be the caller's object (1.0 passthrough): read-only.
      const out = interpretMessage(
        mapped.value.message,
        deps.rules,
        undefined,
        {
          version: mapped.value.mapping_version,
          unmapped: mapped.value.unmapped,
        },
      );
      if (out.results.length === 0)
        return replyValidationFailed(request, reply, [
          { path: "/instances", code: "invalid_value" },
        ]);
      request.log.info(
        {
          message_id: out.message_id,
          historical_ignored: out.historical_ignored,
          results: out.results.map((r) => ({
            case_id: r.case_id,
            class: r.class,
            certainty: r.certainty,
            rules_fired: r.rules_fired,
          })),
        },
        "message interpreted",
      );
      return reply.code(200).send(out);
    },
  );
}
