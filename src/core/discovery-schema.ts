import { z } from "zod";
import { assertionSchema, locatorSchema } from "./schema.js";

const rationale = z.string().min(1);
export const discoveryDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url(), rationale }),
  z.object({ kind: z.literal("click"), target: locatorSchema, rationale }),
  z.object({ kind: z.literal("fill"), target: locatorSchema, inputKey: z.string(), rationale }),
  z.object({ kind: z.literal("extract"), target: locatorSchema, outputKey: z.string(), rationale }),
  z.object({ kind: z.literal("wait"), durationMs: z.number().int().min(50).max(2000), rationale }),
  z.object({ kind: z.literal("complete"), checkpoint: assertionSchema, businessOutcomes: z.array(z.object({ code: z.string(), message: z.string(), assertion: assertionSchema })).default([]), rationale }),
  z.object({ kind: z.literal("business_outcome"), code: z.string(), message: z.string(), assertion: assertionSchema, rationale }),
  z.object({ kind: z.literal("request_human"), reason: z.string(), rationale })
]);

export type DiscoveryDecision = z.infer<typeof discoveryDecisionSchema>;

const modelDecisionEnvelopeSchema = z.object({
  kind: z.enum(["navigate", "click", "fill", "extract", "wait", "complete", "business_outcome", "request_human"]),
  rationale,
  url: z.string().nullable(),
  target: locatorSchema.nullable(),
  inputKey: z.string().nullable(),
  outputKey: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  checkpoint: assertionSchema.nullable(),
  businessOutcomes: z.array(z.object({ code: z.string(), message: z.string(), assertion: assertionSchema })),
  code: z.string().nullable(),
  message: z.string().nullable(),
  assertion: assertionSchema.nullable(),
  reason: z.string().nullable()
}).strict();

type ModelDecisionEnvelope = z.infer<typeof modelDecisionEnvelopeSchema>;

const required = <T>(value: T | null, field: string): T => {
  if (value === null) throw new Error(`Model decision requires ${field}`);
  return value;
};

export function parseModelDecision(raw: unknown): DiscoveryDecision {
  const decision = modelDecisionEnvelopeSchema.parse(raw);
  const applicable: Record<ModelDecisionEnvelope["kind"], Array<keyof ModelDecisionEnvelope>> = {
    navigate: ["url"], click: ["target"], fill: ["target", "inputKey"], extract: ["target", "outputKey"], wait: ["durationMs"],
    complete: ["checkpoint"], business_outcome: ["code", "message", "assertion"], request_human: ["reason"]
  };
  const nullableFields: Array<keyof ModelDecisionEnvelope> = ["url", "target", "inputKey", "outputKey", "durationMs", "checkpoint", "code", "message", "assertion", "reason"];
  for (const field of nullableFields) if (!applicable[decision.kind].includes(field) && decision[field] !== null) throw new Error(`Model decision field ${field} must be null for ${decision.kind}`);
  if (decision.kind !== "complete" && decision.businessOutcomes.length > 0) throw new Error(`Model decision businessOutcomes must be empty for ${decision.kind}`);
  switch (decision.kind) {
    case "navigate": return discoveryDecisionSchema.parse({ kind: decision.kind, url: required(decision.url, "url"), rationale: decision.rationale });
    case "click": return discoveryDecisionSchema.parse({ kind: decision.kind, target: required(decision.target, "target"), rationale: decision.rationale });
    case "fill": return discoveryDecisionSchema.parse({ kind: decision.kind, target: required(decision.target, "target"), inputKey: required(decision.inputKey, "inputKey"), rationale: decision.rationale });
    case "extract": return discoveryDecisionSchema.parse({ kind: decision.kind, target: required(decision.target, "target"), outputKey: required(decision.outputKey, "outputKey"), rationale: decision.rationale });
    case "wait": return discoveryDecisionSchema.parse({ kind: decision.kind, durationMs: required(decision.durationMs, "durationMs"), rationale: decision.rationale });
    case "complete": return discoveryDecisionSchema.parse({ kind: decision.kind, checkpoint: required(decision.checkpoint, "checkpoint"), businessOutcomes: decision.businessOutcomes, rationale: decision.rationale });
    case "business_outcome": return discoveryDecisionSchema.parse({ kind: decision.kind, code: required(decision.code, "code"), message: required(decision.message, "message"), assertion: required(decision.assertion, "assertion"), rationale: decision.rationale });
    case "request_human": return discoveryDecisionSchema.parse({ kind: decision.kind, reason: required(decision.reason, "reason"), rationale: decision.rationale });
  }
}

