import { describe, expect, it } from "vitest";
import { capabilitySchema, stepSchema, assertionSchema } from "../src/core/schema.js";
import { discoveryDecisionSchema } from "../src/core/discovery-schema.js";
import { observationSchema } from "../src/core/observation.js";

const locator = { strategy: "text" as const, value: "Target", fallback: [], rationale: "stable text" };
const base = (): any => ({
  schemaVersion: "1.0", id: "test.capability", version: "1.2.3", name: "Test", description: "Test capability",
  surface: { adapter: "playwright", appFamily: "fixture", entrypoint: "http://127.0.0.1:4173" },
  inputs: { memberId: { type: "string", description: "member", sensitive: true } }, outputs: { balance: { type: "string", description: "balance", sensitive: true } },
  steps: [{ id: "open", action: "navigate", value: { source: "literal", value: "http://127.0.0.1:4173" }, risk: "safe", timeoutMs: 100, retries: 0 }],
  checkpoint: { kind: "url", expected: { source: "literal", value: "http://127.0.0.1:4173" }, timeoutMs: 100 }, approval: "draft", createdAt: new Date().toISOString()
});

describe("domain validation", () => {
  it.each([
    ["click without target", { id: "x", action: "click", risk: "safe" }],
    ["fill without value", { id: "x", action: "fill", target: locator, risk: "safe" }],
    ["navigate without value", { id: "x", action: "navigate", risk: "safe" }],
    ["extract without output", { id: "x", action: "extract", target: locator, risk: "safe" }],
    ["assert without assertion", { id: "x", action: "assert", risk: "safe" }]
  ])("rejects %s", (_name, step) => expect(stepSchema.safeParse(step).success).toBe(false));

  it("requires a locator for visible and text assertions", () => {
    expect(assertionSchema.safeParse({ kind: "visible", expected: { source: "literal", value: "yes" } }).success).toBe(false);
    expect(assertionSchema.safeParse({ kind: "url", expected: { source: "literal", value: "http://x" } }).success).toBe(true);
  });

  it("rejects duplicate step ids", () => {
    const value = base(); value.steps.push(structuredClone(value.steps[0]));
    expect(capabilitySchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown input and output references", () => {
    const unknownInput = base(); unknownInput.steps = [{ id: "fill", action: "fill", target: locator, value: { source: "input", key: "missing" }, risk: "safe", timeoutMs: 100, retries: 0 }];
    expect(capabilitySchema.safeParse(unknownInput).success).toBe(false);
    const unknownOutput = base(); unknownOutput.steps = [{ id: "read", action: "extract", target: locator, outputKey: "missing", risk: "safe", timeoutMs: 100, retries: 0 }];
    expect(capabilitySchema.safeParse(unknownOutput).success).toBe(false);
  });

  it("defaults artifact collections and approval", () => {
    const value = base(); delete (value as Partial<typeof value>).approval;
    const parsed = capabilitySchema.parse(value); expect(parsed.businessOutcomes).toEqual([]); expect(parsed.recoveries).toEqual([]); expect(parsed.approval).toBe("draft");
  });

  it("validates every discovery decision variant", () => {
    expect(discoveryDecisionSchema.parse({ kind: "request_human", reason: "captcha", rationale: "cannot proceed safely" }).kind).toBe("request_human");
    expect(discoveryDecisionSchema.safeParse({ kind: "fill", target: locator, rationale: "missing key" }).success).toBe(false);
  });
  it("validates bounded surface observations", () => {
    const parsed = observationSchema.parse({ url: "about:blank", title: "", visibleText: "Ready", controls: [{ role: "button", name: "Go", tag: "button", disabled: false }], alerts: [] });
    expect(parsed.controls[0].name).toBe("Go"); expect(observationSchema.safeParse({ controls: "invalid" }).success).toBe(false);
  });
});
