import { capabilitySchema, type Capability, type Step } from "./schema.js";
import type { DiscoveryDecision } from "./discovery-schema.js";

export function compileArtifact(options: {
  goal: string; entrypoint: string; runId: string; model: string;
  decisions: DiscoveryDecision[]; inputKeys: string[]; checkpoint: Capability["checkpoint"];
}): Capability {
  const steps: Step[] = [];
  for (const [index, decision] of options.decisions.entries()) {
    const common = { id: `step-${index + 1}`, risk: "safe" as const, timeoutMs: 5000, retries: 1 };
    if (decision.kind === "navigate") steps.push({ ...common, action: "navigate", value: { source: "literal", value: decision.url } });
    if (decision.kind === "click") steps.push({ ...common, action: "click", target: decision.target });
    if (decision.kind === "fill") steps.push({ ...common, action: "fill", target: decision.target, value: { source: "input", key: decision.inputKey } });
    if (decision.kind === "extract") steps.push({ ...common, action: "extract", target: decision.target, outputKey: decision.outputKey });
  }
  const outcomes = options.decisions.flatMap(d => d.kind === "business_outcome" ? [{ code: d.code, message: d.message, assertion: d.assertion }] : d.kind === "complete" ? d.businessOutcomes : []);
  const outputKeys = options.decisions.filter((d): d is Extract<DiscoveryDecision, { kind: "extract" }> => d.kind === "extract").map(d => d.outputKey);
  return capabilitySchema.parse({
    schemaVersion: "1.0", id: "member.lookup-savings-balance", version: "1.0.0",
    name: "Look up savings balance", description: options.goal,
    surface: { adapter: "playwright", appFamily: "northstar-core", entrypoint: options.entrypoint },
    inputs: Object.fromEntries(options.inputKeys.map(key => [key, { type: "string", description: `Invocation input ${key}`, sensitive: true }])),
    outputs: Object.fromEntries(outputKeys.map(key => [key, { type: "string", description: `Extracted output ${key}`, sensitive: true }])),
    steps, checkpoint: options.checkpoint, businessOutcomes: outcomes, recoveries: [], approval: "draft",
    provenance: { discoveryRunId: options.runId, model: options.model, createdFromLiveRun: options.model !== "scripted-test-fixture" },
    createdAt: new Date().toISOString()
  });
}