export function toModelDecisionEnvelope(decision: DiscoveryDecision): ModelDecisionEnvelope {
  return {
    kind: decision.kind,
    rationale: decision.rationale,
    url: decision.kind === "navigate" ? decision.url : null,
    target: "target" in decision ? decision.target : null,
    inputKey: decision.kind === "fill" ? decision.inputKey : null,
    outputKey: decision.kind === "extract" ? decision.outputKey : null,
    durationMs: decision.kind === "wait" ? decision.durationMs : null,
    checkpoint: decision.kind === "complete" ? decision.checkpoint : null,
    businessOutcomes: decision.kind === "complete" ? decision.businessOutcomes : [],
    code: decision.kind === "business_outcome" ? decision.code : null,
    message: decision.kind === "business_outcome" ? decision.message : null,
    assertion: decision.kind === "business_outcome" ? decision.assertion : null,
    reason: decision.kind === "request_human" ? decision.reason : null
  };
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const assertion = { anyOf: [
  { type: "object", properties: { kind: { const: "visible" }, locator: { $ref: "#/$defs/locator" }, timeoutMs: { type: "integer" } }, required: ["kind", "locator", "timeoutMs"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "text" }, locator: { $ref: "#/$defs/locator" }, expected: { $ref: "#/$defs/value" }, timeoutMs: { type: "integer" } }, required: ["kind", "locator", "expected", "timeoutMs"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "url" }, expected: { $ref: "#/$defs/value" }, timeoutMs: { type: "integer" } }, required: ["kind", "expected", "timeoutMs"], additionalProperties: false }
] };

export const discoveryDecisionJsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["navigate", "click", "fill", "extract", "wait", "complete", "business_outcome", "request_human"] },
    rationale: { type: "string" },
    url: { type: ["string", "null"] },
    target: nullable({ $ref: "#/$defs/locator" }),
    inputKey: { type: ["string", "null"] },
    outputKey: { type: ["string", "null"] },
    durationMs: nullable({ type: "integer", minimum: 50, maximum: 2000 }),
    checkpoint: nullable({ $ref: "#/$defs/assertion" }),
    businessOutcomes: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, assertion: { $ref: "#/$defs/assertion" } }, required: ["code", "message", "assertion"], additionalProperties: false } },
    code: { type: ["string", "null"] },
    message: { type: ["string", "null"] },
    assertion: nullable({ $ref: "#/$defs/assertion" }),
    reason: { type: ["string", "null"] }
  },
  required: ["kind", "rationale", "url", "target", "inputKey", "outputKey", "durationMs", "checkpoint", "businessOutcomes", "code", "message", "assertion", "reason"],
  additionalProperties: false,
  $defs: {
    locator: { type: "object", properties: { strategy: { type: "string", enum: ["role", "label", "text", "css", "coordinates"] }, value: { type: "string" }, name: { type: "string" }, frame: { type: "array", items: { type: "string" } }, logicalTarget: { type: "string" }, fallback: { type: "array", items: { $ref: "#/$defs/locator" } }, rationale: { type: "string" } }, required: ["strategy", "value", "name", "frame", "logicalTarget", "fallback", "rationale"], additionalProperties: false },
    value: { anyOf: [
      { type: "object", properties: { source: { const: "literal" }, value: { type: "string" } }, required: ["source", "value"], additionalProperties: false },
      { type: "object", properties: { source: { const: "input" }, key: { type: "string" } }, required: ["source", "key"], additionalProperties: false }
    ] },
    assertion
  }
} as const;
