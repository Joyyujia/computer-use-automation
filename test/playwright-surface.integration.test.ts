import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PlaywrightSurface } from "../src/core/playwright-surface.js";

let browser: Browser;
let page: Page;
beforeAll(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
afterAll(async () => browser.close());

describe("Playwright surface observation and targeting", () => {
  it("reports accessible roles and labels that the executor can resolve", async () => {
    await page.setContent(`<label for="member">Member Number</label><input id="member"><input name="Unassociated Name">`);
    const surface = new PlaywrightSurface(page); const observation = await surface.observe();
    expect(observation.controls).toContainEqual(expect.objectContaining({ role: "textbox", name: "Member Number", tag: "input", frame: [] }));
    expect(observation.controls).toContainEqual(expect.objectContaining({ role: "textbox", name: "", tag: "input", frame: [] }));
    await surface.execute({ id: "fill", action: "fill", target: { strategy: "label", value: "Member Number", fallback: [], rationale: "same accessible label as observation" }, value: { source: "literal", value: "67890" }, risk: "safe", timeoutMs: 1000, retries: 0 }, "67890");
    expect(await page.locator("#member").inputValue()).toBe("67890");
  });

  it("represents a frame path and reuses it for deterministic execution", async () => {
    await page.setContent(`<iframe id="member-frame" srcdoc='<label for="member">Member Number</label><input id="member">'></iframe>`);
    await page.frameLocator("#member-frame").getByLabel("Member Number").waitFor();
    const surface = new PlaywrightSurface(page); const observation = await surface.observe();
    const framed = observation.controls.find(control => control.name === "Member Number");
    expect(framed?.frame).toEqual(['[id="member-frame"]']);
    await surface.execute({ id: "fill-frame", action: "fill", target: { strategy: "label", value: "Member Number", frame: framed?.frame, fallback: [], rationale: "observed inside named frame" }, value: { source: "literal", value: "12345" }, risk: "safe", timeoutMs: 1000, retries: 0 }, "12345");
    expect(await page.frameLocator("#member-frame").getByLabel("Member Number").inputValue()).toBe("12345");
  });

  it("redacts tagged sensitive text before producing an observation", async () => {
    await page.setContent(`<div role="alert" data-sensitive>LEAK-CANARY-9191</div><button data-sensitive>LEAK-CANARY-9191</button>`);
    const observation = await new PlaywrightSurface(page).observe();
    expect(JSON.stringify(observation)).not.toContain("LEAK-CANARY-9191"); expect(observation.alerts).toEqual(["[REDACTED]"]);
  });

  it("exposes stable extraction targets without exposing their values", async () => {
    await page.setContent(`<table><tr><th>Savings Balance</th><td id="balance" data-automation-field="balance">$9,999.99</td></tr></table>`);
    const observation = await new PlaywrightSurface(page).observe();
    expect(observation.extractables).toEqual([{ name: "Savings Balance", target: { strategy: "css", value: "#balance", name: "", frame: [], logicalTarget: "balance", fallback: [], rationale: "Application-declared extractable field" }, value: "[REDACTED]" }]);
    expect(JSON.stringify(observation)).not.toContain("$9,999.99");
  });
});
