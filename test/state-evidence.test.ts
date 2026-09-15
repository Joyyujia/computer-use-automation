import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStateMachine } from "../src/core/run-state.js";
import { EvidenceWriter } from "../src/core/evidence.js";

describe("run state and evidence", () => {
  it("allows the human handoff round trip", () => {
    const state = new RunStateMachine(); for (const next of ["starting", "automation_in_control", "waiting_for_human", "human_in_control", "automation_in_control", "succeeded"] as const) state.transition(next);
    expect(state.state).toBe("succeeded");
  });
  it("rejects invalid and post-terminal transitions", () => {
    expect(() => new RunStateMachine().transition("succeeded")).toThrow(/Invalid/);
    const state = new RunStateMachine("failed"); expect(() => state.transition("starting")).toThrow(/Invalid/);
  });
  it("writes redacted manifests, events, and results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-test-")); const writer = new EvidenceWriter("run", root); await writer.init();
    await writer.manifest({ apiKey: "secret", nested: { accountNumber: "123", safe: "ok" } }); await writer.event({ token: "secret", action: "click" }); await writer.result({ password: "secret", status: "success" });
    expect(await readFile(writer.path("manifest.json"), "utf8")).not.toContain("secret"); expect(await readFile(writer.path("events.jsonl"), "utf8")).toContain("[REDACTED]"); expect(await readFile(writer.path("result.json"), "utf8")).toContain('"status": "success"');
  });
});
