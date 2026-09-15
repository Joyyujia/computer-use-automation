import type { Locator, Step } from "./schema.js";
import type { Locator as PwLocator, Page } from "@playwright/test";
import type { Observation } from "./observation.js";

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

  async observe(screenshotPath?: string): Promise<Observation> {
    if (screenshotPath) await this.page.screenshot({ path: screenshotPath, fullPage: true });
    const snapshot = await this.page.locator("body").evaluate((body) => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el as HTMLElement);
        const rect = (el as HTMLElement).getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(body.querySelectorAll("button,input,select,textarea,a,[role]"))
        .filter(visible).slice(0, 50).map((el) => ({
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          name: el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.getAttribute("name") || "",
          tag: el.tagName.toLowerCase(), type: el.getAttribute("type") ?? undefined,
          disabled: (el as HTMLInputElement).disabled === true,
          value: el instanceof HTMLInputElement && el.value ? "[PRESENT]" : undefined
        }));
      const alerts = Array.from(body.querySelectorAll("[role=alert]"))
        .filter(visible).map((el) => (el.textContent ?? "").trim()).filter(Boolean);
      return { visibleText: ((body as HTMLElement).innerText ?? body.textContent ?? "").slice(0, 8000), controls, alerts };
    });
    return { url: this.page.url(), title: await this.page.title(), ...snapshot, screenshotPath };
  }

  async matches(assertion: import("./schema.js").Capability["checkpoint"], inputs: Record<string, unknown>): Promise<boolean> {
    const expected = assertion.expected.source === "literal" ? assertion.expected.value : String(inputs[assertion.expected.key] ?? "");
    try {
      if (assertion.kind === "url") return this.page.url() === expected;
      if (!assertion.locator) return false;
      const target = await this.resolve(assertion.locator);
      if (assertion.kind === "visible") return target.isVisible();
      return (await target.textContent())?.includes(expected) ?? false;
    } catch { return false; }
  }
}
