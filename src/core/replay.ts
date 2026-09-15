import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { capabilitySchema, type RunResult, type Step } from "./schema.js";
import { defaultPolicy, enforcePolicy, PolicyViolation, type Policy } from "./policy.js";
import { EvidenceWriter } from "./evidence.js";
import { PlaywrightSurface } from "./playwright-surface.js";

const resolveValue = (step: Step, inputs: Record<string, unknown>) => {
  if (!step.value) return undefined;
  return step.value.source === "literal" ? step.value.value : String(inputs[step.value.key] ?? "");
};

export async function replay(raw: unknown, inputs: Record<string, unknown>, options: {
  policy?: Policy; headless?: boolean; confirmedStepIds?: string[]; evidenceRoot?: string; page?: Page; keepSessionOpen?: boolean;
  onIntervention?: (context: { runId: string; step: Step; reason: string; page: Page; evidence: EvidenceWriter }) => Promise<{ interventionId: string }>;
} = {}): Promise<RunResult> {
  const capability = capabilitySchema.parse(raw);
  for (const [key, field] of Object.entries(capability.inputs)) {
    if (!(key in inputs)) throw new Error(`Missing input: ${key}`);
    if (typeof inputs[key] !== field.type) throw new Error(`Input ${key} must be ${field.type}`);
  }
  const runId = randomUUID();
  const evidence = new EvidenceWriter(runId, options.evidenceRoot);
  await evidence.init();
  await evidence.manifest({ runId, mode: "replay", capabilityId: capability.id, capabilityVersion: capability.version, startedAt: new Date().toISOString() });
  const browser = options.page ? undefined : await chromium.launch({ headless: options.headless ?? true });
  const context = browser ? await browser.newContext() : undefined;
  const page = options.page ?? await context!.newPage();
  const surface = new PlaywrightSurface(page);
  const outputs: Record<string, unknown> = {};
  const recoveryAttempts = new Map<string, number>();
  let current: Step | undefined;
  const detectOutcome = async (): Promise<Extract<RunResult, { status: "business_outcome" }> | undefined> => {
    for (const outcome of capability.businessOutcomes) if (await surface.matches(outcome.assertion, inputs)) {
      return { status: "business_outcome", runId, code: outcome.code, message: outcome.message, evidencePath: evidence.directory };
    }
  };
  try {
    for (current of capability.steps) {
      const before = await detectOutcome(); if (before) { await evidence.result(before); return before; }
      for (const recovery of capability.recoveries) {
        if (!await surface.matches(recovery.when, inputs)) continue;
        const attempts = recoveryAttempts.get(recovery.id) ?? 0;
        if (attempts >= recovery.maxAttempts) throw new Error(`Recovery ${recovery.id} exhausted after ${attempts} attempts`);
        recoveryAttempts.set(recovery.id, attempts + 1);
        await evidence.event({ type: "recovery_started", recoveryId: recovery.id });
        for (const recoveryStep of recovery.steps) {
          enforcePolicy(recoveryStep, options.policy ?? defaultPolicy, options.confirmedStepIds?.includes(recoveryStep.id));
          if (recoveryStep.action === "assert" && recoveryStep.assertion) {
            if (!await surface.matches(recoveryStep.assertion, inputs)) throw new Error(`Recovery assertion failed: ${recoveryStep.id}`);
          } else await surface.execute(recoveryStep, resolveValue(recoveryStep, inputs));
        }
        await evidence.event({ type: "recovery_completed", recoveryId: recovery.id });
      }
      try { enforcePolicy(current, options.policy ?? defaultPolicy, options.confirmedStepIds?.includes(current.id)); }
      catch (error) {
        if (!(error instanceof PolicyViolation) || current.risk !== "irreversible") throw error;
        if (!options.onIntervention) {
          const result: RunResult = { status: "intervention_required", runId, interventionId: randomUUID(), reason: error.message, evidencePath: evidence.directory };
          await evidence.result(result); return result;
        }
        const intervention = await options.onIntervention({ runId, step: current, reason: error.message, page, evidence });
        await evidence.event({ type: "intervention_completed", interventionId: intervention.interventionId, stepId: current.id });
        enforcePolicy(current, options.policy ?? defaultPolicy, true);
      }
      await evidence.event({ type: "step_started", stepId: current.id, action: current.action });
      const value = resolveValue(current, inputs);
      let extracted: string | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= current.retries; attempt++) {
        try {
          if (current.action === "assert" && current.assertion) {
            if (!await surface.matches(current.assertion, inputs)) throw new Error(`Assertion failed: ${current.id}`);
          } else extracted = await surface.execute(current, value);
          lastError = undefined; break;
        }
        catch (error) { lastError = error; await evidence.event({ type: "step_retry", stepId: current.id, attempt, error: String(error) }); }
      }
      if (lastError) throw lastError;
      if (current.outputKey) outputs[current.outputKey] = extracted;
      await evidence.event({ type: "step_completed", stepId: current.id });
      const after = await detectOutcome(); if (after) { await evidence.result(after); return after; }
    }
    const checkpoint = capability.checkpoint;
    try {
      const expected = checkpoint.expected.source === "literal" ? checkpoint.expected.value : String(inputs[checkpoint.expected.key]);
      if (checkpoint.kind === "url") await page.waitForURL(expected, { timeout: checkpoint.timeoutMs });
      else if (checkpoint.locator) {
        const target = await surface.resolve(checkpoint.locator);
        if (checkpoint.kind === "visible") await target.waitFor({ state: "visible", timeout: checkpoint.timeoutMs });
        else if (!(await target.textContent())?.includes(expected)) throw new Error(`Expected text ${expected}`);
      }
    } catch (error) { throw new Error(`CHECKPOINT_FAILED: ${error instanceof Error ? error.message : String(error)}`); }
    const result: RunResult = { status: "success", runId, outputs, evidencePath: evidence.directory };
    const persisted = { ...result, outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, capability.outputs[key]?.sensitive ? "[REDACTED]" : value])) };
    await evidence.result(persisted);
    return result;
  } catch (error) {
    const screenshot = path.join(evidence.directory, "failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const result: RunResult = { status: "failure", runId, error: {
      category: error instanceof PolicyViolation ? "policy_denied" : message.startsWith("CHECKPOINT_FAILED") ? "checkpoint_failed" : message.includes("Timeout") ? "timeout" : message.includes("locator") ? "target_not_found" : "unexpected_state",
      stepId: current?.id, message, evidencePath: screenshot, recoverable: false
    }, evidencePath: evidence.directory };
    await evidence.event({ type: "run_failed", ...result.error });
    await evidence.result(result);
    return result;
  } finally { if (browser && !options.keepSessionOpen) await browser.close(); }
}
