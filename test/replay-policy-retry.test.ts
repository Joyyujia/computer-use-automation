import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { replay } from "../src/core/replay.js";
import { capabilitySchema } from "../src/core/schema.js";
import type { Policy } from "../src/core/policy.js";

describe("replay retry policy enforcement", () => {
  it("rechecks the browser origin before a retry can act", async () => {
    let currentUrl = "https://allowed.example/start";
    let fillCount = 0;
    const mainFrame = { url: () => currentUrl };
    const body = {
      evaluate: async () => ({ visibleText: "", controls: [], extractables: [], alerts: [] })
    };
    const input = {
      count: async () => 1,
      isVisible: async () => true,
      isEnabled: async () => true,
      isEditable: async () => true,
      fill: async () => {
        fillCount += 1;
        currentUrl = "https://outside.example/";
        throw new Error("ordinary failure after leaving the allowed origin");
      }
    };
    const page = {
      on: () => undefined,
      url: () => currentUrl,
      title: async () => "Retry policy fixture",
      context: () => ({ pages: () => [page] }),
      mainFrame: () => mainFrame,
      frames: () => [mainFrame],
      locator: (selector: string) => selector === "body" ? body : input
    } as unknown as Page;
    const capability = capabilitySchema.parse({
      schemaVersion: "1.0",
      id: "test.retry-origin-policy",
      version: "1.0.0",
      name: "Retry origin policy",
      description: "Regression fixture for per-attempt browser-state enforcement",
      surface: { adapter: "playwright", appFamily: "fixture", entrypoint: "https://allowed.example/start" },
      inputs: {},
      outputs: {},
      steps: [{
        id: "write",
        action: "fill",
        target: { strategy: "css", value: "#field", fallback: [], rationale: "fixture target" },
        value: { source: "literal", value: "value" },
        risk: "safe",
        timeoutMs: 100,
        retries: 1
      }],
      checkpoint: {
        kind: "visible",
        locator: { strategy: "css", value: "#done", fallback: [], rationale: "fixture checkpoint" },
        timeoutMs: 100
      },
      businessOutcomes: [],
      recoveries: [],
      approval: "draft",
      createdAt: new Date().toISOString()
    });
    const policy: Policy = {
      allowedOrigins: ["https://allowed.example"],
      allowedActions: ["fill"],
      irreversible: "confirm"
    };

    const result = await replay(capability, {}, {
      page,
      policy,
      evidenceRoot: await mkdtemp(path.join(tmpdir(), "retry-origin-policy-"))
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") expect(result.error.category).toBe("policy_denied");
    expect(fillCount).toBe(1);
  });
});
