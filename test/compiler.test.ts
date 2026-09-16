import { describe, expect, it } from "vitest";
import { compileArtifact } from "../src/core/artifact-compiler.js";
import type { DiscoveryDecision } from "../src/core/discovery-schema.js";

const locator = { strategy: "css" as const, value: "#x", fallback: [], rationale: "fixture" };
const checkpoint = { kind: "visible" as const, locator, timeoutMs: 5000 };

describe("artifact compiler", () => {
  it("parameterizes inputs, declares outputs, and preserves outcomes", () => {
    const decisions: DiscoveryDecision[] = [
      { kind: "navigate", url: "http://127.0.0.1:4173", rationale: "open" },
      { kind: "fill", target: locator, inputKey: "memberId", rationale: "fill" },
      { kind: "extract", target: locator, outputKey: "balance", rationale: "read" },
      { kind: "complete", checkpoint, businessOutcomes: [{ code: "not_found", message: "Missing", assertion: checkpoint }], rationale: "done" }
    ];
    const artifact = compileArtifact({ goal: "lookup", entrypoint: "http://127.0.0.1:4173", runId: "run-1", model: "live-model", decisions, inputKeys: ["memberId"], checkpoint, createdFromLiveRun: true, modelResponseIds: ["resp_123"] });
    expect(artifact.steps).toHaveLength(3); expect(artifact.steps[1].value).toEqual({ source: "input", key: "memberId" });
    expect(artifact.outputs.balance.sensitive).toBe(true); expect(artifact.businessOutcomes[0].code).toBe("member_not_found"); expect(artifact.provenance?.createdFromLiveRun).toBe(true); expect(artifact.provenance?.modelResponseIds).toEqual(["resp_123"]);
  });

  it("marks scripted fixture provenance as non-live", () => {
    const artifact = compileArtifact({ goal: "test", entrypoint: "http://127.0.0.1:4173", runId: "run-2", model: "scripted-test-fixture", decisions: [{ kind: "navigate", url: "http://127.0.0.1:4173", rationale: "open" }], inputKeys: ["memberId"], checkpoint });
    expect(artifact.provenance?.createdFromLiveRun).toBe(false); expect(artifact.approval).toBe("draft");
  });

  it("rejects known runtime secrets before an artifact can be persisted", () => {
    expect(() => compileArtifact({ goal: "lookup CANARY-SECRET", entrypoint: "http://127.0.0.1:4173", runId: "run-3", model: "live-model", decisions: [{ kind: "navigate", url: "http://127.0.0.1:4173", rationale: "open" }], inputKeys: ["memberId"], checkpoint, sensitiveValues: ["CANARY-SECRET"] })).toThrow(/sensitive runtime value/);
  });

  it("rejects URL state and commonly sensitive text at the artifact boundary", () => {
    expect(() => compileArtifact({ goal: "lookup", entrypoint: "http://127.0.0.1:4173/?token=secret", runId: "run-4", model: "live-model", decisions: [], inputKeys: [], checkpoint })).toThrow(/non-persistable/);
    expect(() => compileArtifact({ goal: "Email person@example.com", entrypoint: "http://127.0.0.1:4173", runId: "run-5", model: "live-model", decisions: [{ kind: "navigate", url: "http://127.0.0.1:4173", rationale: "open" }], inputKeys: ["memberId"], checkpoint })).toThrow(/redaction policy/);
  });
});
