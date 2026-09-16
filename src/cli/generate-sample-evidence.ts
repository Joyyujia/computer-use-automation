import express from "express";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover } from "../core/discovery.js";
import { ScriptedModelAdapter } from "../core/model-adapter.js";
import { replay } from "../core/replay.js";
import type { Policy } from "../core/policy.js";
import type { Capability } from "../core/schema.js";
import { SessionRegistry } from "../core/session-registry.js";
import { HandoffCoordinator } from "../core/handoff.js";
import { RunOrchestrator } from "../core/run-orchestrator.js";
import { createOperatorServer } from "../core/operator-server.js";

const sampleRoot = path.resolve("evidence/samples");
await mkdir(sampleRoot, { recursive: true });
for (const generated of ["artifacts", "scripted-discovery", "deterministic-replay-second-member", "deterministic-replay-not-found", "same-session-handoff", "index.json"])
  await rm(path.join(sampleRoot, generated), { recursive: true, force: true });

const app = express();
app.use(express.static("public"));
const targetServer = createServer(app);
await new Promise<void>(resolve => targetServer.listen(0, "127.0.0.1", resolve));
const targetAddress = targetServer.address();
if (!targetAddress || typeof targetAddress === "string") throw new Error("Could not start sample target");
const origin = `http://127.0.0.1:${targetAddress.port}`;
const policy: Policy = { allowedOrigins: [origin], allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"], irreversible: "confirm" };
const locator = (strategy: "label" | "role" | "css", value: string, name = "") => ({ strategy, value, name, frame: [], logicalTarget: `${strategy}:${name || value}`, fallback: [], rationale: "Observed stable demo control" });

try {
  const discovery = await discover({
    goal: "Look up member 12345 and read their savings balance",
    entrypoint: origin,
    inputDefinitions: { memberId: { type: "string", description: "Institution-scoped member identifier", sensitive: true } },
    inputs: { memberId: "12345" },
    model: new ScriptedModelAdapter([
      { kind: "fill", target: locator("label", "Member Number"), inputKey: "memberId", rationale: "Enter the supplied member identifier" },
      { kind: "click", target: locator("role", "button", "Find Member"), rationale: "Submit the lookup" },
      { kind: "extract", target: locator("css", "#balance"), outputKey: "balance", rationale: "Use the observed balance extraction target" },
      { kind: "complete", checkpoint: { kind: "text", locator: locator("css", "#detail-member-id"), expected: { source: "input", key: "memberId" }, timeoutMs: 5000 }, businessOutcomes: [], rationale: "The requested member is displayed" }
    ]),
    policy,
    evidenceRoot: path.join(sampleRoot, "scripted-discovery"),
    artifactRoot: path.join(sampleRoot, "artifacts")
  });
  if (discovery.status !== "success") throw new Error(`Sample discovery failed: ${discovery.status}`);

  const secondMember = await replay(discovery.artifact, { memberId: "67890" }, { policy, evidenceRoot: path.join(sampleRoot, "deterministic-replay-second-member") });
  if (secondMember.status !== "success") throw new Error(`Second-member replay failed: ${secondMember.status}`);
  const notFound = await replay(discovery.artifact, { memberId: "99999" }, { policy, evidenceRoot: path.join(sampleRoot, "deterministic-replay-not-found") });
  if (notFound.status !== "business_outcome") throw new Error(`Not-found replay failed: ${notFound.status}`);

  const registry = new SessionRegistry();
  const handoffs = new HandoffCoordinator();
  const session = await registry.create();
  const operator = await createOperatorServer(registry, handoffs, 0);
  const operatorAddress = operator.address();
  if (!operatorAddress || typeof operatorAddress === "string") throw new Error("Could not start sample operator");
  const operatorOrigin = `http://127.0.0.1:${operatorAddress.port}`;
  const handoffArtifact = structuredClone(discovery.artifact) as Capability;
  const expiredUrl = `${origin}/?expired=1`;
  handoffArtifact.surface.entrypoint = expiredUrl;
  const navigation = handoffArtifact.steps.find(step => step.action === "navigate");
  if (!navigation) throw new Error("Generated artifact has no navigation step");
  navigation.value = { source: "literal", value: expiredUrl };
  try {
    const replayPromise = replay(handoffArtifact, { memberId: "12345" }, {
      page: session.page,
      policy,
      evidenceRoot: path.join(sampleRoot, "same-session-handoff"),
      canAutomationAct: () => session.owner === "automation",
      onIntervention: new RunOrchestrator(registry, handoffs).interventionHandler(session)
    });
    const deadline = Date.now() + 5000;
    while (handoffs.list().length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    const intervention = handoffs.list()[0];
    if (!intervention) throw new Error("Handoff was not requested");
    const endpoint = `${operatorOrigin}/api/intervention/${intervention.id}`;
    const take = await fetch(`${endpoint}/take`, { method: "POST" });
    if (!take.ok) throw new Error("Operator could not take control");
    const box = await session.page.locator("#restore-session").boundingBox();
    if (!box) throw new Error("Restore-session control was not visible");
    const click = await fetch(`${endpoint}/click`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) });
    if (!click.ok) throw new Error("Operator click failed");
    const resume = await fetch(`${endpoint}/resume`, { method: "POST" });
    if (!resume.ok) throw new Error("Operator could not return control");
    const handoff = await replayPromise;
    if (handoff.status !== "success") throw new Error(`Handoff replay failed: ${handoff.status}`);

    const relative = (value: string) => path.relative(process.cwd(), value);
    await writeFile(path.join(sampleRoot, "index.json"), JSON.stringify({
      classification: "scripted_non_live_evidence",
      warning: "These fixtures demonstrate mechanics only and do not satisfy the required genuine API-backed discovery run.",
      discovery: { status: discovery.status, evidencePath: relative(discovery.evidencePath), artifactPath: relative(discovery.artifactPath) },
      secondMemberReplay: { status: secondMember.status, evidencePath: relative(secondMember.evidencePath) },
      notFoundReplay: { status: notFound.status, code: notFound.code, evidencePath: relative(notFound.evidencePath) },
      sameSessionHandoff: { status: handoff.status, evidencePath: relative(handoff.evidencePath), interventionId: intervention.id }
    }, null, 2) + "\n");
  } finally {
    operator.close();
    await registry.close(session.id);
  }
} finally {
  targetServer.close();
}

async function normalizeWorkspacePaths(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeWorkspacePaths(target);
    else if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) {
      const content = await readFile(target, "utf8");
      await writeFile(target, content.replaceAll(process.cwd(), "[WORKSPACE]"));
    }
  }
}
await normalizeWorkspacePaths(sampleRoot);

console.log("Generated redacted, non-live sample evidence under evidence/samples.");
