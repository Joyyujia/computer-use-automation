import { z } from "zod";
import { assertionSchema, locatorSchema } from "./schema.js";

const rationale = z.string().min(1);
export const discoveryDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url(), rationale }),
  z.object({ kind: z.literal("click"), target: locatorSchema, rationale }),
  z.object({ kind: z.literal("fill"), target: locatorSchema, inputKey: z.string(), rationale }),
  z.object({ kind: z.literal("extract"), target: locatorSchema, outputKey: z.string(), rationale }),
  z.object({ kind: z.literal("complete"), checkpoint: assertionSchema, businessOutcomes: z.array(z.object({ code: z.string(), message: z.string(), assertion: assertionSchema })).default([]), rationale }),
  z.object({ kind: z.literal("business_outcome"), code: z.string(), message: z.string(), assertion: assertionSchema, rationale }),
  z.object({ kind: z.literal("request_human"), reason: z.string(), rationale })
]);

export type DiscoveryDecision = z.infer<typeof discoveryDecisionSchema>;

export const discoveryDecisionJsonSchema = {
  type: "object",
  oneOf: [
    { properties: { kind: { const: "navigate" }, url: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "url", "rationale"], additionalProperties: false },
    ...["click"].map(kind => ({ properties: { kind: { const: kind }, target: { $ref: "#/$defs/locator" }, rationale: { type: "string" } }, required: ["kind", "target", "rationale"], additionalProperties: false })),
    ...["fill"].map(kind => ({ properties: { kind: { const: kind }, target: { $ref: "#/$defs/locator" }, inputKey: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "target", "inputKey", "rationale"], additionalProperties: false })),
    ...["extract"].map(kind => ({ properties: { kind: { const: kind }, target: { $ref: "#/$defs/locator" }, outputKey: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "target", "outputKey", "rationale"], additionalProperties: false })),
    { properties: { kind: { const: "complete" }, checkpoint: { $ref: "#/$defs/assertion" }, businessOutcomes: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, assertion: { $ref: "#/$defs/assertion" } }, required: ["code", "message", "assertion"], additionalProperties: false } }, rationale: { type: "string" } }, required: ["kind", "checkpoint", "businessOutcomes", "rationale"], additionalProperties: false },
    { properties: { kind: { const: "business_outcome" }, code: { type: "string" }, message: { type: "string" }, assertion: { $ref: "#/$defs/assertion" }, rationale: { type: "string" } }, required: ["kind", "code", "message", "assertion", "rationale"], additionalProperties: false },
    { properties: { kind: { const: "request_human" }, reason: { type: "string" }, rationale: { type: "string" } }, required: ["kind", "reason", "rationale"], additionalProperties: false }
  ],
  $defs: {
    locator: { type: "object", properties: { strategy: { enum: ["role", "label", "text", "css", "coordinates"] }, value: { type: "string" }, name: { type: "string" }, frame: { type: "array", items: { type: "string" } }, fallback: { type: "array", items: { $ref: "#/$defs/locator" } }, rationale: { type: "string" } }, required: ["strategy", "value", "name", "frame", "fallback", "rationale"], additionalProperties: false },
    value: { type: "object", oneOf: [{ properties: { source: { const: "literal" }, value: { type: "string" } }, required: ["source", "value"], additionalProperties: false }, { properties: { source: { const: "input" }, key: { type: "string" } }, required: ["source", "key"], additionalProperties: false }] },
    assertion: { type: "object", properties: { kind: { enum: ["visible", "text", "url"] }, locator: { $ref: "#/$defs/locator" }, expected: { $ref: "#/$defs/value" }, timeoutMs: { type: "integer" } }, required: ["kind", "locator", "expected", "timeoutMs"], additionalProperties: false }
  }
} as const;
