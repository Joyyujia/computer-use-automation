import { discover } from "../core/discovery.js";
import { OpenAIModelAdapter } from "../core/model-adapter.js";
import { SessionRegistry } from "../core/session-registry.js";
import { HandoffCoordinator } from "../core/handoff.js";
import { RunOrchestrator } from "../core/run-orchestrator.js";
import { createOperatorServer } from "../core/operator-server.js";

const goal = process.argv.slice(2).join(" ");
if (!goal) throw new Error("Usage: npm run discover -- '<goal>'");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required for genuine discovery");
const registry = new SessionRegistry(); const handoffs = new HandoffCoordinator(); const session = await registry.create(process.env.CUA_HEADLESS !== "false");
const operator = await createOperatorServer(registry, handoffs, Number(process.env.CUA_OPERATOR_PORT ?? 4174)); const orchestrator = new RunOrchestrator(registry, handoffs);
console.error(`Operator console: http://127.0.0.1:${process.env.CUA_OPERATOR_PORT ?? 4174}`);
try {
  const result = await discover({ goal, entrypoint: process.env.CUA_BASE_URL ?? "http://127.0.0.1:4173", inputDefinitions: { memberId: { type: "string", description: "Institution-scoped member identifier", sensitive: true } }, inputs: { memberId: process.env.CUA_MEMBER_ID ?? "12345" }, model: new OpenAIModelAdapter(apiKey), page: session.page, canAutomationAct: () => session.owner === "automation", onIntervention: orchestrator.interventionHandler(session) });
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === "failure" ? 1 : 0;
} finally { operator.close(); await registry.close(session.id); }
