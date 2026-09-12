import type { Step } from "./schema.js";

export type Policy = {
  allowedOrigins: string[];
  allowedActions: Step["action"][];
  irreversible: "block" | "confirm";
};

export const defaultPolicy: Policy = {
  allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
  allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"],
  irreversible: "confirm"
};

export class PolicyViolation extends Error {}

export function enforcePolicy(step: Step, policy: Policy, confirmed = false): void {
  if (!policy.allowedActions.includes(step.action)) {
    throw new PolicyViolation(`Action ${step.action} is not allowlisted`);
  }
  if (step.action === "navigate" && step.value?.source === "literal") {
    const origin = new URL(step.value.value).origin;
    if (!policy.allowedOrigins.includes(origin)) throw new PolicyViolation(`Origin ${origin} is not allowlisted`);
  }
  if (step.risk === "irreversible" && policy.irreversible === "block") {
    throw new PolicyViolation("Irreversible actions are blocked by policy");
  }
  if (step.risk === "irreversible" && policy.irreversible === "confirm" && !confirmed) {
    throw new PolicyViolation("Irreversible action requires explicit confirmation");
  }
}
