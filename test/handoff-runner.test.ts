import { describe, expect, it } from "vitest";
import { HandoffCoordinator } from "../src/core/handoff.js";
import { requestAndWaitForHuman } from "../src/core/handoff-runner.js";
import { RunOrchestrator } from "../src/core/run-orchestrator.js";
import type { SessionRegistry, LiveSession } from "../src/core/session-registry.js";
import type { EvidenceWriter } from "../src/core/evidence.js";

describe("handoff waiting and orchestration", () => {
  it("waits until an operator returns control", async () => {
    const handoffs = new HandoffCoordinator();
    setTimeout(() => { const item = handoffs.list()[0]; handoffs.takeControl(item.id); handoffs.record(item.id, "resolved dialog"); handoffs.resume(item.id); }, 20);
    const result = await requestAndWaitForHuman({ registry: {} as SessionRegistry, handoffs, sessionId: "session", reason: "blocked", timeoutMs: 1000 });
    expect(result.state).toBe("resumed"); expect(result.humanActions[0].description).toBe("resolved dialog");
  });

  it("times out if nobody accepts the intervention", async () => {
    await expect(requestAndWaitForHuman({ registry: {} as SessionRegistry, handoffs: new HandoffCoordinator(), sessionId: "session", reason: "blocked", timeoutMs: 1 })).rejects.toThrow(/timed out/);
  });

  it("stops when the operator explicitly aborts", async () => {
    const handoffs = new HandoffCoordinator();
    setTimeout(() => handoffs.abort(handoffs.list()[0].id), 20);
    await expect(requestAndWaitForHuman({ registry: {} as SessionRegistry, handoffs, sessionId: "session", reason: "blocked", timeoutMs: 1000 })).rejects.toThrow(/aborted/);
  });

  it("builds a replay intervention handler bound to the session", async () => {
    const handoffs = new HandoffCoordinator(); const orchestrator = new RunOrchestrator({} as SessionRegistry, handoffs); const session = { id: "session-1" } as LiveSession;
    setTimeout(() => { const item = handoffs.list()[0]; handoffs.takeControl(item.id); handoffs.resume(item.id); }, 20);
    const handler = orchestrator.interventionHandler(session); const result = await handler({ runId: "run", step: { id: "confirm", action: "click", target: { strategy: "text", value: "Confirm", fallback: [], rationale: "visible" }, risk: "irreversible", timeoutMs: 100, retries: 0 }, reason: "approval", evidence: undefined as unknown as EvidenceWriter });
    expect(result.interventionId).toBe(handoffs.list()[0].id); expect(handoffs.list()[0].sessionId).toBe("session-1");
  });
});
