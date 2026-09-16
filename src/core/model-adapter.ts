import { discoveryDecisionSchema, discoveryDecisionJsonSchema, type DiscoveryDecision } from "./discovery-schema.js";
import type { Observation } from "./observation.js";

export type ModelContext = { goal: string; inputs: Record<string, unknown>; observation: Observation; history: Array<{ decision: DiscoveryDecision; outcome: string }>; remainingSteps: number };
export interface ModelAdapter { readonly name: string; readonly isLive?: boolean; decide(context: ModelContext): Promise<{ decision: DiscoveryDecision; usage?: Record<string, number>; responseId?: string }> }

export class ScriptedModelAdapter implements ModelAdapter {
  readonly name = "scripted-test-fixture";
  readonly isLive = false;
  readonly contexts: ModelContext[] = [];
  constructor(private readonly decisions: DiscoveryDecision[]) {}
  async decide(context?: ModelContext): Promise<{ decision: DiscoveryDecision }> {
    if (context) this.contexts.push(structuredClone(context));
    const decision = this.decisions.shift();
    if (!decision) throw new Error("Scripted model exhausted");
    return { decision: discoveryDecisionSchema.parse(decision) };
  }
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly name: string;
  readonly isLive = true;
  constructor(private readonly apiKey: string, model = process.env.OPENAI_MODEL || "gpt-5.4-mini") { this.name = model; }
  async decide(context: ModelContext): Promise<{ decision: DiscoveryDecision; usage?: Record<string, number>; responseId?: string }> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.name, store: false,
        instructions: "You operate a UI to accomplish the goal. Return exactly one safe next decision. Use inputKey references for runtime data. Prefer role/label/text locators, use CSS only as fallback, never invent controls, and request a human when unsafe or stuck. Use wait when the application is visibly loading; never resubmit an action merely because its result is delayed. Every locator must include name (empty string if unused), frame (empty array if unused), logicalTarget (a stable semantic identifier), fallback, and rationale. A fallback is allowed only when it names the same logicalTarget as the primary locator. Every assertion must include a locator; for URL assertions use a harmless URL locator placeholder. A complete decision must include any visible, known business-outcome detectors such as a not-found alert, or an empty array.",
        input: JSON.stringify(context),
        text: { format: { type: "json_schema", name: "computer_use_decision", strict: true, schema: discoveryDecisionJsonSchema } }
      })
    });
    if (!response.ok) throw new Error(`OpenAI response ${response.status}: ${await response.text()}`);
    const raw = await response.json() as { id?: string; output_text?: string; output?: Array<{ content?: Array<{ type: string; text?: string }> }>; usage?: Record<string, number> };
    const text = raw.output_text ?? raw.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI response did not contain output_text");
    return { decision: discoveryDecisionSchema.parse(JSON.parse(text)), usage: raw.usage, responseId: raw.id };
  }
}
