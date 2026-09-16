import { readFile } from "node:fs/promises";
import { replay } from "../core/replay.js";
import { SessionRegistry } from "../core/session-registry.js";
import { HandoffCoordinator } from "../core/handoff.js";
import { RunOrchestrator } from "../core/run-orchestrator.js";
import { createOperatorServer } from "../core/operator-server.js";

const [artifactPath, inputJson = "{}"] = process.argv.slice(2);
if (!artifactPath) throw new Error("Usage: npm run replay -- <artifact.json> '<inputs-json>'");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
if (process.env.CUA_TARGET_URL) {
  const original = artifact.surface?.entrypoint; artifact.surface.entrypoint = process.env.CUA_TARGET_URL;
  for (const step of artifact.steps ?? []) if (step.action === "navigate" && step.value?.source === "literal" && step.value.value === original) step.value.value = process.env.CUA_TARGET_URL;
}
const registry = new SessionRegistry(); const handoffs = new HandoffCoordinator(); const session = await registry.create(process.env.CUA_HEADLESS !== "false");
const operator = await createOperatorServer(registry, handoffs, Number(process.env.CUA_OPERATOR_PORT ?? 4174)); const orchestrator = new RunOrchestrator(registry, handoffs);
console.error(`Operator console: http://127.0.0.1:${process.env.CUA_OPERATOR_PORT ?? 4174}`);
try {
  const result = await replay(artifact, JSON.parse(inputJson), { page: session.page, canAutomationAct: () => session.owner === "automation", onIntervention: orchestrator.interventionHandler(session) });
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === "failure" ? 1 : 0;
} finally { operator.close(); await registry.close(session.id); }
