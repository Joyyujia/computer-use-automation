import { z } from "zod";

export type Locator = {
  strategy: "role" | "label" | "text" | "css" | "coordinates";
  value: string;
  name?: string;
  frame?: string[];
  fallback: Locator[];
  rationale: string;
};

export const locatorSchema: z.ZodType<Locator> = z.object({
  strategy: z.enum(["role", "label", "text", "css", "coordinates"]),
  value: z.string().min(1),
  name: z.string().optional(),
  frame: z.array(z.string()).optional(),
  fallback: z.array(z.lazy(() => locatorSchema)).default([]),
  rationale: z.string().min(1)
});

export const valueSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.string() }),
  z.object({ source: z.literal("input"), key: z.string() })
]);

export const assertionSchema = z.object({
  kind: z.enum(["visible", "text", "url"]),
  locator: locatorSchema.optional(),
  expected: valueSchema,
  timeoutMs: z.number().int().positive().default(5000)
});

export const stepSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["navigate", "click", "fill", "select", "extract", "assert"]),
  target: locatorSchema.optional(),
  value: valueSchema.optional(),
  outputKey: z.string().optional(),
  assertion: assertionSchema.optional(),
  risk: z.enum(["safe", "reversible", "irreversible"]),
  timeoutMs: z.number().int().positive().default(5000),
  retries: z.number().int().min(0).max(3).default(1)
});

const fieldSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string(),
  sensitive: z.boolean().default(false)
});

export const capabilitySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1),
  description: z.string(),
  surface: z.object({
    adapter: z.literal("playwright"),
    appFamily: z.string(),
    entrypoint: z.string().url(),
    tenantVariant: z.string().optional()
  }),
  inputs: z.record(z.string(), fieldSchema),
  outputs: z.record(z.string(), fieldSchema),
  steps: z.array(stepSchema).min(1),
  checkpoint: assertionSchema,
  approval: z.enum(["draft", "approved"]).default("draft"),
  createdAt: z.string().datetime()
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Step = z.infer<typeof stepSchema>;

export type RunResult =
  | { status: "success"; runId: string; outputs: Record<string, unknown> }
  | { status: "business_outcome"; runId: string; code: string; message: string }
  | { status: "failure"; runId: string; error: RunError };

export type RunError = {
  category: "policy" | "timeout" | "target_not_found" | "unexpected_state" | "session" | "internal";
  stepId?: string;
  message: string;
  expected?: string;
  observed?: string;
  evidencePath?: string;
  recoverable: boolean;
};
