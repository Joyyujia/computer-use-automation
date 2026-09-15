import { randomUUID } from "node:crypto";
import { EvidenceWriter } from "./evidence.js";
import { HandoffCoordinator, type Intervention } from "./handoff.js";
import { SessionRegistry } from "./session-registry.js";

export async function requestAndWaitForHuman(options: { registry: SessionRegistry; handoffs: HandoffCoordinator; sessionId: string; reason: string; stepId?: string; evidence?: EvidenceWriter; timeoutMs?: number }): Promise<Intervention> {
  const runId = randomUUID();
  const request = options.handoffs.request({ runId, sessionId: options.sessionId, stepId: options.stepId, reason: options.reason, evidencePath: options.evidence?.directory });
  await options.evidence?.event({ type: "intervention_requested", interventionId: request.id, stepId: options.stepId, reason: options.reason });
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    const current = options.handoffs.get(request.id);
    if (current.state === "resumed") { await options.evidence?.event({ type: "intervention_resumed", interventionId: request.id, humanActions: current.humanActions }); return current; }
    if (current.state === "aborted") throw new Error("Human aborted the run");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Human intervention timed out");
}
