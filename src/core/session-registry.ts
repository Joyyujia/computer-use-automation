import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export type LiveSession = { id: string; browser: Browser; context: BrowserContext; page: Page; owner: "automation" | "human" };

export class SessionRegistry {
  private sessions = new Map<string, LiveSession>();
  async create(headless = true): Promise<LiveSession> {
    const browser = await chromium.launch({ headless }); const context = await browser.newContext(); const page = await context.newPage();
    const session = { id: randomUUID(), browser, context, page, owner: "automation" as const }; this.sessions.set(session.id, session); return session;
  }
  get(id: string): LiveSession { const session = this.sessions.get(id); if (!session) throw new Error("Unknown live session"); return session; }
  transfer(id: string, from: LiveSession["owner"], to: LiveSession["owner"]): LiveSession {
    const session = this.get(id); if (session.owner !== from) throw new Error(`Control conflict: ${from} does not own session`); session.owner = to; return session;
  }
  async close(id: string): Promise<void> { const session = this.get(id); await session.browser.close(); this.sessions.delete(id); }
}
