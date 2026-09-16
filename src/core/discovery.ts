import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { Capability, Step } from "./schema.js";
import type { DiscoveryDecision } from "./discovery-schema.js";
import type { ModelAdapter } from "./model-adapter.js";
import { compileArtifact } from "./artifact-compiler.js";
import { lookupBalanceProfile, type CapabilityProfile } from "./capability-profile.js";
import { EvidenceWriter } from "./evidence.js";
import { PlaywrightSurface } from "./playwright-surface.js";
import { defaultPolicy, enforceBrowserState, enforcePolicy, PolicyViolation, type Policy } from "./policy.js";
import { RunStateMachine } from "./run-state.js";
import { replay } from "./replay.js";

export type DiscoveryResult = { status: "success"; runId: string; artifact: Capability; artifactPath: string; evidencePath: string } | { status: "business_outcome"; runId: string; code: string; message: string; evidencePath: string } | { status: "intervention_required"; runId: string; reason: string; evidencePath: string } | { status: "failure"; runId: string; message: string; evidencePath: string };

function decisionStep(decision: DiscoveryDecision, index: number): Step | undefined {
  const common = { id: `discovery-${index}`, risk: "safe" as const, timeoutMs: 5000, retries: 0 };
  if (decision.kind === "navigate") return { ...common, action: "navigate", value: { source: "literal", value: decision.url } };
  if (decision.kind === "click") return { ...common, action: "click", target: decision.target };
  if (decision.kind === "fill") return { ...common, action: "fill", target: decision.target, value: { source: "input", key: decision.inputKey } };
  if (decision.kind === "extract") return { ...common, action: "extract", target: decision.target, outputKey: decision.outputKey };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Model call timed out")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function discover(options: {
  goal: string; entrypoint: string; inputDefinitions?: Capability["inputs"]; inputs: Record<string, unknown>; model: ModelAdapter; profile?: CapabilityProfile; policy?: Policy;
  maxSteps?: number; timeoutMs?: number; modelTimeoutMs?: number; headless?: boolean; evidenceRoot?: string; artifactRoot?: string;
  page?: Page; canAutomationAct?: () => boolean;
  onIntervention?: (context: { runId: string; step: Step; reason: string; capabilityId: string; goal: string; sanitizedContext: Record<string, unknown>; page: Page; evidence: EvidenceWriter }) => Promise<{ interventionId: string }>;
}): Promise<DiscoveryResult> {
  const runId = randomUUID(); const sensitiveInputs = Object.values(options.inputs).filter((value): value is string => typeof value === "string" && value.length > 0);
  const evidence = new EvidenceWriter(runId, options.evidenceRoot, sensitiveInputs); await evidence.init(); const profile = options.profile ?? lookupBalanceProfile;
  const safeGoal = Object.entries(options.inputs).reduce((goal, [key, value]) => typeof value === "string" && value ? goal.replaceAll(value, `[INPUT:${key}]`) : goal, options.goal);
  await evidence.ensure("observations"); await evidence.manifest({ runId, mode: "discovery", goal: safeGoal, model: options.model.name, modelBacked: options.model.isLive === true, policy: options.policy ?? defaultPolicy, profile: profile.id, startedAt: new Date().toISOString() });
  const inputDefinitions = options.inputDefinitions ?? Object.fromEntries(Object.keys(options.inputs).map(key => [key, { type: "string" as const, description: `Invocation input ${key}`, sensitive: true }]));
  for (const [key, definition] of Object.entries(inputDefinitions)) {
    if (!(key in options.inputs)) { const result = { status: "failure" as const, runId, message: `Missing input: ${key}`, evidencePath: evidence.directory }; await evidence.result(result); return result; }
    if (typeof options.inputs[key] !== definition.type) { const result = { status: "failure" as const, runId, message: `Input ${key} must be ${definition.type}`, evidencePath: evidence.directory }; await evidence.result(result); return result; }
  }
  for (const key of Object.keys(options.inputs)) if (!inputDefinitions[key]) { const result = { status: "failure" as const, runId, message: `Invocation supplied undeclared input: ${key}`, evidencePath: evidence.directory }; await evidence.result(result); return result; }
  const state = new RunStateMachine(); state.transition("starting");
  const browser = options.page ? undefined : await chromium.launch({ headless: options.headless ?? true }); const context = browser ? await browser.newContext() : undefined;
  const page = options.page ?? await context!.newPage(); const surface = new PlaywrightSurface(page, options.canAutomationAct);
  const observeForEvidence = async () => {
    try { return evidence.sanitize(await surface.observe()); }
    catch (error) { return { url: "[OBSERVATION_UNAVAILABLE]", title: "", visibleText: "", controls: [], extractables: [], alerts: [evidence.sanitize(error instanceof Error ? error.message : String(error))] }; }
  };
  const successfulDecisions: DiscoveryDecision[] = []; const modelResponseIds: string[] = []; const history: Array<{ decision: DiscoveryDecision; outcome: string }> = []; const outputs: Record<string, unknown> = {}; const repeated = new Map<string, number>();
  const deadline = Date.now() + (options.timeoutMs ?? 60_000); let proposedCheckpoint: Capability["checkpoint"] | undefined;
  const requestHuman = async (step: Step, reason: string): Promise<DiscoveryResult | undefined> => {
    if (!options.onIntervention) { const result = { status: "intervention_required" as const, runId, reason, evidencePath: evidence.directory }; await evidence.result(result); return result; }
    const observation = await observeForEvidence();
    const intervention = await options.onIntervention({ runId, step, reason: evidence.sanitize(reason), capabilityId: profile.id, goal: safeGoal, sanitizedContext: { url: observation.url, title: observation.title, alerts: observation.alerts, controls: observation.controls, extractables: observation.extractables }, page, evidence }); await evidence.event({ type: "intervention_completed", interventionId: intervention.interventionId, stepId: step.id });
  };
  try {
    state.transition("automation_in_control");
    const openDecision: DiscoveryDecision = { kind: "navigate", url: options.entrypoint, rationale: "Open the configured target entrypoint" };
    const openStep = decisionStep(openDecision, 0)!;
    try {
      enforcePolicy(openStep, options.policy ?? defaultPolicy);
      await surface.execute(openStep, options.entrypoint);
      await enforceBrowserState(page, options.policy ?? defaultPolicy);
    } catch (error) {
      if (error instanceof PolicyViolation) throw error;
      const result = await requestHuman(openStep, `Could not open target URL: ${error instanceof Error ? error.message : String(error)}`); if (result) return result;
      await enforceBrowserState(page, options.policy ?? defaultPolicy);
    }
    successfulDecisions.push(openDecision); history.push({ decision: openDecision, outcome: "configured target opened" });
    await evidence.event({ type: "target_opened", url: evidence.sanitize(options.entrypoint) });
    for (let index = 1; index <= (options.maxSteps ?? 12); index++) {
      if (Date.now() > deadline) throw new Error("Discovery timeout exceeded");
      const observation = evidence.sanitize(await surface.observe()); await writeFile(evidence.path("observations", `${String(index).padStart(3, "0")}.json`), JSON.stringify(observation, null, 2) + "\n");
      const modelCall = options.model.decide({ goal: safeGoal, targetUrl: options.entrypoint, inputs: Object.fromEntries(Object.keys(options.inputs).map(key => [key, "[SUPPLIED]"])), observation, history, remainingSteps: (options.maxSteps ?? 12) - index });
      const answer = await withTimeout(modelCall, options.modelTimeoutMs ?? 15_000);
      const decision = answer.decision; if (answer.responseId) modelResponseIds.push(answer.responseId); await evidence.event({ type: "model_decision", index, decision, usage: answer.usage, responseId: answer.responseId });
      const signature = JSON.stringify({ state: [observation.url, observation.visibleText, observation.controls], decision }); const seen = (repeated.get(signature) ?? 0) + 1; repeated.set(signature, seen);
      if (seen >= 2) { const result = await requestHuman({ id: `stuck-${index}`, action: "assert", assertion: profile.checkpoint, risk: "safe", timeoutMs: 1000, retries: 0 }, "Discovery repeated the same action without observable progress"); if (result) return result; repeated.clear(); continue; }
      if (decision.kind === "wait") { await sleep(decision.durationMs); history.push({ decision, outcome: "waited" }); continue; }
      if (decision.kind === "complete") { proposedCheckpoint = decision.checkpoint; break; }
      if (decision.kind === "business_outcome") { state.transition("business_outcome"); const result = { status: "business_outcome" as const, runId, code: decision.code, message: decision.message, evidencePath: evidence.directory }; await evidence.result(result); return result; }
      if (decision.kind === "request_human") { const result = await requestHuman({ id: `human-${index}`, action: "assert", assertion: profile.checkpoint, risk: "safe", timeoutMs: 1000, retries: 0 }, decision.reason); if (result) return result; history.push({ decision, outcome: "human resumed" }); continue; }
      const step = decisionStep(decision, index)!;
      try { enforcePolicy(step, options.policy ?? defaultPolicy); }
      catch (error) {
        if (!(error instanceof PolicyViolation) || !error.message.includes("requires explicit confirmation")) throw error;
        const result = await requestHuman(step, error.message); if (result) return result;
        enforcePolicy(step, options.policy ?? defaultPolicy, true);
      }
      const value = decision.kind === "fill" ? String(options.inputs[decision.inputKey] ?? "") : decision.kind === "navigate" ? decision.url : undefined;
      try {
        let output: string | undefined;
        if (decision.kind === "extract") {
          const extractionDeadline = Date.now() + step.timeoutMs; let extractionError: unknown;
          while (Date.now() <= extractionDeadline) { try { output = await surface.execute(step, value); extractionError = undefined; break; } catch (error) { extractionError = error; await sleep(50); } }
          if (extractionError) throw extractionError;
        } else output = await surface.execute(step, value);
        await enforceBrowserState(page, options.policy ?? defaultPolicy); if (decision.kind === "extract") { outputs[decision.outputKey] = output; evidence.addSensitiveValues([output]); }
        successfulDecisions.push(decision);
        history.push({ decision, outcome: output === undefined ? "completed" : "[EXTRACTED]" });
      } catch (error) {
        const result = await requestHuman(step, `Discovery action failed: ${error instanceof Error ? error.message : String(error)}`); if (result) return result; history.push({ decision, outcome: "human resumed after action failure" });
      }
    }
    if (!proposedCheckpoint) throw new Error("Model did not complete within the step limit");
    for (const assertion of [profile.checkpoint, ...profile.successAssertions]) if (!await surface.matches(assertion, options.inputs)) throw new Error("Configured discovery success contract was not satisfied");
    for (const [key, definition] of Object.entries(profile.outputs)) if (!(key in outputs) || typeof outputs[key] !== definition.type) throw new Error(`Configured discovery output ${key} is missing or invalid`);
    const sensitiveValues = [...Object.values(options.inputs), ...Object.values(outputs)].filter((value): value is string => typeof value === "string");
    const artifact = compileArtifact({ goal: safeGoal, entrypoint: options.entrypoint, runId, model: options.model.name, decisions: successfulDecisions, inputKeys: Object.keys(options.inputs), inputDefinitions, checkpoint: proposedCheckpoint, profile, sensitiveValues, createdFromLiveRun: options.model.isLive === true, modelResponseIds });
    const validation = await replay(artifact, options.inputs, { policy: options.policy ?? defaultPolicy, headless: options.headless ?? true, evidenceRoot: evidence.path("validation") });
    if (validation.status !== "success") throw new Error(`Generated artifact failed deterministic validation: ${validation.status}`);
    for (const key of Object.keys(profile.outputs)) if (validation.outputs[key] !== outputs[key]) throw new Error(`Generated artifact validation output mismatch: ${key}`);
    await evidence.event({ type: "artifact_validation_succeeded", outputKeys: Object.keys(validation.outputs), validationEvidencePath: validation.evidencePath });
    const artifactRoot = path.resolve(options.artifactRoot ?? "artifacts/generated"); await mkdir(artifactRoot, { recursive: true }); const artifactPath = path.join(artifactRoot, `${artifact.id}.${runId}.json`); await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
    state.transition("succeeded"); const result = { status: "success" as const, runId, artifact, artifactPath, evidencePath: evidence.directory }; await evidence.result(result); return result;
  } catch (error) {
    if (!["failed", "succeeded", "business_outcome"].includes(state.state)) state.transition("failed");
    const failureObservation = evidence.path("failure-observation.json"); await writeFile(failureObservation, JSON.stringify(await observeForEvidence(), null, 2) + "\n").catch(() => undefined);
    const result = { status: "failure" as const, runId, message: error instanceof Error ? error.message : String(error), evidencePath: evidence.directory }; await evidence.result(result); return result;
  } finally { if (browser) await browser.close(); }
}
