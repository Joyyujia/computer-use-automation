import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import type { Capability, Step } from "./schema.js";
import type { DiscoveryDecision } from "./discovery-schema.js";
import type { ModelAdapter } from "./model-adapter.js";
import { compileArtifact } from "./artifact-compiler.js";
import { EvidenceWriter } from "./evidence.js";
import { PlaywrightSurface } from "./playwright-surface.js";
import { defaultPolicy, enforcePolicy, type Policy } from "./policy.js";
import { RunStateMachine } from "./run-state.js";

export type DiscoveryResult = { status: "success"; runId: string; artifact: Capability; artifactPath: string; evidencePath: string } | { status: "business_outcome"; runId: string; code: string; message: string; evidencePath: string } | { status: "intervention_required"; runId: string; reason: string; evidencePath: string } | { status: "failure"; runId: string; message: string; evidencePath: string };

function decisionStep(decision: DiscoveryDecision, index: number): Step | undefined {
  const common = { id: `discovery-${index}`, risk: "safe" as const, timeoutMs: 5000, retries: 0 };
  if (decision.kind === "navigate") return { ...common, action: "navigate", value: { source: "literal", value: decision.url } };
  if (decision.kind === "click") return { ...common, action: "click", target: decision.target };
  if (decision.kind === "fill") return { ...common, action: "fill", target: decision.target, value: { source: "input", key: decision.inputKey } };
  if (decision.kind === "extract") return { ...common, action: "extract", target: decision.target, outputKey: decision.outputKey };
}

export async function discover(options: { goal: string; entrypoint: string; inputs: Record<string, unknown>; model: ModelAdapter; policy?: Policy; maxSteps?: number; timeoutMs?: number; headless?: boolean; evidenceRoot?: string; artifactRoot?: string }): Promise<DiscoveryResult> {
  const runId = randomUUID(); const evidence = new EvidenceWriter(runId, options.evidenceRoot); await evidence.init();
  const safeGoal = Object.entries(options.inputs).reduce((goal, [key, value]) => typeof value === "string" && value ? goal.replaceAll(value, `[INPUT:${key}]`) : goal, options.goal);
  await evidence.ensure("observations"); await evidence.ensure("screenshots"); await evidence.ensure("model");
  await evidence.manifest({ runId, mode: "discovery", goal: safeGoal, model: options.model.name, policy: options.policy ?? defaultPolicy, startedAt: new Date().toISOString() });
  const state = new RunStateMachine(); state.transition("starting");
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext(); const page = await context.newPage(); const surface = new PlaywrightSurface(page);
  const decisions: DiscoveryDecision[] = []; const history: Array<{ decision: DiscoveryDecision; outcome: string }> = [];
  const deadline = Date.now() + (options.timeoutMs ?? 60_000); let checkpoint: Capability["checkpoint"] | undefined;
  try {
    state.transition("automation_in_control");
    for (let index = 1; index <= (options.maxSteps ?? 12); index++) {
      if (Date.now() > deadline) throw new Error("Discovery timeout exceeded");
      const screenshotPath = evidence.path("screenshots", `${String(index).padStart(3, "0")}.png`);
      const observation = await surface.observe(screenshotPath);
      await writeFile(evidence.path("observations", `${String(index).padStart(3, "0")}.json`), JSON.stringify(observation, null, 2));
      const answer = await options.model.decide({ goal: safeGoal, inputs: Object.fromEntries(Object.keys(options.inputs).map(key => [key, "[SUPPLIED]" ])), observation, history, remainingSteps: (options.maxSteps ?? 12) - index });
      const decision = answer.decision; decisions.push(decision);
      await evidence.event({ type: "model_decision", index, decision, usage: answer.usage });
      if (decision.kind === "complete") { checkpoint = decision.checkpoint; break; }
      if (decision.kind === "business_outcome") { state.transition("business_outcome"); const result = { status: "business_outcome" as const, runId, code: decision.code, message: decision.message, evidencePath: evidence.directory }; await evidence.result(result); return result; }
      if (decision.kind === "request_human") { state.transition("waiting_for_human"); const result = { status: "intervention_required" as const, runId, reason: decision.reason, evidencePath: evidence.directory }; await evidence.result(result); return result; }
      const step = decisionStep(decision, index)!; enforcePolicy(step, options.policy ?? defaultPolicy);
      const value = decision.kind === "fill" ? String(options.inputs[decision.inputKey] ?? "") : decision.kind === "navigate" ? decision.url : undefined;
      const output = await surface.execute(step, value); history.push({ decision, outcome: output === undefined ? "completed" : "[EXTRACTED]" });
    }
    if (!checkpoint) throw new Error("Model did not complete within the step limit");
    if (!await surface.matches(checkpoint, options.inputs)) throw new Error("Discovery checkpoint was not satisfied");
    const artifact = compileArtifact({ goal: safeGoal, entrypoint: options.entrypoint, runId, model: options.model.name, decisions, inputKeys: Object.keys(options.inputs), checkpoint });
    const artifactRoot = path.resolve(options.artifactRoot ?? "artifacts/generated"); await mkdir(artifactRoot, { recursive: true });
    const artifactPath = path.join(artifactRoot, `${artifact.id}.${runId}.json`); await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
    state.transition("succeeded"); const result = { status: "success" as const, runId, artifact, artifactPath, evidencePath: evidence.directory }; await evidence.result(result); return result;
  } catch (error) {
    if (!["failed", "succeeded", "business_outcome"].includes(state.state)) state.transition("failed");
    const result = { status: "failure" as const, runId, message: error instanceof Error ? error.message : String(error), evidencePath: evidence.directory };
    await page.screenshot({ path: evidence.path("screenshots", "failure.png"), fullPage: true }).catch(() => undefined); await evidence.result(result); return result;
  } finally { await browser.close(); }
}
