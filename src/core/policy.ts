import type { Step } from "./schema.js";
import type { Page } from "@playwright/test";

export type Policy = {
  allowedOrigins: string[];
  allowedActions: Step["action"][];
  irreversible: "block" | "confirm";
  allowedPathPatterns?: RegExp[];
  riskyTargetPatterns?: RegExp[];
};

export const defaultPolicy: Policy = {
  allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
  allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"],
  irreversible: "confirm",
  allowedPathPatterns: [/^\/$/],
  riskyTargetPatterns: [/confirm/i, /delete/i, /submit[-_ ]?transfer/i]
};

export class PolicyViolation extends Error {}

export function enforceUrl(rawUrl: string, policy: Policy): void {
  const url = new URL(rawUrl);
  if (!policy.allowedOrigins.includes(url.origin)) throw new PolicyViolation(`Origin ${url.origin} is not allowlisted`);
  if (policy.allowedPathPatterns && !policy.allowedPathPatterns.some(pattern => pattern.test(url.pathname))) throw new PolicyViolation(`Route ${url.pathname} is not allowlisted`);
}

export async function enforceBrowserState(page: Page, policy: Policy): Promise<void> {
  const unexpectedPages = page.context().pages().filter(candidate => candidate !== page);
  if (unexpectedPages.length > 0) {
    await Promise.all(unexpectedPages.map(candidate => candidate.close().catch(() => undefined)));
    throw new PolicyViolation("Unexpected popup was blocked by policy");
  }
  enforceUrl(page.url(), policy);
}

export function enforcePolicy(step: Step, policy: Policy, confirmed = false): void {
  if (!policy.allowedActions.includes(step.action)) {
    throw new PolicyViolation(`Action ${step.action} is not allowlisted`);
  }
  if (step.action === "navigate" && step.value?.source === "literal") {
    enforceUrl(step.value.value, policy);
  }
  const target = step.target;
  const inferredRisky = target ? target.strategy === "coordinates" || policy.riskyTargetPatterns?.some(pattern => pattern.test(`${target.value} ${target.name ?? ""}`)) : false;
  const irreversible = step.risk === "irreversible" || inferredRisky;
  if (irreversible && policy.irreversible === "block") {
    throw new PolicyViolation("Irreversible actions are blocked by policy");
  }
  if (irreversible && policy.irreversible === "confirm" && !confirmed) {
    throw new PolicyViolation("Irreversible action requires explicit confirmation");
  }
}
