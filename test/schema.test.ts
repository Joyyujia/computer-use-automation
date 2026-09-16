import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { capabilitySchema } from "../src/core/schema.js";
import { defaultPolicy, enforcePolicy, PolicyViolation } from "../src/core/policy.js";
import { redact } from "../src/core/redact.js";

describe("capability contract", () => {
  it("validates the example artifact", () => {
    const raw = JSON.parse(readFileSync("artifacts/lookup-balance.v1.json", "utf8"));
    expect(capabilitySchema.parse(raw).steps).toHaveLength(4);
  });
  it("blocks navigation outside the origin allowlist", () => {
    expect(() => enforcePolicy({ id: "x", action: "navigate", target: undefined, value: { source: "literal", value: "https://example.com" }, risk: "safe", timeoutMs: 10, retries: 0 }, defaultPolicy)).toThrow(PolicyViolation);
  });
  it("redacts secrets and regulated identifiers recursively", () => {
    expect(redact({ token: "abc", nested: { ssn: "000-00-0000", okay: "yes" } })).toEqual({ token: "[REDACTED]", nested: { ssn: "[REDACTED]", okay: "yes" } });
  });
  it("redacts configured runtime values inside otherwise safe fields", () => {
    expect(redact({ rationale: "member CANARY-123 failed", url: "http://local/?id=CANARY-123" }, "", ["CANARY-123"])).toEqual({ rationale: "member [REDACTED] failed", url: "http://local/?id=[REDACTED]" });
  });
});
