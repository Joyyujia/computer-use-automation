import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discover } from "../src/core/discovery.js";
import { ScriptedModelAdapter } from "../src/core/model-adapter.js";
import { replay } from "../src/core/replay.js";
import type { Policy } from "../src/core/policy.js";
import { SessionRegistry } from "../src/core/session-registry.js";
import { HandoffCoordinator } from "../src/core/handoff.js";
import { createOperatorServer } from "../src/core/operator-server.js";
import artifactFixture from "../artifacts/lookup-balance.v1.json" with { type: "json" };

let server: Server; let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.static("public")); server = createServer(app);
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port"); origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => server.close());
const policy = (): Policy => ({ allowedOrigins: [origin], allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"], irreversible: "confirm" });

describe("vertical slice", () => {
  it("discovers a flow and compiles a draft artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cua-discovery-"));
    const locator = (strategy: "label" | "role" | "css" | "text", value: string, name?: string) => ({ strategy, value, name, fallback: [], rationale: "Stable fixture locator" });
    const model = new ScriptedModelAdapter([
      { kind: "navigate", url: origin, rationale: "Open target" },
      { kind: "fill", target: locator("label", "Member Number"), inputKey: "memberId", rationale: "Supply member" },
      { kind: "click", target: locator("role", "button", "Find Member"), rationale: "Submit lookup" },
      { kind: "extract", target: locator("css", "#balance"), outputKey: "balance", rationale: "Read balance" },
      { kind: "complete", checkpoint: { kind: "visible", locator: locator("text", "Member Detail"), expected: { source: "literal", value: "Member Detail" }, timeoutMs: 5000 }, businessOutcomes: [], rationale: "Goal met" }
    ]);
    const result = await discover({ goal: "Look up savings balance", entrypoint: origin, inputs: { memberId: "12345" }, model, policy: policy(), evidenceRoot: path.join(root, "evidence"), artifactRoot: path.join(root, "artifacts") });
    expect(result.status).toBe("success"); if (result.status === "success") { expect(result.artifact.approval).toBe("draft"); expect(result.artifact.provenance?.createdFromLiveRun).toBe(false); expect(result.artifact.steps).toHaveLength(4); }
  }, 20_000);

  it("replays success and distinguishes not-found as a business outcome", async () => {
    const artifact = structuredClone(artifactFixture); artifact.surface.entrypoint = origin; artifact.steps[0].value = { source: "literal", value: origin };
    const root = await mkdtemp(path.join(tmpdir(), "cua-replay-"));
    const success = await replay(artifact, { memberId: "12345" }, { policy: policy(), evidenceRoot: root });
    expect(success.status).toBe("success");
    if (success.status === "success") expect(await readFile(path.join(success.evidencePath, "result.json"), "utf8")).not.toContain("$2,418.73");
    const missing = await replay(artifact, { memberId: "99999" }, { policy: policy(), evidenceRoot: root });
    expect(missing.status).toBe("business_outcome"); if (missing.status === "business_outcome") expect(missing.code).toBe("member_not_found");
  }, 20_000);

  it("hands the same live session to a human and back", async () => {
    const registry = new SessionRegistry(); const handoffs = new HandoffCoordinator();
    const session = await registry.create(); await session.page.goto(origin); await session.page.getByLabel("Member Number").focus();
    const intervention = handoffs.request({ runId: "run-handoff", sessionId: session.id, stepId: "enter-member", reason: "Manual verification" });
    const operator = await createOperatorServer(registry, handoffs, 0); const address = operator.address(); if (!address || typeof address === "string") throw new Error("No operator port");
    const endpoint = `http://127.0.0.1:${address.port}/api/intervention/${intervention.id}`;
    try {
      expect((await fetch(`${endpoint}/take`, { method: "POST" }).then(r => r.json())).owner).toBe("human");
      await fetch(`${endpoint}/type`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "12345" }) });
      expect(await session.page.getByLabel("Member Number").inputValue()).toBe("12345");
      expect((await fetch(`${endpoint}/resume`, { method: "POST" }).then(r => r.json())).owner).toBe("automation");
      expect(session.owner).toBe("automation"); expect(handoffs.get(intervention.id).humanActions).toHaveLength(1);
    } finally { operator.close(); await registry.close(session.id); }
  }, 20_000);
});
