export type RunState = "created" | "starting" | "automation_in_control" | "waiting_for_human" | "human_in_control" | "succeeded" | "business_outcome" | "failed";

const allowed: Record<RunState, RunState[]> = {
  created: ["starting"], starting: ["automation_in_control", "failed"],
  automation_in_control: ["waiting_for_human", "succeeded", "business_outcome", "failed"],
  waiting_for_human: ["human_in_control", "failed"], human_in_control: ["automation_in_control", "failed"],
  succeeded: [], business_outcome: [], failed: []
};

export class RunStateMachine {
  constructor(public state: RunState = "created") {}
  transition(next: RunState): void {
    if (!allowed[this.state].includes(next)) throw new Error(`Invalid run transition ${this.state} -> ${next}`);
    this.state = next;
  }
}
