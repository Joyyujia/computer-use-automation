import { describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { enforceBrowserState, enforcePolicy, PolicyViolation, type Policy } from "../src/core/policy.js";
import type { Step } from "../src/core/schema.js";

const policy: Policy = { allowedOrigins: ["https://allowed.example"], allowedActions: ["navigate", "click"], irreversible: "confirm" };
const step = (overrides: Partial<Step> = {}): Step => ({ id: "x", action: "click", target: { strategy: "text", value: "Go", fallback: [], rationale: "label" }, risk: "safe", timeoutMs: 100, retries: 0, ...overrides });

describe("policy enforcement", () => {
  it("allows an allowlisted safe action", () => expect(() => enforcePolicy(step(), policy)).not.toThrow());
  it("denies an action type not in the allowlist", () => expect(() => enforcePolicy(step({ action: "extract" }), policy)).toThrow(PolicyViolation));
  it("denies a navigation origin not in the allowlist", () => expect(() => enforcePolicy(step({ action: "navigate", value: { source: "literal", value: "https://evil.example/path" } }), policy)).toThrow(/Origin/));
  it("allows paths on the exact allowlisted origin", () => expect(() => enforcePolicy(step({ action: "navigate", value: { source: "literal", value: "https://allowed.example/path" } }), policy)).not.toThrow());
  it("requires confirmation for irreversible steps", () => expect(() => enforcePolicy(step({ risk: "irreversible" }), policy)).toThrow(/confirmation/));
  it("accepts a confirmed irreversible step", () => expect(() => enforcePolicy(step({ risk: "irreversible" }), policy, true)).not.toThrow());
  it("always blocks irreversible steps under block mode", () => expect(() => enforcePolicy(step({ risk: "irreversible" }), { ...policy, irreversible: "block" }, true)).toThrow(/blocked/));
  it("does not trust a safe label on a target matched by trusted risk rules", () => {
    const risky = step({ target: { strategy: "text", value: "Confirm transfer", fallback: [], rationale: "model called this safe" }, risk: "safe" });
    expect(() => enforcePolicy(risky, { ...policy, irreversible: "block", riskyTargetPatterns: [/confirm transfer/i] })).toThrow(/blocked/);
  });
  it("does not allow a risky fallback to hide behind a safe primary locator", () => {
    const riskyFallback = step({ target: { strategy: "text", value: "Continue", logicalTarget: "submit", fallback: [{ strategy: "text", value: "Confirm transfer", logicalTarget: "submit", fallback: [], rationale: "fallback" }], rationale: "primary" } });
    expect(() => enforcePolicy(riskyFallback, { ...policy, irreversible: "block", riskyTargetPatterns: [/confirm transfer/i] })).toThrow(/blocked/);
  });
  it("enforces policy against a resolved input-sourced navigation URL", () => {
    const navigation = step({ action: "navigate", value: { source: "input", key: "destination" }, target: undefined });
    expect(() => enforcePolicy(navigation, policy, false, "https://evil.example/path")).toThrow(/Origin/);
  });
  it("treats coordinate actions as risky even when the artifact calls them safe", () => {
    const coordinate = step({ target: { strategy: "coordinates", value: "10,10", fallback: [], rationale: "last resort" }, risk: "safe" });
    expect(() => enforcePolicy(coordinate, policy)).toThrow(/confirmation/);
  });

  it("checks the current page and every child-frame origin", async () => {
    const pageFor = (mainUrl: string, childUrls: string[] = []) => {
      const main = { url: () => mainUrl };
      const page = { context: () => ({ pages: () => [page] }), mainFrame: () => main, frames: () => [main, ...childUrls.map(url => ({ url: () => url }))] };
      return page as unknown as Page;
    };
    await expect(enforceBrowserState(pageFor("https://forbidden.example"), policy)).rejects.toThrow(/Origin/);
    await expect(enforceBrowserState(pageFor("https://allowed.example", ["https://forbidden.example/frame"]), policy)).rejects.toThrow(/Origin/);
    await expect(enforceBrowserState(pageFor("about:blank"), policy, { allowInitialBlank: true })).resolves.toBeUndefined();
    await expect(enforceBrowserState(pageFor("about:blank"), policy)).rejects.toThrow(/no allowlisted origin/);
  });
});
