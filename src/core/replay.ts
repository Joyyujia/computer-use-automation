import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";
import { capabilitySchema, type Capability, type RunResult, type Step } from "./schema.js";
import { defaultPolicy, enforceBrowserState, enforcePolicy, PolicyViolation, type Policy } from "./policy.js";
import { EvidenceWriter } from "./evidence.js";
import { PlaywrightSurface } from "./playwright-surface.js";

const resolveValue = (step: Step, inputs: Record<string, unknown>) => !step.value ? undefined : step.value.source === "literal" ? step.value.value : String(inputs[step.value.key] ?? "");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function replay(raw: unknown, inputs: Record<string, unknown>, options: {
  policy?: Policy; headless?: boolean; confirmedStepIds?: string[]; evidenceRoot?: string; page?: Page; keepSessionOpen?: boolean;
  canAutomationAct?: () => boolean;
  onIntervention?: (context: { runId: string; step: Step; reason: string; capabilityId: string; sanitizedContext: Record<string, unknown>; page: Page; evidence: EvidenceWriter; resume: "retry_step" | "verify_then_continue" | "abort" }) => Promise<{ interventionId: string }>;
} = {}): Promise<RunResult> {
  const capability = capabilitySchema.parse(raw);
  for (const [key, field] of Object.entries(capability.inputs)) {
    if (!(key in inputs)) throw new Error(`Missing input: ${key}`);
    if (typeof inputs[key] !== field.type) throw new Error(`Input ${key} must be ${field.type}`);
  }
  const runId = randomUUID(); const sensitiveInputs = Object.entries(capability.inputs).filter(([key, field]) => field.sensitive && typeof inputs[key] === "string").map(([key]) => String(inputs[key]));
  const evidence = new EvidenceWriter(runId, options.evidenceRoot, sensitiveInputs); await evidence.init();
  await evidence.manifest({ runId, mode: "replay", capabilityId: capability.id, capabilityVersion: capability.version, startedAt: new Date().toISOString() });
  const browser = options.page ? undefined : await chromium.launch({ headless: options.headless ?? true });
  const context = browser ? await browser.newContext() : undefined; const page = options.page ?? await context!.newPage();
  const surface = new PlaywrightSurface(page, options.canAutomationAct); const outputs: Record<string, unknown> = {}; const recoveryAttempts = new Map<string, number>();
  const observeForEvidence = async () => {
    try { return evidence.sanitize(await surface.observe()); }
    catch (error) { return { url: "[OBSERVATION_UNAVAILABLE]", title: "", visibleText: "", controls: [], extractables: [], alerts: [evidence.sanitize(error instanceof Error ? error.message : String(error))] }; }
  };
  let current: Step | undefined;

  const detectOutcome = async (): Promise<Extract<RunResult, { status: "business_outcome" }> | undefined> => {
    for (const outcome of capability.businessOutcomes) if (await surface.matches(outcome.assertion, inputs)) return { status: "business_outcome", runId, code: outcome.code, message: outcome.message, evidencePath: evidence.directory };
  };
  const detectIntervention = async () => {
    for (const intervention of capability.interventions) if (await surface.matches(intervention.assertion, inputs)) return intervention;
  };
  const handleIntervention = async (intervention: Capability["interventions"][number], step: Step): Promise<RunResult | "retry_step" | "verify_then_continue"> => {
    if (!options.onIntervention) {
      const result: RunResult = { status: "intervention_required", runId, interventionId: randomUUID(), reason: intervention.message, evidencePath: evidence.directory };
      await evidence.result(result); return result;
    }
    const observation = await observeForEvidence();
    const handled = await options.onIntervention({ runId, step, reason: evidence.sanitize(intervention.message), capabilityId: capability.id, sanitizedContext: { url: observation.url, title: observation.title, alerts: observation.alerts, controls: observation.controls }, page, evidence, resume: intervention.resume });
    await evidence.event({ type: "intervention_completed", interventionId: handled.interventionId, stepId: step.id });
    if (intervention.resume === "abort") throw new Error(`Human intervention aborted: ${intervention.code}`);
    if (intervention.code !== "approval_required" && await surface.matches(intervention.assertion, inputs)) throw new Error(`Human intervention did not resolve: ${intervention.code}`);
    if (intervention.resume === "verify_then_continue" && intervention.resumeAssertion && !await surface.matches(intervention.resumeAssertion, inputs)) throw new Error(`Human intervention did not satisfy resume assertion: ${intervention.code}`);
    return intervention.resume;
  };
  const handleExecutionFailure = async (step: Step, error: unknown, value?: string, clearedAssertion?: Capability["checkpoint"]): Promise<RunResult | "retry_step" | "verified_by_human" | undefined> => {
    if (!options.onIntervention) return;
    const message = error instanceof Error ? error.message : String(error);
    const retryIsSafe = ["fill", "select", "extract", "assert"].includes(step.action);
    const resume = retryIsSafe ? "retry_step" as const : "verify_then_continue" as const;
    const observation = await observeForEvidence();
    const handled = await options.onIntervention({
      runId, step, reason: evidence.sanitize(`Automation could not complete ${step.id}: ${message}`), capabilityId: capability.id,
      sanitizedContext: { url: observation.url, title: observation.title, alerts: observation.alerts, controls: observation.controls, extractables: observation.extractables },
      page, evidence, resume
    });
    await evidence.event({ type: "execution_failure_intervention_completed", interventionId: handled.interventionId, stepId: step.id, resume });
    if (retryIsSafe) return "retry_step";
    await enforceBrowserState(page, options.policy ?? defaultPolicy);
    const outcome = await detectOutcome();
    if (outcome) { await evidence.result(outcome); return outcome; }
    const establishedState = clearedAssertion ? !await surface.matches(clearedAssertion, inputs) : step.action === "navigate" && value ? new URL(page.url()).href === new URL(value).href : await surface.matches(capability.checkpoint, inputs);
    if (!establishedState) throw new Error(`Human intervention did not establish a verified post-action state for ${step.id}`);
    return "verified_by_human";
  };
  const authorizeStep = async (step: Step, value?: string): Promise<RunResult | undefined> => {
    try { enforcePolicy(step, options.policy ?? defaultPolicy, options.confirmedStepIds?.includes(step.id), value); }
    catch (error) {
      if (!(error instanceof PolicyViolation) || !error.message.includes("requires explicit confirmation")) throw error;
      const policyIntervention = { code: "approval_required", message: error.message, assertion: capability.checkpoint, resume: "retry_step" as const };
      const result = await handleIntervention(policyIntervention, step); if (typeof result !== "string") return result;
      enforcePolicy(step, options.policy ?? defaultPolicy, true, value);
    }
  };
  const executeOnce = async (step: Step, value?: string): Promise<string | undefined> => {
    if (step.action === "assert" && step.assertion) { if (!await surface.matches(step.assertion, inputs)) throw new Error(`Assertion failed: ${step.id}`); return; }
    const extracted = await surface.execute(step, value); await enforceBrowserState(page, options.policy ?? defaultPolicy); return extracted;
  };
  const applyRecoveries = async (): Promise<{ applied: boolean; terminal?: RunResult }> => {
    let applied = false;
    for (const recovery of capability.recoveries) {
      if (!await surface.matches(recovery.when, inputs)) continue;
      const attempts = recoveryAttempts.get(recovery.id) ?? 0;
      if (attempts >= recovery.maxAttempts) {
        const error = new Error(`Recovery ${recovery.id} exhausted after ${attempts} attempts`);
        const recoveryStep = recovery.steps.at(-1) ?? { id: `recovery-${recovery.id}`, action: "assert" as const, assertion: recovery.when, risk: "safe" as const, timeoutMs: recovery.when.timeoutMs, retries: 0 };
        const handoff = await handleExecutionFailure(recoveryStep, error, resolveValue(recoveryStep, inputs), recovery.when);
        if (!handoff) throw error;
        if (typeof handoff !== "string") return { applied, terminal: handoff };
        if (await surface.matches(recovery.when, inputs)) throw error;
        applied = true; await evidence.event({ type: "recovery_completed_by_human", recoveryId: recovery.id }); continue;
      }
      recoveryAttempts.set(recovery.id, attempts + 1); applied = true; await evidence.event({ type: "recovery_started", recoveryId: recovery.id });
      for (const recoveryStep of recovery.steps) {
        const recoveryValue = resolveValue(recoveryStep, inputs);
        const authorization = await authorizeStep(recoveryStep, recoveryValue); if (authorization) return { applied, terminal: authorization };
        try { await executeOnce(recoveryStep, recoveryValue); }
        catch (error) {
          const handoff = await handleExecutionFailure(recoveryStep, error, recoveryValue, recovery.when);
          if (!handoff) throw error;
          if (typeof handoff !== "string") return { applied, terminal: handoff };
          if (handoff === "retry_step") {
            try { await executeOnce(recoveryStep, recoveryValue); }
            catch (retryError) { throw new Error(`Recovery step ${recoveryStep.id} still failed after human intervention: ${retryError instanceof Error ? retryError.message : String(retryError)}`); }
          }
        }
      }
      if (await surface.matches(recovery.when, inputs)) {
        const error = new Error(`Recovery ${recovery.id} did not clear its triggering condition`);
        const recoveryStep = recovery.steps.at(-1) ?? { id: `recovery-${recovery.id}`, action: "assert" as const, assertion: recovery.when, risk: "safe" as const, timeoutMs: recovery.when.timeoutMs, retries: 0 };
        const handoff = await handleExecutionFailure(recoveryStep, error, resolveValue(recoveryStep, inputs), recovery.when);
        if (!handoff) throw error;
        if (typeof handoff !== "string") return { applied, terminal: handoff };
        if (await surface.matches(recovery.when, inputs)) throw error;
      }
      await evidence.event({ type: "recovery_completed", recoveryId: recovery.id });
    }
    return { applied };
  };
  const waitForCompetingState = async (step: Step): Promise<RunResult | undefined> => {
    const deadline = Date.now() + step.timeoutMs;
    while (Date.now() <= deadline) {
      const outcome = await detectOutcome(); if (outcome) { await evidence.result(outcome); return outcome; }
      const intervention = await detectIntervention(); if (intervention) { const result = await handleIntervention(intervention, step); if (typeof result !== "string") return result; }
      const recovery = await applyRecoveries(); if (recovery.terminal) return recovery.terminal; if (recovery.applied) { await sleep(50); continue; }
      if (await surface.matches(capability.checkpoint, inputs)) return;
      await sleep(50);
    }
    throw new Error(`TERMINAL_TIMEOUT: no success, business outcome, recovery, or intervention state appeared within ${step.timeoutMs}ms`);
  };
  const verifyFinalState = async (): Promise<void> => {
    for (const assertion of [capability.checkpoint, ...capability.successAssertions]) if (!await surface.matches(assertion, inputs)) throw new Error("CHECKPOINT_FAILED: required success assertion was not satisfied");
    if (await detectOutcome()) throw new Error("CHECKPOINT_FAILED: contradictory business outcome is active");
    for (const [key, definition] of Object.entries(capability.outputs)) {
      if (!(key in outputs) || outputs[key] === undefined) throw new Error(`OUTPUT_INVALID: required output ${key} is missing`);
      if (typeof outputs[key] !== definition.type) throw new Error(`OUTPUT_INVALID: output ${key} must be ${definition.type}`);
    }
  };
  const refreshInvalidOutputs = async (): Promise<RunResult | undefined> => {
    for (const [key, definition] of Object.entries(capability.outputs)) {
      if (key in outputs && outputs[key] !== undefined && typeof outputs[key] === definition.type) continue;
      const extraction = capability.steps.find(step => step.action === "extract" && step.outputKey === key);
      if (!extraction) continue;
      const value = resolveValue(extraction, inputs); const authorization = await authorizeStep(extraction, value); if (authorization) return authorization;
      outputs[key] = await executeOnce(extraction, value); if (definition.sensitive) evidence.addSensitiveValues([outputs[key]]);
      await evidence.event({ type: "output_refreshed_after_intervention", stepId: extraction.id, outputKey: key });
    }
  };

  try {
    steps: for (current of capability.steps) {
      const value = resolveValue(current, inputs);
      const authorization = await authorizeStep(current, value); if (authorization) return authorization;
      if (current.action !== "navigate") {
        const intervention = await detectIntervention(); if (intervention) { const result = await handleIntervention(intervention, current); if (typeof result !== "string") return result; if (result === "verify_then_continue") { await evidence.event({ type: "step_completed_by_human", stepId: current.id }); continue steps; } }
        const recovery = await applyRecoveries(); if (recovery.terminal) return recovery.terminal;
      }
      if (current.action === "extract") {
        try { const terminal = await waitForCompetingState(current); if (terminal) return terminal; }
        catch (error) {
          const handoff = await handleExecutionFailure(current, error);
          if (!handoff) throw error;
          if (typeof handoff !== "string") return handoff;
          const terminal = await waitForCompetingState(current); if (terminal) return terminal;
        }
      }
      await evidence.event({ type: "step_started", stepId: current.id, action: current.action });
      let extracted: string | undefined; let lastError: unknown;
      for (let attempt = 0; attempt <= current.retries; attempt++) {
        try {
          extracted = await executeOnce(current, value);
          lastError = undefined; break;
        } catch (error) { lastError = error; await evidence.event({ type: "step_retry", stepId: current.id, attempt, error: String(error) }); if (["click", "navigate"].includes(current.action)) break; }
      }
      if (lastError) {
        const handoff = await handleExecutionFailure(current, lastError, value);
        if (!handoff) throw lastError;
        if (typeof handoff !== "string") return handoff;
        if (handoff === "retry_step") {
          try {
            extracted = await executeOnce(current, value);
          } catch (retryError) { throw new Error(`Step ${current.id} still failed after human intervention: ${retryError instanceof Error ? retryError.message : String(retryError)}`); }
        }
      }
      if (current.outputKey) { outputs[current.outputKey] = extracted; if (capability.outputs[current.outputKey]?.sensitive) evidence.addSensitiveValues([extracted]); }
      await evidence.event({ type: "step_completed", stepId: current.id });
    }
    try { await verifyFinalState(); }
    catch (error) {
      const verificationStep: Step = { id: "final-verification", action: "assert", assertion: capability.checkpoint, risk: "safe", timeoutMs: capability.checkpoint.timeoutMs, retries: 0 };
      const handoff = await handleExecutionFailure(verificationStep, error);
      if (!handoff) throw error;
      if (typeof handoff !== "string") return handoff;
      const terminal = await refreshInvalidOutputs(); if (terminal) return terminal;
      await verifyFinalState();
    }
    const result: RunResult = { status: "success", runId, outputs, evidencePath: evidence.directory };
    await evidence.result({ ...result, outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, capability.outputs[key]?.sensitive ? "[REDACTED]" : value])) }); return result;
  } catch (error) {
    const observation = await observeForEvidence(); const evidencePath = evidence.path("failure-observation.json"); await writeFile(evidencePath, JSON.stringify(observation, null, 2) + "\n").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const category = error instanceof PolicyViolation ? "policy_denied" : message.startsWith("UNEXPECTED_DIALOG") ? "unexpected_dialog" : message.includes("Ambiguous locator") ? "ambiguous_target" : message.startsWith("CHECKPOINT_FAILED") ? "checkpoint_failed" : message.startsWith("OUTPUT_INVALID") ? "output_invalid" : message.startsWith("TERMINAL_TIMEOUT") ? "timeout" : message.includes("locator") || message.includes("hidden element") ? "target_not_found" : message.includes("Control conflict") ? "control_conflict" : "unexpected_state";
    const expected = category === "timeout" || category === "checkpoint_failed" ? "Configured success, business-outcome, recovery, or intervention state" : undefined;
    const observed = JSON.stringify({ url: observation.url, title: observation.title, visibleText: observation.visibleText, alerts: observation.alerts, controls: observation.controls }).slice(0, 2000);
    const recoverable = ["target_not_found", "ambiguous_target", "unexpected_state", "session_expired"].includes(category);
    const result: RunResult = { status: "failure", runId, error: { category, stepId: current?.id, message, expected, observed, evidencePath, recoverable }, evidencePath: evidence.directory };
    await evidence.event({ type: "run_failed", ...result.error }); await evidence.result(result); return result;
  } finally { if (browser && !options.keepSessionOpen) await browser.close(); }
}
