import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { replay } from "../src/core/replay.js";
import type { Policy } from "../src/core/policy.js";
import artifactFixture from "../artifacts/lookup-balance.v1.json" with { type: "json" };

let server: Server; let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.static("public")); server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port"); origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => server.close());
const policy = (): Policy => ({ allowedOrigins: [origin], allowedActions: ["navigate", "click", "fill", "select", "extract", "assert"], irreversible: "confirm" });
const artifactFor = (url: string, timeoutMs = 2000): any => {
  const artifact = structuredClone(artifactFixture);
  artifact.surface.entrypoint = url;
  artifact.steps[0].value = { source: "literal", value: url };
  const extractStep = artifact.steps.find((step: any) => step.action === "extract");
  if (!extractStep) throw new Error("Fixture must contain an extract step");
  extractStep.timeoutMs = timeoutMs;
  return artifact;
};
const evidenceRoot = async (name: string) => mkdtemp(path.join(tmpdir(), `${name}-`));

describe("assignment acceptance paths", () => {
  it("replays the exact artifact for two valid members with different balances", async () => {
    const artifact = artifactFor(origin); const first = await replay(artifact, { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("member-a") }); const second = await replay(artifact, { memberId: "67890" }, { policy: policy(), evidenceRoot: await evidenceRoot("member-b") });
    expect(first.status).toBe("success"); expect(second.status).toBe("success");
    if (first.status === "success" && second.status === "success") { expect(first.outputs.balance).toBe("$2,418.73"); expect(second.outputs.balance).toBe("$987.65"); expect(first.outputs.balance).not.toBe(second.outputs.balance); }
  }, 20_000);

  it("waits for delayed success and delayed not-found states", async () => {
    const artifact = artifactFor(`${origin}/?delayMs=800`, 2000); const found = await replay(artifact, { memberId: "67890" }, { policy: policy(), evidenceRoot: await evidenceRoot("delay-found") }); const missing = await replay(artifact, { memberId: "00000" }, { policy: policy(), evidenceRoot: await evidenceRoot("delay-missing") });
    expect(found.status).toBe("success"); expect(missing.status).toBe("business_outcome");
  }, 20_000);

  it("rejects a detail page for the wrong member", async () => {
    const result = await replay(artifactFor(`${origin}/?wrongMember=1`, 400), { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("wrong-member") });
    expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("timeout");
  }, 20_000);

  it("does not accept a stale not-found state from the previous lookup", async () => {
    const browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(origin); await page.getByLabel("Member Number").fill("00000"); await page.getByRole("button", { name: "Find Member" }).click(); await page.getByText("Member not found").waitFor();
    const artifact = artifactFor(origin); artifact.steps = artifact.steps.filter((step: any) => step.action !== "navigate");
    try { const result = await replay(artifact, { memberId: "67890" }, { page, policy: policy(), evidenceRoot: await evidenceRoot("stale") }); expect(result.status).toBe("success"); if (result.status === "success") expect(result.outputs.balance).toBe("$987.65"); }
    finally { await browser.close(); }
  }, 20_000);

  it("does not return the previous valid member's balance", async () => {
    const browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(`${origin}/?delayMs=300`); await page.getByLabel("Member Number").fill("12345"); await page.getByRole("button", { name: "Find Member" }).click(); await page.locator("#balance").waitFor();
    expect(await page.locator("#balance").textContent()).toBe("$2,418.73");
    const artifact = artifactFor(`${origin}/?delayMs=300`); artifact.steps = artifact.steps.filter((step: any) => step.action !== "navigate");
    try { const result = await replay(artifact, { memberId: "67890" }, { page, policy: policy(), evidenceRoot: await evidenceRoot("stale-valid") }); expect(result.status).toBe("success"); if (result.status === "success") expect(result.outputs.balance).toBe("$987.65"); }
    finally { await browser.close(); }
  }, 20_000);

  it("returns a structured timeout when no terminal state arrives", async () => {
    const result = await replay(artifactFor(`${origin}/?hang=1`, 300), { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("hang") });
    expect(result.status).toBe("failure"); if (result.status === "failure") { expect(result.error.category).toBe("timeout"); expect(result.error.expected).toContain("Configured success"); expect(result.error.observed).toContain("Loading member"); }
  }, 20_000);

  it("dismisses the configured service notice before continuing", async () => {
    const result = await replay(artifactFor(`${origin}/?notice=1`), { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("notice") }); expect(result.status).toBe("success");
  }, 20_000);

  it("fails safely when a semantic locator is ambiguous", async () => {
    const result = await replay(artifactFor(`${origin}/?duplicate=1`), { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("ambiguous") }); expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("ambiguous_target");
  }, 20_000);

  it("validates every declared output before success", async () => {
    const artifact = artifactFor(origin); artifact.outputs.unwritten = { type: "string", description: "Must be produced", sensitive: false };
    const result = await replay(artifact, { memberId: "12345" }, { policy: policy(), evidenceRoot: await evidenceRoot("output") }); expect(result.status).toBe("failure"); if (result.status === "failure") expect(result.error.category).toBe("output_invalid");
  }, 20_000);
});
