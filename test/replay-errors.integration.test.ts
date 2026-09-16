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
  app.get("/popup", (_req, res) => res.send(`<button id="open" onclick="window.open('/popup-child')">Open helper</button><div id="done">Done</div>`));
  app.get("/popup-child", (_req, res) => res.send(`<p>Unexpected popup</p>`));
  app.get("/dialog", (_req, res) => res.send(`<button id="open" onclick="alert('sensitive application text')">Open dialog</button><div id="done">Done</div>`));
  app.get("/human-complete", (_req, res) => res.send(`<div id="blocker">Human required</div><button id="finish" onclick="document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);document.querySelector('#blocker')?.remove()">Finish once</button><div id="count">0</div>`));
  app.get("/execution-failure", (_req, res) => res.send(`<button id="actual-finish" onclick="document.querySelector('#done').hidden=false;document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1)">Finish</button><div id="done" hidden>Done</div><div id="count">0</div>`));
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
const visible = (selector: string, _expected = "Done"): Capability["checkpoint"] => ({ kind: "visible", locator: loc(selector), timeoutMs: 300 });

describe("replay failure and recovery behavior", () => {
  it("uses a bounded locator fallback", async () => {
    const fallback = { strategy: "label" as const, value: "Member Number", logicalTarget: "member-number-input", fallback: [], rationale: "fallback label" };
    const primary = { ...loc("#missing", [fallback]), logicalTarget: "member-number-input" };
    const flow = base([navigate(origin), { id: "fill", action: "fill", target: primary, value: { source: "literal", value: "12345" }, risk: "safe", timeoutMs: 500, retries: 0 }], visible("input[name=memberNumber]", "ignored"));
    expect((await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "fallback-")) })).status).toBe("success");
  });

  it("returns policy_denied for a forbidden origin", async () => {
    const flow = base([navigate("https://forbidden.example")], { kind: "url", expected: { source: "literal", value: "https://forbidden.example" }, timeoutMs: 100 });
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "policy-")) }); expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("policy_denied");
  });

  it("reports target_not_found with a screenshot", async () => {
    const flow = base([navigate(origin), { id: "missing", action: "click", target: loc("#absent"), risk: "safe", timeoutMs: 100, retries: 0 }], visible("body"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "missing-")) }); expect(result.status).toBe("failure");
    if (result.status === "failure") { expect(result.error.category).toBe("target_not_found"); expect(result.error.recoverable).toBe(true); expect(await readFile(result.error.evidencePath!)).toBeTruthy(); }
  });

  it("routes an execution failure to a human and does not repeat an uncertain click", async () => {
    const one = { kind: "text" as const, locator: loc("#count"), expected: { source: "literal" as const, value: "1" }, timeoutMs: 300 };
    const flow = base([navigate(`${origin}/execution-failure`), { id: "finish", action: "click", target: loc("#stale-finish"), risk: "safe", timeoutMs: 100, retries: 0 }], one);
    let handoffs = 0;
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "failure-handoff-")), onIntervention: async context => { handoffs += 1; expect(context.resume).toBe("verify_then_continue"); await context.page.locator("#actual-finish").click(); return { interventionId: "repair-1" }; } });
    expect(result.status).toBe("success"); expect(handoffs).toBe(1);
  });

  it("allows a human to repair a safe target before one bounded retry", async () => {
    const flow = base([navigate(`${origin}/execution-failure`), { id: "fill-late", action: "fill", target: loc("#late-input"), value: { source: "literal", value: "ready" }, risk: "safe", timeoutMs: 100, retries: 0 }], visible("#late-input"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "failure-retry-")), onIntervention: async context => { expect(context.resume).toBe("retry_step"); await context.page.evaluate(() => { const input = document.createElement("input"); input.id = "late-input"; document.body.append(input); }); return { interventionId: "repair-2" }; } });
    expect(result.status).toBe("success");
  });

  it("hands off when no competing terminal state appears before the deadline", async () => {
    const flow = base([navigate(`${origin}/execution-failure`), { id: "read-count", action: "extract", target: loc("#count"), outputKey: "count", risk: "safe", timeoutMs: 100, retries: 0 }], visible("#done"), { outputs: { count: { type: "string", description: "Final count", sensitive: false } } });
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "timeout-handoff-")), onIntervention: async context => { expect(context.reason).toContain("TERMINAL_TIMEOUT"); await context.page.locator("#actual-finish").click(); return { interventionId: "repair-timeout" }; } });
    expect(result.status).toBe("success"); if (result.status === "success") expect(result.outputs.count).toBe("1");
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

  it("requires approval when trusted rules identify risk despite a safe artifact label", async () => {
    const flow = base([navigate(`${origin}/irreversible`), { id: "confirm", action: "click", target: loc("#confirm"), risk: "safe", timeoutMs: 500, retries: 0 }], visible("#done"));
    const result = await replay(flow, {}, { policy: { ...policy(), riskyTargetPatterns: [/confirm/i] }, evidenceRoot: await mkdtemp(path.join(tmpdir(), "inferred-risk-")) });
    expect(result.status).toBe("intervention_required");
  });

  it("closes and reports an unexpected popup at the shared policy boundary", async () => {
    const flow = base([navigate(`${origin}/popup`), { id: "open-popup", action: "click", target: loc("#open"), risk: "safe", timeoutMs: 500, retries: 0 }], visible("#done"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "popup-")) });
    expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("policy_denied");
  });

  it("dismisses and classifies an unexpected browser dialog without persisting its text", async () => {
    const flow = base([navigate(`${origin}/dialog`), { id: "open-dialog", action: "click", target: loc("#open"), risk: "safe", timeoutMs: 500, retries: 0 }], visible("#done"));
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "dialog-")) });
    expect(result.status).toBe("failure"); if (result.status === "failure") { expect(result.error.category).toBe("unexpected_dialog"); expect(await readFile(path.join(result.evidencePath, "result.json"), "utf8")).not.toContain("sensitive application text"); }
  });

  it("verifies and skips a step that the human already completed", async () => {
    const one = { kind: "text" as const, locator: loc("#count"), expected: { source: "literal" as const, value: "1" }, timeoutMs: 300 };
    const flow = base([navigate(`${origin}/human-complete`), { id: "finish", action: "click", target: loc("#finish"), risk: "safe", timeoutMs: 500, retries: 0 }], one, { interventions: [{ code: "human_completed", message: "Human must finish", assertion: { kind: "visible", locator: loc("#blocker"), timeoutMs: 100 }, resume: "verify_then_continue", resumeAssertion: one }] });
    const result = await replay(flow, {}, { policy: policy(), evidenceRoot: await mkdtemp(path.join(tmpdir(), "human-complete-")), onIntervention: async context => { await context.page.locator("#finish").click(); return { interventionId: "human-completed" }; } });
    expect(result.status).toBe("success"); expect(await readFile(path.join(result.evidencePath, "events.jsonl"), "utf8")).toContain("step_completed_by_human");
  });

  it("enforces declared input types before launching", async () => {
    const flow = base([navigate(origin)], visible("body"), { inputs: { count: { type: "number", description: "count", sensitive: false } } });
    await expect(replay(flow, { count: "wrong" }, { policy: policy() })).rejects.toThrow(/must be number/);
  });
});
