import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIModelAdapter, ScriptedModelAdapter, type ModelContext } from "../src/core/model-adapter.js";

const decision = { kind: "request_human" as const, reason: "unknown dialog", rationale: "safe stop" };
const context: ModelContext = { goal: "test", inputs: {}, observation: { url: "about:blank", title: "", visibleText: "", controls: [], alerts: [] }, history: [], remainingSteps: 2 };
afterEach(() => vi.unstubAllGlobals());

describe("model adapters", () => {
  it("consumes scripted decisions in order and then fails closed", async () => {
    const model = new ScriptedModelAdapter([decision]); expect((await model.decide()).decision).toEqual(decision); await expect(model.decide()).rejects.toThrow(/exhausted/);
  });

  it("sends a non-stored strict-schema Responses request", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "resp_test", output: [{ content: [{ type: "output_text", text: JSON.stringify(decision) }] }], usage: { total_tokens: 12 } }), { status: 200 })); vi.stubGlobal("fetch", mock);
    const adapter = new OpenAIModelAdapter("test-key", "test-model"); const result = await adapter.decide(context); expect(result.decision).toEqual(decision); expect(result.usage?.total_tokens).toBe(12); expect(result.responseId).toBe("resp_test"); expect(adapter.isLive).toBe(true);
    const [url, init] = mock.mock.calls[0]; const body = JSON.parse(init.body); expect(url).toBe("https://api.openai.com/v1/responses"); expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true); expect(init.headers.authorization).toBe("Bearer test-key");
  });

  it("accepts the output_text convenience shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(decision) }), { status: 200 })));
    expect((await new OpenAIModelAdapter("key").decide(context)).decision.kind).toBe("request_human");
  });

  it("surfaces HTTP failures and missing output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }))); await expect(new OpenAIModelAdapter("key").decide(context)).rejects.toThrow(/429/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [] }), { status: 200 }))); await expect(new OpenAIModelAdapter("key").decide(context)).rejects.toThrow(/output_text/);
  });

  it("rejects model output outside the decision schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ kind: "click", rationale: "missing target" }) }), { status: 200 })));
    await expect(new OpenAIModelAdapter("key").decide(context)).rejects.toThrow();
  });
});
