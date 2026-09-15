import { describe, expect, it } from "vitest";
import { capabilitySchema } from "../src/core/schema.js";

describe("risk contract", () => {
  it("accepts an irreversible capability only with an explicit risk marker", () => {
    const parsed = capabilitySchema.safeParse({
      schemaVersion: "1.0", id: "test.confirm", version: "1.0.0", name: "Confirm", description: "test",
      surface: { adapter: "playwright", appFamily: "test", entrypoint: "http://127.0.0.1:4173" }, inputs: {}, outputs: {},
      steps: [{ id: "confirm", action: "click", target: { strategy: "text", value: "Confirm", fallback: [], rationale: "visible confirmation" }, risk: "irreversible", timeoutMs: 1000, retries: 0 }],
      checkpoint: { kind: "visible", locator: { strategy: "text", value: "Done", fallback: [], rationale: "completion" }, expected: { source: "literal", value: "Done" }, timeoutMs: 1000 },
      approval: "draft", createdAt: new Date().toISOString()
    });
    expect(parsed.success).toBe(true);
  });
});
