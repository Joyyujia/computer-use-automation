import type { Capability } from "./schema.js";

export type CapabilityProfile = {
  id: string;
  name: string;
  appFamily: string;
  outputs: Capability["outputs"];
  checkpoint: Capability["checkpoint"];
  successAssertions: Capability["successAssertions"];
  businessOutcomes: Capability["businessOutcomes"];
  recoveries: Capability["recoveries"];
  interventions: Capability["interventions"];
};

const css = (value: string, rationale: string) => ({ strategy: "css" as const, value, fallback: [], rationale });

export const lookupBalanceProfile: CapabilityProfile = {
  id: "member.lookup-savings-balance",
  name: "Look up savings balance",
  appFamily: "northstar-core",
  outputs: { balance: { type: "string", description: "Display-formatted savings balance", sensitive: true } },
  checkpoint: { kind: "text", locator: css("#detail-member-id", "Selected member identifier on the detail screen"), expected: { source: "input", key: "memberId" }, timeoutMs: 5000 },
  successAssertions: [{ kind: "visible", locator: css("#detail", "Member detail container"), timeoutMs: 5000 }],
  businessOutcomes: [{ code: "member_not_found", message: "No member exists for the supplied identifier", assertion: { kind: "text", locator: css("#message", "Dedicated application alert region"), expected: { source: "literal", value: "Member not found" }, timeoutMs: 5000 } }],
  recoveries: [{ id: "dismiss-service-notice", when: { kind: "visible", locator: css("#service-notice", "Known service notice"), timeoutMs: 1000 }, steps: [{ id: "dismiss-service-notice", action: "click", target: css("#dismiss-notice", "Dismiss control inside known notice"), risk: "safe", timeoutMs: 1000, retries: 0 }], maxAttempts: 1 }],
  interventions: [{ code: "session_expired", message: "The application session expired", assertion: { kind: "visible", locator: css("#session-expired", "Session expiry alert"), timeoutMs: 1000 }, resume: "retry_step" }]
};
