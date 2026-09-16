import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discover } from "../src/core/discovery.js";
import { ScriptedModelAdapter } from "../src/core/model-adapter.js";
import { replay } from "../src/core/replay.js";
import type { Policy } from "../src/core/policy.js";
import { SessionRegistry } from "../src/core/session-registry.js";
import { HandoffCoordinator } from "../src/core/handoff.js";
import { createOperatorServer } from "../src/core/operator-server.js";
import { RunOrchestrator } from "../src/core/run-orchestrator.js";
import { PlaywrightSurface } from "../src/core/playwright-surface.js";
import artifactFixture from "../artifacts/lookup-balance.v1.json" with { type: "json" };

let server: Server; let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.static("public")); server = createServer(app);
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port"); origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => server.close());
const policy = (): Policy => ({ allowedOrigins: [origin], allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"], irreversible: "confirm" });

describe("vertical slice", () => {
  it("discovers a flow and compiles a draft artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cua-discovery-"));
    const locator = (strategy: "label" | "role" | "css" | "text", value: string, name?: string) => ({ strategy, value, name, fallback: [], rationale: "Stable fixture locator" });
    const model = new ScriptedModelAdapter([
      { kind: "navigate", url: origin, rationale: "Open target" },
      { kind: "fill", target: locator("label", "Member Number"), inputKey: "memberId", rationale: "Supply member" },
      { kind: "click", target: locator("role", "button", "Find Member"), rationale: "Submit lookup" },
      { kind: "extract", target: locator("css", "#balance"), outputKey: "balance", rationale: "Read balance" },
      { kind: "complete", checkpoint: { kind: "visible", locator: locator("text", "Member Detail"), timeoutMs: 5000 }, businessOutcomes: [], rationale: "Goal met" }
    ]);
    const result = await discover({ goal: "Look up member 12345 savings balance", entrypoint: origin, inputs: { memberId: "12345" }, model, policy: policy(), evidenceRoot: path.join(root, "evidence"), artifactRoot: path.join(root, "artifacts") });
    expect(result.status).toBe("success"); if (result.status === "success") {
      expect(result.artifact.approval).toBe("draft"); expect(result.artifact.provenance?.createdFromLiveRun).toBe(false); expect(result.artifact.steps).toHaveLength(4);
      expect(result.artifact.description).toContain("[INPUT:memberId]"); expect(result.artifact.description).not.toContain("12345");
      expect(result.artifact.businessOutcomes.map(outcome => outcome.code)).toContain("member_not_found");
      expect(result.artifact.recoveries.map(recovery => recovery.id)).toContain("dismiss-service-notice");
      expect(result.artifact.interventions.map(intervention => intervention.code)).toContain("session_expired");
      expect(await readFile(path.join(result.evidencePath, "manifest.json"), "utf8")).not.toContain("12345");
      const observations = await readFile(path.join(result.evidencePath, "observations", "003.json"), "utf8"); expect(observations).toContain("[PRESENT]"); expect(observations).not.toContain('"value": "12345"');
      expect(JSON.stringify(model.contexts)).not.toContain("12345"); expect(JSON.stringify(model.contexts)).not.toContain("$2,418.73");
      const observationFiles = await readdir(path.join(result.evidencePath, "observations"));
      const persisted = [await readFile(result.artifactPath, "utf8"), await readFile(path.join(result.evidencePath, "manifest.json"), "utf8"), await readFile(path.join(result.evidencePath, "events.jsonl"), "utf8"), await readFile(path.join(result.evidencePath, "result.json"), "utf8"), ...await Promise.all(observationFiles.map(file => readFile(path.join(result.evidencePath, "observations", file), "utf8")))].join("\n");
      expect(persisted).not.toContain("12345"); expect(persisted).not.toContain("$2,418.73");
      const replayed = await replay(result.artifact, { memberId: "67890" }, { policy: policy(), evidenceRoot: path.join(root, "replay") });
      expect(replayed.status).toBe("success");
      if (replayed.status === "success") expect(replayed.outputs.balance).toBe("$987.65");
    }
  }, 20_000);

  it("returns explicit discovery business outcomes and interventions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cua-terminal-"));
    const business = await discover({ goal: "find missing", entrypoint: origin, inputs: {}, model: new ScriptedModelAdapter([{ kind: "business_outcome", code: "not_found", message: "Missing", assertion: { kind: "url", expected: { source: "literal", value: "about:blank" }, timeoutMs: 100 }, rationale: "observed" }]), policy: policy(), evidenceRoot: path.join(root, "business") });
    expect(business.status).toBe("business_outcome");
    const intervention = await discover({ goal: "handle challenge", entrypoint: origin, inputs: {}, model: new ScriptedModelAdapter([{ kind: "request_human", reason: "challenge", rationale: "unsafe" }]), policy: policy(), evidenceRoot: path.join(root, "human") });
    expect(intervention.status).toBe("intervention_required");
  }, 20_000);

  it("fails discovery on step exhaustion and unsatisfied checkpoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cua-failure-"));
    const exhausted = await discover({ goal: "never finishes", entrypoint: origin, inputs: {}, model: new ScriptedModelAdapter([{ kind: "navigate", url: origin, rationale: "open" }]), policy: policy(), maxSteps: 1, evidenceRoot: path.join(root, "limit") });
    expect(exhausted.status).toBe("failure"); if (exhausted.status === "failure") expect(exhausted.message).toContain("step limit");
    const missing = { strategy: "css" as const, value: "#missing", fallback: [], rationale: "fixture" };
    const checkpoint = await discover({ goal: "bad checkpoint", entrypoint: origin, inputs: {}, model: new ScriptedModelAdapter([{ kind: "navigate", url: origin, rationale: "open" }, { kind: "complete", checkpoint: { kind: "visible", locator: missing, timeoutMs: 100 }, businessOutcomes: [], rationale: "incorrect" }]), policy: policy(), evidenceRoot: path.join(root, "checkpoint") });
    expect(checkpoint.status).toBe("failure"); if (checkpoint.status === "failure") expect(checkpoint.message).toContain("success contract");
  }, 20_000);

  it("bounds invalid, slow, and no-progress model behavior", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cua-model-failures-"));
    const invalid = await discover({ goal: "invalid model", entrypoint: origin, inputs: {}, model: { name: "invalid", decide: async () => { throw new Error("Invalid structured model output"); } }, policy: policy(), evidenceRoot: path.join(root, "invalid") });
    expect(invalid.status).toBe("failure"); if (invalid.status === "failure") expect(invalid.message).toContain("Invalid structured model output");
    const slow = await discover({ goal: "slow model", entrypoint: origin, inputs: {}, model: { name: "slow", decide: async () => new Promise<never>(() => undefined) }, policy: policy(), modelTimeoutMs: 25, evidenceRoot: path.join(root, "slow") });
    expect(slow.status).toBe("failure"); if (slow.status === "failure") expect(slow.message).toContain("timed out");
    const repeated = await discover({ goal: "stuck model", entrypoint: origin, inputs: {}, model: new ScriptedModelAdapter([
      { kind: "navigate", url: origin, rationale: "open" }, { kind: "navigate", url: origin, rationale: "repeat" }, { kind: "navigate", url: origin, rationale: "repeat" }
    ]), policy: policy(), maxSteps: 4, evidenceRoot: path.join(root, "repeated") });
    expect(repeated.status).toBe("intervention_required"); if (repeated.status === "intervention_required") expect(repeated.reason).toContain("without observable progress");
  }, 20_000);

  it("validates declared discovery inputs before launching the model or browser", async () => {
    let calls = 0;
    const result = await discover({ goal: "typed input", entrypoint: origin, inputDefinitions: { count: { type: "number", description: "Requested count", sensitive: false } }, inputs: { count: "wrong" }, model: { name: "must-not-run", decide: async () => { calls += 1; throw new Error("should not run"); } }, policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "cua-input-validation-")) });
    expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.message).toContain("must be number"); expect(calls).toBe(0);
  });

  it("replays success and distinguishes not-found as a business outcome", async () => {
    const artifact = structuredClone(artifactFixture); artifact.surface.entrypoint = origin; artifact.steps[0].value = { source: "literal", value: origin };
    const root = await mkdtemp(path.join(tmpdir(), "cua-replay-"));
    const success = await replay(artifact, { memberId: "12345" }, { policy: policy(), evidenceRoot: root });
    expect(success.status).toBe("success");
    if (success.status === "success") expect(await readFile(path.join(success.evidencePath, "result.json"), "utf8")).not.toContain("$2,418.73");
    const missing = await replay(artifact, { memberId: "99999" }, { policy: policy(), evidenceRoot: root });
    expect(missing.status).toBe("business_outcome"); if (missing.status === "business_outcome") expect(missing.code).toBe("member_not_found");
  }, 20_000);

  it("hands the same live session to a human and back", async () => {
    const registry = new SessionRegistry(); const handoffs = new HandoffCoordinator();
    const session = await registry.create(); await session.page.goto(origin); await session.page.getByLabel("Member Number").focus();
    const intervention = handoffs.request({ runId: "run-handoff", sessionId: session.id, stepId: "enter-member", reason: "Manual verification" });
    const operator = await createOperatorServer(registry, handoffs, 0); const address = operator.address(); if (!address || typeof address === "string") throw new Error("No operator port");
    const endpoint = `http://127.0.0.1:${address.port}/api/intervention/${intervention.id}`;
    try {
      expect((await fetch(`${endpoint}/take`, { method: "POST" }).then(r => r.json())).owner).toBe("human");
      await fetch(`${endpoint}/type`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "12345" }) });
      expect(await session.page.getByLabel("Member Number").inputValue()).toBe("12345");
      expect((await fetch(`${endpoint}/resume`, { method: "POST" }).then(r => r.json())).owner).toBe("automation");
      expect(session.owner).toBe("automation"); expect(handoffs.get(intervention.id).humanActions).toHaveLength(1);
    } finally { operator.close(); await registry.close(session.id); }
  }, 20_000);

  it("pauses replay for session expiry and resumes the same session through operator endpoints", async () => {
    const registry = new SessionRegistry();
    const handoffs = new HandoffCoordinator();
    const orchestrator = new RunOrchestrator(registry, handoffs);
    const session = await registry.create();
    const operator = await createOperatorServer(registry, handoffs, 0);
    const address = operator.address();
    if (!address || typeof address === "string") throw new Error("No operator port");
    const artifact = structuredClone(artifactFixture);
    const target = `${origin}/?expired=1`;
    artifact.surface.entrypoint = target;
    artifact.steps[0].value = { source: "literal", value: target };
    const guard = () => session.owner === "automation";
    const replayPromise = replay(artifact, { memberId: "12345" }, {
      page: session.page,
      policy: policy(),
      evidenceRoot: await mkdtemp(path.join(tmpdir(), "cua-expired-")),
      canAutomationAct: guard,
      onIntervention: orchestrator.interventionHandler(session)
    });
    try {
      const deadline = Date.now() + 5000;
      while (handoffs.list().length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const intervention = handoffs.list()[0];
      expect(intervention).toBeDefined();
      const endpoint = `http://127.0.0.1:${address.port}/api/intervention/${intervention.id}`;
      expect((await fetch(`${endpoint}/take`, { method: "POST" }).then(response => response.json())).owner).toBe("human");
      await expect(new PlaywrightSurface(session.page, guard).execute({ id: "blocked", action: "click", target: { strategy: "css", value: "#restore-session", fallback: [], rationale: "test exclusive ownership" }, risk: "safe", timeoutMs: 1000, retries: 0 })).rejects.toThrow(/Control conflict/);
      const box = await session.page.locator("#restore-session").boundingBox();
      if (!box) throw new Error("Restore control has no bounding box");
      const clickResponse = await fetch(`${endpoint}/click`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) });
      expect(clickResponse.ok).toBe(true);
      expect((await fetch(`${endpoint}/resume`, { method: "POST" }).then(response => response.json())).owner).toBe("automation");
      const result = await replayPromise;
      expect(result.status).toBe("success");
      if (result.status === "success") expect(result.outputs.balance).toBe("$2,418.73");
      expect(handoffs.get(intervention.id).humanActions[0]?.description).toMatch(/^Clicked/);
      expect(handoffs.get(intervention.id).runId).toBe(result.runId);
    } finally {
      operator.close();
      await registry.close(session.id);
    }
  }, 20_000);
});
