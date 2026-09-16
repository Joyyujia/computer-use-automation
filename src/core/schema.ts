import { z } from "zod";

export type Locator = {
  strategy: "role" | "label" | "text" | "css" | "coordinates";
  value: string;
  name?: string;
  frame?: string[];
  logicalTarget?: string;
  fallback: Locator[];
  rationale: string;
};

export const locatorSchema: z.ZodType<Locator> = z.object({
  strategy: z.enum(["role", "label", "text", "css", "coordinates"]),
  value: z.string().min(1),
  name: z.string().optional(),
  frame: z.array(z.string()).optional(),
  logicalTarget: z.string().min(1).optional(),
  fallback: z.array(z.lazy(() => locatorSchema)).default([]),
  rationale: z.string().min(1)
}).superRefine((locator, ctx) => {
  if (locator.fallback.length > 0 && !locator.logicalTarget) ctx.addIssue({ code: "custom", message: "A locator with fallbacks requires logicalTarget", path: ["logicalTarget"] });
  locator.fallback.forEach((fallback, index) => {
    if (fallback.logicalTarget !== locator.logicalTarget) ctx.addIssue({ code: "custom", message: "Fallback must declare the same logicalTarget as its primary locator", path: ["fallback", index, "logicalTarget"] });
  });
});

export const valueSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.string() }),
  z.object({ source: z.literal("input"), key: z.string() })
]);

export const assertionSchema = z.object({
  kind: z.enum(["visible", "text", "url"]),
  locator: locatorSchema.optional(),
  expected: valueSchema.optional(),
  timeoutMs: z.number().int().positive().default(5000)
}).superRefine((assertion, ctx) => {
  if (assertion.kind !== "url" && !assertion.locator) ctx.addIssue({ code: "custom", message: `${assertion.kind} assertion requires a locator`, path: ["locator"] });
  if (assertion.kind === "visible" && assertion.expected) ctx.addIssue({ code: "custom", message: "visible assertion does not accept expected", path: ["expected"] });
  if (assertion.kind !== "visible" && !assertion.expected) ctx.addIssue({ code: "custom", message: `${assertion.kind} assertion requires expected`, path: ["expected"] });
});

export const outcomeDetectorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  assertion: assertionSchema
});

export const interventionDetectorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  assertion: assertionSchema,
  resume: z.enum(["retry_step", "verify_then_continue", "abort"]).default("retry_step"),
  resumeAssertion: assertionSchema.optional()
}).superRefine((intervention, ctx) => {
  if (intervention.resume === "verify_then_continue" && !intervention.resumeAssertion) ctx.addIssue({ code: "custom", message: "verify_then_continue requires resumeAssertion", path: ["resumeAssertion"] });
});

export const recoveryRuleSchema = z.object({
  id: z.string().min(1),
  when: assertionSchema,
  steps: z.array(z.lazy(() => stepSchema)),
  maxAttempts: z.number().int().min(1).max(3).default(1)
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
}).superRefine((step, ctx) => {
  if (["click", "fill", "select", "extract"].includes(step.action) && !step.target) ctx.addIssue({ code: "custom", message: `${step.action} requires a target`, path: ["target"] });
  if (["navigate", "fill", "select"].includes(step.action) && !step.value) ctx.addIssue({ code: "custom", message: `${step.action} requires a value`, path: ["value"] });
  if (step.action === "extract" && !step.outputKey) ctx.addIssue({ code: "custom", message: "extract requires outputKey", path: ["outputKey"] });
  if (step.action === "assert" && !step.assertion) ctx.addIssue({ code: "custom", message: "assert requires an assertion", path: ["assertion"] });
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
  successAssertions: z.array(assertionSchema).default([]),
  businessOutcomes: z.array(outcomeDetectorSchema).default([]),
  interventions: z.array(interventionDetectorSchema).default([]),
  recoveries: z.array(recoveryRuleSchema).default([]),
  provenance: z.object({
    discoveryRunId: z.string(),
    model: z.string(),
    createdFromLiveRun: z.boolean(),
    configuredAdditions: z.array(z.string()).default([]),
    modelResponseIds: z.array(z.string()).default([])
  }).optional(),
  approval: z.enum(["draft", "approved"]).default("draft"),
  createdAt: z.string().datetime()
}).superRefine((capability, ctx) => {
  const ids = new Set<string>();
  const locatorTree = (locator: Locator): Locator[] => [locator, ...locator.fallback.flatMap(locatorTree)];
  const validateAssertion = (assertion: z.infer<typeof assertionSchema>, path: Array<string | number>) => {
    if (assertion.expected?.source === "input" && !capability.inputs[assertion.expected.key]) ctx.addIssue({ code: "custom", message: `Unknown input ${assertion.expected.key}`, path: [...path, "expected"] });
  };
  const validateStep = (step: Step, path: Array<string | number>) => {
    if (ids.has(step.id)) ctx.addIssue({ code: "custom", message: `Duplicate step id ${step.id}`, path: [...path, "id"] });
    ids.add(step.id);
    if (step.value?.source === "input" && !capability.inputs[step.value.key]) ctx.addIssue({ code: "custom", message: `Unknown input ${step.value.key}`, path: [...path, "value"] });
    if (step.outputKey && !capability.outputs[step.outputKey]) ctx.addIssue({ code: "custom", message: `Unknown output ${step.outputKey}`, path: [...path, "outputKey"] });
    if (step.assertion) validateAssertion(step.assertion, [...path, "assertion"]);
    const extractionTargets = step.action === "extract" && step.target ? locatorTree(step.target) : [];
    if (extractionTargets.some(target => target.strategy === "text")) ctx.addIssue({ code: "custom", message: "Output extraction cannot use runtime text as a locator", path: [...path, "target"] });
  };
  capability.steps.forEach((step, index) => validateStep(step, ["steps", index]));
  validateAssertion(capability.checkpoint, ["checkpoint"]);
  capability.successAssertions.forEach((assertion, index) => validateAssertion(assertion, ["successAssertions", index]));
  capability.businessOutcomes.forEach((outcome, index) => validateAssertion(outcome.assertion, ["businessOutcomes", index, "assertion"]));
  capability.interventions.forEach((intervention, index) => { validateAssertion(intervention.assertion, ["interventions", index, "assertion"]); if (intervention.resumeAssertion) validateAssertion(intervention.resumeAssertion, ["interventions", index, "resumeAssertion"]); });
  capability.recoveries.forEach((recovery, recoveryIndex) => {
    validateAssertion(recovery.when, ["recoveries", recoveryIndex, "when"]);
    recovery.steps.forEach((step, stepIndex) => validateStep(step, ["recoveries", recoveryIndex, "steps", stepIndex]));
  });
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Step = z.infer<typeof stepSchema>;

export type RunResult =
  | { status: "success"; runId: string; outputs: Record<string, unknown>; evidencePath: string }
  | { status: "business_outcome"; runId: string; code: string; message: string; evidencePath: string }
  | { status: "intervention_required"; runId: string; interventionId: string; reason: string; evidencePath: string }
  | { status: "failure"; runId: string; error: RunError; evidencePath: string };

export type RunError = {
  category: "policy_denied" | "timeout" | "target_not_found" | "ambiguous_target" | "checkpoint_failed" | "output_invalid" | "unexpected_dialog" | "unexpected_state" | "session_expired" | "control_conflict" | "internal";
  stepId?: string;
  message: string;
  expected?: string;
  observed?: string;
  evidencePath?: string;
  recoverable: boolean;
};
