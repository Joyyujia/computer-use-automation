import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";
import { capabilitySchema, type RunResult, type Step } from "./schema.js";
import { defaultPolicy, enforcePolicy, PolicyViolation, type Policy } from "./policy.js";
import { EvidenceWriter } from "./evidence.js";
import { PlaywrightSurface } from "./playwright-surface.js";

const resolveValue = (step: Step, inputs: Record<string, unknown>) => {
  if (!step.value) return undefined;
  return step.value.source === "literal" ? step.value.value : String(inputs[step.value.key] ?? "");
};

export async function replay(raw: unknown, inputs: Record<string, unknown>, options: {
  policy?: Policy; headless?: boolean; confirmedStepIds?: string[]; evidenceRoot?: string;
} = {}): Promise<RunResult> {
  const capability = capabilitySchema.parse(raw);
  for (const key of Object.keys(capability.inputs)) if (!(key in inputs)) throw new Error(`Missing input: ${key}`);
  const runId = randomUUID();
  const evidence = new EvidenceWriter(runId, options.evidenceRoot);
  await evidence.init();
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const surface = new PlaywrightSurface(page);
  const outputs: Record<string, unknown> = {};
  let current: Step | undefined;
  try {
    for (current of capability.steps) {
      enforcePolicy(current, options.policy ?? defaultPolicy, options.confirmedStepIds?.includes(current.id));
      await evidence.event({ type: "step_started", stepId: current.id, action: current.action });
      const value = resolveValue(current, inputs);
      let extracted: string | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= current.retries; attempt++) {
        try { extracted = await surface.execute(current, value); lastError = undefined; break; }
        catch (error) { lastError = error; await evidence.event({ type: "step_retry", stepId: current.id, attempt, error: String(error) }); }
      }
      if (lastError) throw lastError;
      if (current.outputKey) outputs[current.outputKey] = extracted;
      await evidence.event({ type: "step_completed", stepId: current.id });
    }
    const checkpoint = capability.checkpoint;
    const expected = checkpoint.expected.source === "literal" ? checkpoint.expected.value : String(inputs[checkpoint.expected.key]);
    if (checkpoint.kind === "url") await page.waitForURL(expected, { timeout: checkpoint.timeoutMs });
    else if (checkpoint.locator) {
      const target = await surface.resolve(checkpoint.locator);
      if (checkpoint.kind === "visible") await target.waitFor({ state: "visible", timeout: checkpoint.timeoutMs });
      else await target.getByText(expected, { exact: false }).waitFor({ timeout: checkpoint.timeoutMs });
    }
    const result: RunResult = { status: "success", runId, outputs };
    await evidence.result(result);
    return result;
  } catch (error) {
    const screenshot = path.join(evidence.directory, "failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const result: RunResult = { status: "failure", runId, error: {
      category: error instanceof PolicyViolation ? "policy" : message.includes("Timeout") ? "timeout" : message.includes("locator") ? "target_not_found" : "unexpected_state",
      stepId: current?.id, message, evidencePath: screenshot, recoverable: false
    }};
    await evidence.event({ type: "run_failed", ...result.error });
    await evidence.result(result);
    return result;
  } finally { await browser.close(); }
}
