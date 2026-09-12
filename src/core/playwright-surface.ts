import type { Locator, Step } from "./schema.js";
import type { Locator as PwLocator, Page } from "@playwright/test";

export class PlaywrightSurface {
  constructor(readonly page: Page) {}

  private async frame(locator: Locator) {
    let scope: Page | ReturnType<Page["frameLocator"]> = this.page;
    for (const selector of locator.frame ?? []) scope = scope.frameLocator(selector);
    return scope;
  }

  private async candidate(locator: Locator): Promise<PwLocator> {
    const scope = await this.frame(locator);
    switch (locator.strategy) {
      case "role": return scope.getByRole(locator.value as never, locator.name ? { name: locator.name } : undefined);
      case "label": return scope.getByLabel(locator.value);
      case "text": return scope.getByText(locator.value, { exact: true });
      case "css": return scope.locator(locator.value);
      case "coordinates": throw new Error("Coordinate locator requires direct action");
    }
    throw new Error(`Unsupported locator strategy: ${locator.strategy}`);
  }

  async resolve(locator: Locator): Promise<PwLocator> {
    const candidates = [locator, ...locator.fallback];
    for (const item of candidates) {
      if (item.strategy === "coordinates") continue;
      const candidate = await this.candidate(item);
      if (await candidate.count()) return candidate.first();
    }
    throw new Error(`No locator matched: ${locator.strategy}:${locator.value}`);
  }

  async execute(step: Step, value?: string): Promise<string | undefined> {
    if (step.action === "navigate") { await this.page.goto(value!); return; }
    if (step.action === "assert") return;
    if (!step.target) throw new Error(`Step ${step.id} requires a target`);
    if (step.target.strategy === "coordinates") {
      const [x, y] = step.target.value.split(",").map(Number);
      await this.page.mouse.click(x, y);
      return;
    }
    const target = await this.resolve(step.target);
    if (step.action === "click") await target.click({ timeout: step.timeoutMs });
    if (step.action === "fill") await target.fill(value!, { timeout: step.timeoutMs });
    if (step.action === "select") await target.selectOption(value!, { timeout: step.timeoutMs });
    if (step.action === "extract") return (await target.textContent())?.trim();
  }
}
