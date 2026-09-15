import { describe, expect, it } from "vitest";
import { HandoffCoordinator } from "../src/core/handoff.js";

describe("handoff control lease", () => {
  it("records human actions and returns control", () => {
    const handoff = new HandoffCoordinator();
    const request = handoff.request({ runId: "run-1", stepId: "submit", reason: "approval required" });
    handoff.takeControl(request.id);
    handoff.record(request.id, "Reviewed and accepted confirmation dialog");
    const resumed = handoff.resume(request.id);
    expect(resumed.owner).toBe("automation");
    expect(resumed.humanActions).toHaveLength(1);
  });
  it("rejects actions before takeover", () => {
    const handoff = new HandoffCoordinator(); const request = handoff.request({ runId: "run", reason: "blocked" });
    expect(() => handoff.record(request.id, "clicked")).toThrow(/does not hold/); expect(() => handoff.resume(request.id)).toThrow(/not under human/);
  });
  it("rejects duplicate takeover and unknown interventions", () => {
    const handoff = new HandoffCoordinator(); const request = handoff.request({ runId: "run", reason: "blocked" }); handoff.takeControl(request.id);
    expect(() => handoff.takeControl(request.id)).toThrow(/not awaiting/); expect(() => handoff.get("missing")).toThrow(/Unknown/);
  });
});
