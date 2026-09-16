import { capabilitySchema, type Capability, type Step } from "./schema.js";
import type { DiscoveryDecision } from "./discovery-schema.js";
import { lookupBalanceProfile, type CapabilityProfile } from "./capability-profile.js";
import { redactText } from "./redact.js";

function assertPersistableUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error("Generated artifact URL contains non-persistable credentials, query values, or fragment data");
}

export function compileArtifact(options: {
  goal: string; entrypoint: string; runId: string; model: string;
  decisions: DiscoveryDecision[]; inputKeys: string[]; checkpoint: Capability["checkpoint"];
  inputDefinitions?: Capability["inputs"]; profile?: CapabilityProfile; sensitiveValues?: string[]; createdFromLiveRun?: boolean; modelResponseIds?: string[];
}): Capability {
  const profile = options.profile ?? lookupBalanceProfile;
  assertPersistableUrl(options.entrypoint);
  const steps: Step[] = [];
  for (const [index, decision] of options.decisions.entries()) {
    const common = { id: `step-${index + 1}`, risk: "safe" as const, timeoutMs: 5000, retries: 0 };
    if (decision.kind === "navigate") { assertPersistableUrl(decision.url); steps.push({ ...common, action: "navigate", value: { source: "literal", value: decision.url } }); }
    if (decision.kind === "click") steps.push({ ...common, action: "click", target: decision.target });
    if (decision.kind === "fill") steps.push({ ...common, action: "fill", target: decision.target, value: { source: "input", key: decision.inputKey } });
    if (decision.kind === "extract") steps.push({ ...common, action: "extract", target: decision.target, outputKey: decision.outputKey });
  }
  const outputKeys = options.decisions.filter((d): d is Extract<DiscoveryDecision, { kind: "extract" }> => d.kind === "extract").map(d => d.outputKey);
  const artifact = capabilitySchema.parse({
    schemaVersion: "1.0", id: profile.id, version: "1.0.0",
    name: profile.name, description: options.goal,
    surface: { adapter: "playwright", appFamily: profile.appFamily, entrypoint: options.entrypoint },
    inputs: options.inputDefinitions ?? Object.fromEntries(options.inputKeys.map(key => [key, { type: "string", description: `Invocation input ${key}`, sensitive: true }])),
    outputs: Object.fromEntries(outputKeys.map(key => [key, profile.outputs[key] ?? { type: "string", description: `Extracted output ${key}`, sensitive: true }])),
    steps, checkpoint: profile.checkpoint, successAssertions: profile.successAssertions, businessOutcomes: profile.businessOutcomes,
    recoveries: profile.recoveries, interventions: profile.interventions, approval: "draft",
    provenance: { discoveryRunId: options.runId, model: options.model, createdFromLiveRun: options.createdFromLiveRun === true, configuredAdditions: ["success contract", "business outcomes", "recoveries", "interventions"], modelResponseIds: options.modelResponseIds ?? [] },
    createdAt: new Date().toISOString()
  });
  const serialized = JSON.stringify(artifact);
  for (const value of options.sensitiveValues ?? []) if (value && serialized.includes(value)) throw new Error("Generated artifact contains a sensitive runtime value");
  if (redactText(serialized, options.sensitiveValues) !== serialized) throw new Error("Generated artifact contains text blocked by the persistence redaction policy");
  const locatorTree = (locator: NonNullable<Step["target"]>): NonNullable<Step["target"]>[] => [locator, ...locator.fallback.flatMap(locatorTree)];
  for (const step of artifact.steps) if (step.action === "extract" && step.target && locatorTree(step.target).some(target => target.strategy === "text")) throw new Error("Output extraction cannot use discovered runtime text as a locator");
  return artifact;
}
