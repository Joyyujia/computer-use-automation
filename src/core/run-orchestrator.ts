import type { Step } from "./schema.js";
import type { EvidenceWriter } from "./evidence.js";
import { HandoffCoordinator } from "./handoff.js";
import { requestAndWaitForHuman } from "./handoff-runner.js";
import { SessionRegistry, type LiveSession } from "./session-registry.js";

export class RunOrchestrator {
  constructor(readonly sessions: SessionRegistry, readonly handoffs: HandoffCoordinator) {}

  interventionHandler(session: LiveSession) {
    return async (context: { runId: string; step: Step; reason: string; capabilityId?: string; goal?: string; sanitizedContext?: Record<string, unknown>; evidence: EvidenceWriter }) => {
      const intervention = await requestAndWaitForHuman({
        runId: context.runId, registry: this.sessions, handoffs: this.handoffs, sessionId: session.id,
        reason: context.reason, stepId: context.step.id, capabilityId: context.capabilityId, goal: context.goal, context: context.sanitizedContext, evidence: context.evidence
      });
      return { interventionId: intervention.id };
    };
  }
}
