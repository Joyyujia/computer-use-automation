import type { Locator, Step } from "./schema.js";
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
  if (policy.allowedPathPatterns && !policy.allowedPathPatterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(url.pathname); })) throw new PolicyViolation(`Route ${url.pathname} is not allowlisted`);
}

export async function enforceBrowserState(page: Page, policy: Policy, options: { allowInitialBlank?: boolean } = {}): Promise<void> {
  const unexpectedPages = page.context().pages().filter(candidate => candidate !== page);
  if (unexpectedPages.length > 0) {
    await Promise.all(unexpectedPages.map(candidate => candidate.close().catch(() => undefined)));
    throw new PolicyViolation("Unexpected popup was blocked by policy");
  }
  const mainFrame = page.mainFrame();
  for (const frame of page.frames()) {
    const frameUrl = frame.url();
    if (frameUrl === "about:blank") {
      if (frame === mainFrame && !options.allowInitialBlank) throw new PolicyViolation("The current page has no allowlisted origin");
      continue;
    }
    enforceUrl(frameUrl, policy);
  }
}

const locatorTree = (locator: Locator): Locator[] => [locator, ...locator.fallback.flatMap(locatorTree)];

function matchesRiskPattern(locator: Locator, patterns: RegExp[] = []): boolean {
  const description = `${locator.value} ${locator.name ?? ""} ${locator.logicalTarget ?? ""}`;
  return patterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(description); });
}

export function enforcePolicy(step: Step, policy: Policy, confirmed = false, resolvedValue?: string): void {
  if (!policy.allowedActions.includes(step.action)) {
    throw new PolicyViolation(`Action ${step.action} is not allowlisted`);
  }
  if (step.action === "navigate") {
    const navigationUrl = resolvedValue ?? (step.value?.source === "literal" ? step.value.value : undefined);
    if (!navigationUrl) throw new PolicyViolation("Navigation URL could not be resolved for policy enforcement");
    enforceUrl(navigationUrl, policy);
  }
  const targets = step.target ? locatorTree(step.target) : [];
  const inferredRisky = targets.some(target => target.strategy === "coordinates" || matchesRiskPattern(target, policy.riskyTargetPatterns));
  const irreversible = step.risk === "irreversible" || inferredRisky;
  if (irreversible && policy.irreversible === "block") {
    throw new PolicyViolation("Irreversible actions are blocked by policy");
  }
  if (irreversible && policy.irreversible === "confirm" && !confirmed) {
    throw new PolicyViolation("Irreversible action requires explicit confirmation");
  }
}
