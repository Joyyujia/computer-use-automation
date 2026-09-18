import express from "express";
import type { Server } from "node:http";
import { HandoffCoordinator } from "./handoff.js";
import { SessionRegistry } from "./session-registry.js";

export function createOperatorServer(registry: SessionRegistry, handoffs: HandoffCoordinator, port = 4174): Promise<Server> {
  const app = express(); app.use(express.json({ limit: "1mb" })); app.use(express.static("public/operator"));
  app.get("/api/interventions", (_req, res) => res.json(handoffs.list()));
  app.get("/api/session/:id/screenshot", async (req, res) => { try { res.type("png").send(await registry.get(req.params.id).page.screenshot()); } catch (e) { res.status(404).json({ error: String(e) }); } });
  const sessionId = (item: ReturnType<HandoffCoordinator["get"]>) => item.sessionId ?? item.runId;
  app.post("/api/intervention/:id/take", (req, res) => { try { const item = handoffs.takeControl(req.params.id); registry.transfer(sessionId(item), "automation", "human"); res.json(item); } catch (e) { res.status(409).json({ error: String(e) }); } });
  app.post("/api/intervention/:id/click", async (req, res) => { try { const item = handoffs.get(req.params.id); const session = registry.get(sessionId(item)); if (session.owner !== "human") throw new Error("Human does not hold control"); await session.page.mouse.click(Number(req.body.x), Number(req.body.y)); res.json(handoffs.record(item.id, `Clicked (${req.body.x}, ${req.body.y})`)); } catch (e) { res.status(409).json({ error: String(e) }); } });
  app.post("/api/intervention/:id/type", async (req, res) => { try { const item = handoffs.get(req.params.id); const session = registry.get(sessionId(item)); if (session.owner !== "human") throw new Error("Human does not hold control"); await session.page.keyboard.type(String(req.body.text)); res.json(handoffs.record(item.id, "Typed redacted text")); } catch (e) { res.status(409).json({ error: String(e) }); } });
  app.post("/api/intervention/:id/resume", (req, res) => { try { const current = handoffs.get(req.params.id); if (current.humanActions.length === 0) throw new Error("Record at least one human action before returning control"); registry.transfer(sessionId(current), "human", "automation"); res.json(handoffs.resume(current.id)); } catch (e) { res.status(409).json({ error: String(e) }); } });
  app.post("/api/intervention/:id/abort", (req, res) => { try { const current = handoffs.get(req.params.id); if (current.owner === "human") registry.transfer(sessionId(current), "human", "automation"); res.json(handoffs.abort(current.id)); } catch (e) { res.status(409).json({ error: String(e) }); } });
  return new Promise(resolve => { const server = app.listen(port, "127.0.0.1", () => resolve(server)); });
}
