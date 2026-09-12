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
});
