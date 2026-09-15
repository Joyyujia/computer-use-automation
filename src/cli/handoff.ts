import { EvidenceWriter } from "../core/evidence.js";
import { HandoffCoordinator } from "../core/handoff.js";
import { requestAndWaitForHuman } from "../core/handoff-runner.js";
import { createOperatorServer } from "../core/operator-server.js";
import { SessionRegistry } from "../core/session-registry.js";

const registry = new SessionRegistry(); const handoffs = new HandoffCoordinator();
const session = await registry.create(process.env.CUA_HEADLESS !== "false");
await session.page.goto(process.env.CUA_BASE_URL ?? "http://127.0.0.1:4173");
const evidence = new EvidenceWriter(`handoff-${session.id}`); await evidence.init();
const server = await createOperatorServer(registry, handoffs, Number(process.env.CUA_OPERATOR_PORT ?? 4174));
console.log(`Operator console: http://127.0.0.1:${process.env.CUA_OPERATOR_PORT ?? 4174}`);
try {
  const result = await requestAndWaitForHuman({ registry, handoffs, sessionId: session.id, reason: "Demonstrate same-session manual control", evidence });
  await evidence.result({ status: "resumed", intervention: result }); console.log(JSON.stringify(result, null, 2));
} finally { server.close(); await registry.close(session.id); }
