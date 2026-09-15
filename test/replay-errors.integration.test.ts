import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { replay } from "../src/core/replay.js";
import { capabilitySchema, type Capability, type Locator, type Step } from "../src/core/schema.js";
import type { Policy } from "../src/core/policy.js";

let server: Server; let origin: string;
const loc = (value: string, fallback: Locator[] = []): Locator => ({ strategy: "css", value, fallback, rationale: "test locator" });
beforeAll(async () => {
  const app = express();
  app.get("/recovery", (_req, res) => res.send(`<button id="dismiss" onclick="this.remove();document.querySelector('#notice').remove()">Dismiss</button><div id="notice">Session notice</div><button id="finish" onclick="document.querySelector('#done').hidden=false">Finish</button><div id="done" hidden>Done</div>`));
  app.get("/irreversible", (_req, res) => res.send(`<button id="confirm" onclick="document.querySelector('#done').hidden=false">Confirm</button><div id="done" hidden>Done</div>`));
  app.use(express.static("public")); server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port"); origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => server.close());
const policy = (): Policy => ({ allowedOrigins: [origin], allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"], irreversible: "confirm" });
const base = (steps: Step[], checkpoint: Capability["checkpoint"], overrides: Partial<Capability> = {}): Capability => capabilitySchema.parse({
  schemaVersion: "1.0", id: "test.flow", version: "1.0.0", name: "Test flow", description: "fixture",
  surface: { adapter: "playwright", appFamily: "fixture", entrypoint: origin }, inputs: {}, outputs: {}, steps, checkpoint,
  businessOutcomes: [], recoveries: [], approval: "draft", createdAt: new Date().toISOString(), ...overrides
});
const navigate = (url: string): Step => ({ id: "open", action: "navigate", value: { source: "literal", value: url }, risk: "safe", timeoutMs: 1000, retries: 0 });
const visible = (selector: string, expected = "Done"): Capability["checkpoint"] => ({ kind: "visible", locator: loc(selector), expected: { source: "literal", value: expected }, timeoutMs: 300 });

describe("replay failure and recovery behavior", () => {
  it("uses a bounded locator fallback", async () => {
    const flow = base([navigate(origin), { id: "fill", action: "fill", target: loc("#missing", [{ strategy: "label", value: "Member Number", fallback: [], rationale: "fallback label" }]), value: { source: "literal", value: "12345" }, risk: "safe", timeoutMs: 500, retries: 0 }], visible("input[name=memberNumber]", "ignored"));
    expect((await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "fallback-")) })).status).toBe("success");
  });

  it("returns policy_denied for a forbidden origin", async () => {
    const flow = base([navigate("https://forbidden.example")], { kind: "url", expected: { source: "literal", value: "https://forbidden.example" }, timeoutMs: 100 });
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "policy-")) }); expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("policy_denied");
  });

  it("reports target_not_found with a screenshot", async () => {
    const flow = base([navigate(origin), { id: "missing", action: "click", target: loc("#absent"), risk: "safe", timeoutMs: 100, retries: 0 }], visible("body"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "missing-")) }); expect(result.status).toBe("failure");
    if (result.status === "failure") { expect(result.error.category).toBe("target_not_found"); expect(await readFile(result.error.evidencePath!)).toBeTruthy(); }
  });

  it("reports checkpoint_failed distinctly", async () => {
    const result = await replay(base([navigate(origin)], visible("#never", "Never")), {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "checkpoint-")) });
    expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("checkpoint_failed");
  });

  it("executes a known recovery before continuing", async () => {
    const flow = base([navigate(`${origin}/recovery`), { id: "finish", action: "click", target: loc("#finish"), risk: "safe", timeoutMs: 500, retries: 0 }], visible("#done"), { recoveries: [{ id: "dismiss-notice", when: { kind: "text", locator: loc("#notice"), expected: { source: "literal", value: "Session notice" }, timeoutMs: 100 }, steps: [{ id: "dismiss", action: "click", target: loc("#dismiss"), risk: "safe", timeoutMs: 500, retries: 0 }], maxAttempts: 1 }] });
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "recovery-")) }); expect(result.status).toBe("success");
    expect(await readFile(path.join(result.evidencePath, "events.jsonl"), "utf8")).toContain("recovery_completed");
  });

  it("returns intervention_required before an unconfirmed irreversible action", async () => {
    const flow = base([navigate(`${origin}/irreversible`), { id: "confirm", action: "click", target: loc("#confirm"), risk: "irreversible", timeoutMs: 500, retries: 0 }], visible("#done"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "intervention-")) }); expect(result.status).toBe("intervention_required");
  });

  it("resumes an irreversible action after a scoped intervention", async () => {
    const flow = base([navigate(`${origin}/irreversible`), { id: "confirm", action: "click", target: loc("#confirm"), risk: "irreversible", timeoutMs: 500, retries: 0 }], visible("#done"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "approved-")), onIntervention: async context => { expect(context.step.id).toBe("confirm"); return { interventionId: "human-1" }; } }); expect(result.status).toBe("success");
  });

  it("enforces declared input types before launching", async () => {
    const flow = base([navigate(origin)], visible("body"), { inputs: { count: { type: "number", description: "count", sensitive: false } } });
    await expect(replay(flow, { count: "wrong" }, { policy: policy() })).rejects.toThrow(/must be number/);
  });
});
