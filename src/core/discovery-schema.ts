import { z } from "zod";
import { assertionSchema, locatorSchema } from "./schema.js";

const rationale = z.string().min(1);
export const discoveryDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url(), rationale }).strict(),
  z.object({ kind: z.literal("click"), target: locatorSchema, rationale }).strict(),
  z.object({ kind: z.literal("fill"), target: locatorSchema, inputKey: z.string(), rationale }).strict(),
  z.object({ kind: z.literal("extract"), target: locatorSchema, outputKey: z.string(), rationale }).strict(),
  z.object({ kind: z.literal("wait"), durationMs: z.number().int().min(50).max(2000), rationale }).strict(),
  z.object({ kind: z.literal("complete"), checkpoint: assertionSchema, businessOutcomes: z.array(z.object({ code: z.string(), message: z.string(), assertion: assertionSchema }).strict()).default([]), rationale }).strict(),
  z.object({ kind: z.literal("business_outcome"), code: z.string(), message: z.string(), assertion: assertionSchema, rationale }).strict(),
  z.object({ kind: z.literal("request_human"), reason: z.string(), rationale }).strict()
]);

export type DiscoveryDecision = z.infer<typeof discoveryDecisionSchema>;

const modelDecisionEnvelopeSchema = z.object({ decision: discoveryDecisionSchema }).strict();

type ModelDecisionEnvelope = z.infer<typeof modelDecisionEnvelopeSchema>;

export function parseModelDecision(raw: unknown): DiscoveryDecision {
  return modelDecisionEnvelopeSchema.parse(raw).decision;
}

export function toModelDecisionEnvelope(decision: DiscoveryDecision): ModelDecisionEnvelope {
  return { decision };
}

const assertion = { anyOf: [
  { type: "object", properties: { kind: { type: "string", enum: ["visible"] }, locator: { $ref: "#/$defs/locator" }, timeoutMs: { type: "integer", minimum: 1 } }, required: ["kind", "locator", "timeoutMs"], additionalProperties: false },
  { type: "object", properties: { kind: { type: "string", enum: ["text"] }, locator: { $ref: "#/$defs/locator" }, expected: { $ref: "#/$defs/value" }, timeoutMs: { type: "integer", minimum: 1 } }, required: ["kind", "locator", "expected", "timeoutMs"], additionalProperties: false },
  { type: "object", properties: { kind: { type: "string", enum: ["url"] }, expected: { $ref: "#/$defs/value" }, timeoutMs: { type: "integer", minimum: 1 } }, required: ["kind", "expected", "timeoutMs"], additionalProperties: false }
] };

export const discoveryDecisionJsonSchema = {
  type: "object",
  properties: { decision: { $ref: "#/$defs/decision" } },
  required: ["decision"],
  additionalProperties: false,
  $defs: {
    locator: { type: "object", properties: { strategy: { type: "string", enum: ["role", "label", "text", "css", "coordinates"] }, value: { type: "string" }, name: { type: "string" }, frame: { type: "array", items: { type: "string" } }, logicalTarget: { type: "string" }, fallback: { type: "array", items: { $ref: "#/$defs/locator" } }, rationale: { type: "string" } }, required: ["strategy", "value", "name", "frame", "logicalTarget", "fallback", "rationale"], additionalProperties: false },
    value: { anyOf: [
      { type: "object", properties: { source: { type: "string", enum: ["literal"] }, value: { type: "string" } }, required: ["source", "value"], additionalProperties: false },
      { type: "object", properties: { source: { type: "string", enum: ["input"] }, key: { type: "string" } }, required: ["source", "key"], additionalProperties: false }
    ] },
    assertion,
    decision: { anyOf: [
      { type: "object", properties: { kind: { type: "string", enum: ["navigate"] }, url: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "url", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["click"] }, target: { $ref: "#/$defs/locator" }, rationale: { type: "string" } }, required: ["kind", "target", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["fill"] }, target: { $ref: "#/$defs/locator" }, inputKey: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "target", "inputKey", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["extract"] }, target: { $ref: "#/$defs/locator" }, outputKey: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "target", "outputKey", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["wait"] }, durationMs: { type: "integer", minimum: 50, maximum: 2000 }, rationale: { type: "string" } }, required: ["kind", "durationMs", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["complete"] }, checkpoint: { $ref: "#/$defs/assertion" }, businessOutcomes: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, assertion: { $ref: "#/$defs/assertion" } }, required: ["code", "message", "assertion"], additionalProperties: false } }, rationale: { type: "string" } }, required: ["kind", "checkpoint", "businessOutcomes", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["business_outcome"] }, code: { type: "string" }, message: { type: "string" }, assertion: { $ref: "#/$defs/assertion" }, rationale: { type: "string" } }, required: ["kind", "code", "message", "assertion", "rationale"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["request_human"] }, reason: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "reason", "rationale"], additionalProperties: false }
    ] }
  }
} as const;
