import type { LoadedRuleSet } from "@decidere/rules";
import { validateMessage } from "@decidere/schema";
import type { FastifyInstance } from "fastify";
import { errorBody, replyValidationFailed, STATUS } from "./errors.ts";
import { interpretMessage } from "./interpret.ts";

export type IngestDeps = {
  rules: LoadedRuleSet;
  allowedSources: ReadonlySet<string>;
};

// Payload, source, instance_id and clinical values are never logged. message_id is
// logged only on the success branch, after the schema validated its format.
export function registerIngest(app: FastifyInstance, deps: IngestDeps): void {
  app.post("/v1/messages", async (request, reply) => {
    const body = request.body;
    const source =
      typeof body === "object" && body !== null
        ? (body as { source?: unknown }).source
        : undefined;
    // A well-formed source outside the allowlist is 403; an absent or malformed
    // one falls through to validation (422). The value is never echoed.
    if (
      typeof source === "string" &&
      /^[a-z0-9-]{1,32}$/.test(source) &&
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
    const out = interpretMessage(checked.value, deps.rules);
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
  });
}
