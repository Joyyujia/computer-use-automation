import { randomUUID } from "node:crypto";

export type ControlOwner = "automation" | "human";
export type Intervention = {
  id: string; runId: string; sessionId?: string; stepId?: string; reason: string; evidencePath?: string;
  owner: ControlOwner; state: "requested" | "in_progress" | "resumed" | "aborted";
  humanActions: Array<{ at: string; description: string }>;
};

export class HandoffCoordinator {
  private requests = new Map<string, Intervention>();
  request(data: Omit<Intervention, "id" | "owner" | "state" | "humanActions">): Intervention {
    const item: Intervention = { ...data, id: randomUUID(), owner: "automation", state: "requested", humanActions: [] };
    this.requests.set(item.id, item);
    return item;
  }
  takeControl(id: string): Intervention { return this.update(id, { owner: "human", state: "in_progress" }); }
  record(id: string, description: string): Intervention {
    const item = this.require(id);
    if (item.owner !== "human") throw new Error("Human does not hold the control lease");
    item.humanActions.push({ at: new Date().toISOString(), description });
    return item;
  }
  resume(id: string): Intervention { return this.update(id, { owner: "automation", state: "resumed" }); }
  get(id: string): Intervention { return this.require(id); }
  list(): Intervention[] { return [...this.requests.values()]; }
  private require(id: string): Intervention { const item = this.requests.get(id); if (!item) throw new Error("Unknown intervention"); return item; }
  private update(id: string, patch: Partial<Intervention>): Intervention { return Object.assign(this.require(id), patch); }
}
