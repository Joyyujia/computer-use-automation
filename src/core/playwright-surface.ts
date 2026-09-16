import type { Locator, Step } from "./schema.js";
import type { Frame, Locator as PwLocator, Page } from "@playwright/test";
import type { Observation } from "./observation.js";

export class PlaywrightSurface {
  private unexpectedDialogType?: string;
  constructor(readonly page: Page, private readonly canAutomationAct: () => boolean = () => true) {
    page.on("dialog", async dialog => { this.unexpectedDialogType = dialog.type(); await dialog.dismiss().catch(() => undefined); });
  }

  private ensureNoUnexpectedDialog(): void {
    if (!this.unexpectedDialogType) return;
    const type = this.unexpectedDialogType; this.unexpectedDialogType = undefined;
    throw new Error(`UNEXPECTED_DIALOG: application opened a ${type} dialog`);
  }

  private sanitizedUrl(raw: string): string {
    try { const url = new URL(raw); for (const key of url.searchParams.keys()) url.searchParams.set(key, "[REDACTED]"); return url.toString(); }
    catch { return raw.split("?", 1)[0]; }
  }

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
      const count = await candidate.count();
      if (count === 0) continue;
      if (count > 1) throw new Error(`Ambiguous locator matched ${count} elements: ${item.strategy}:${item.value}`);
      if (!await candidate.isVisible()) throw new Error(`Locator matched a hidden element: ${item.strategy}:${item.value}`);
      return candidate;
    }
    throw new Error(`No locator matched: ${locator.strategy}:${locator.value}`);
  }

  async execute(step: Step, value?: string): Promise<string | undefined> {
    if (!this.canAutomationAct()) throw new Error("Control conflict: automation does not own the session");
    this.ensureNoUnexpectedDialog();
    if (step.action === "navigate") { await this.page.goto(value!); this.ensureNoUnexpectedDialog(); return; }
    if (step.action === "assert") return;
    if (!step.target) throw new Error(`Step ${step.id} requires a target`);
    if (step.target.strategy === "coordinates") {
      const [x, y] = step.target.value.split(",").map(Number);
      await this.page.mouse.click(x, y);
      return;
    }
    const target = await this.resolve(step.target);
    if (["click", "fill", "select"].includes(step.action) && !await target.isEnabled()) throw new Error(`Target is not enabled: ${step.target.strategy}:${step.target.value}`);
    if (step.action === "fill" && !await target.isEditable()) throw new Error(`Target is not editable: ${step.target.strategy}:${step.target.value}`);
    if (step.action === "click") await target.click({ timeout: step.timeoutMs });
    if (step.action === "fill") await target.fill(value!, { timeout: step.timeoutMs });
    if (step.action === "select") await target.selectOption(value!, { timeout: step.timeoutMs });
    if (step.action === "extract") { const result = (await target.textContent())?.trim(); this.ensureNoUnexpectedDialog(); return result; }
    this.ensureNoUnexpectedDialog();
  }

  private async framePath(frame: Frame): Promise<string[]> {
    const path: string[] = [];
    let current: Frame | null = frame;
    while (current?.parentFrame()) {
      const element = await current.frameElement();
      const selector = await element.evaluate((node) => {
        const frameElement = node as Element;
        const id = frameElement.getAttribute("id"); if (id) return `[id=${JSON.stringify(id)}]`;
        const name = frameElement.getAttribute("name"); if (name) return `${frameElement.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`;
        const tag = frameElement.tagName.toLowerCase(); const siblings = Array.from(frameElement.parentElement?.children ?? []).filter(candidate => candidate.tagName === frameElement.tagName);
        return `${tag}:nth-of-type(${siblings.indexOf(frameElement) + 1})`;
      });
      path.unshift(selector); current = current.parentFrame();
    }
    return path;
  }

  private async snapshot(scope: Page | Frame, frame: string[]) {
    return scope.locator("body").evaluate((body, framePath) => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el as HTMLElement);
        const rect = (el as HTMLElement).getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const semanticRole = (el: Element) => {
        const explicit = el.getAttribute("role"); if (explicit) return explicit;
        if (el instanceof HTMLButtonElement) return "button";
        if (el instanceof HTMLAnchorElement && el.hasAttribute("href")) return "link";
        if (el instanceof HTMLSelectElement) return "combobox";
        if (el instanceof HTMLTextAreaElement) return "textbox";
        if (el instanceof HTMLInputElement) return ["button","submit","reset"].includes(el.type) ? "button" : el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "textbox";
        return "";
      };
      const controls = Array.from(body.querySelectorAll("button,input,select,textarea,a,[role]"))
        .filter(visible).slice(0, 50).map((el) => ({
          role: semanticRole(el),
          name: el.matches("[data-sensitive]") || el.querySelector("[data-sensitive]") ? "[REDACTED]" : el.getAttribute("aria-label") || (el instanceof HTMLInputElement ? el.labels?.[0]?.textContent?.trim() : undefined) || (el.textContent ?? "").trim() || "",
          tag: el.tagName.toLowerCase(), type: el.getAttribute("type") ?? undefined,
          disabled: (el as HTMLInputElement).disabled === true,
          value: el instanceof HTMLInputElement && el.value ? "[PRESENT]" : undefined,
          frame: framePath
        }));
      const alerts = Array.from(body.querySelectorAll("[role=alert]"))
        .filter(visible).map((el) => el.matches("[data-sensitive]") || el.querySelector("[data-sensitive]") ? "[REDACTED]" : (el.textContent ?? "").trim()).filter(Boolean);
      const text: string[] = []; const redacted = new Set<Element>();
      const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement; if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName) || !visible(parent)) continue;
        const sensitive = parent.closest("[data-sensitive]");
        if (sensitive) { if (!redacted.has(sensitive)) { text.push("[REDACTED]"); redacted.add(sensitive); } continue; }
        const value = node.textContent?.replace(/\s+/g, " ").trim(); if (value) text.push(value);
      }
      return { visibleText: text.join("\n").slice(0, 8000), controls, alerts };
    }, frame);
  }

  async observe(screenshotPath?: string): Promise<Observation> {
    if (screenshotPath) await this.page.screenshot({ path: screenshotPath, fullPage: true });
    const snapshot = await this.snapshot(this.page, []);
    const childSnapshots: Array<{ path: string[]; url: string; title: string; visibleText: string; controls: Observation["controls"]; alerts: string[] }> = [];
    for (const frame of this.page.frames().filter(candidate => candidate !== this.page.mainFrame())) {
      try { const framePath = await this.framePath(frame); childSnapshots.push({ path: framePath, url: this.sanitizedUrl(frame.url()), title: await frame.title(), ...await this.snapshot(frame, framePath) }); }
      catch { /* A detached or inaccessible frame is omitted from this observation. */ }
    }
    const visibleText = [snapshot.visibleText, ...childSnapshots.map(frame => `[Frame ${frame.path.join(" > ")}]\n${frame.visibleText}`)].filter(Boolean).join("\n").slice(0, 8000);
    return { url: this.sanitizedUrl(this.page.url()), title: await this.page.title(), visibleText, controls: [...snapshot.controls, ...childSnapshots.flatMap(frame => frame.controls)], alerts: [...snapshot.alerts, ...childSnapshots.flatMap(frame => frame.alerts)], frames: childSnapshots.map(({ path, url: frameUrl, title }) => ({ path, url: frameUrl, title })), screenshotPath };
  }

  async matches(assertion: import("./schema.js").Capability["checkpoint"], inputs: Record<string, unknown>): Promise<boolean> {
    const expected = assertion.expected?.source === "literal" ? assertion.expected.value : assertion.expected?.source === "input" ? String(inputs[assertion.expected.key] ?? "") : undefined;
    try {
      if (assertion.kind === "url") return this.page.url() === expected;
      if (!assertion.locator) return false;
      const target = await this.resolve(assertion.locator);
      if (assertion.kind === "visible") return target.isVisible();
      return expected !== undefined && ((await target.textContent())?.trim() === expected);
    } catch { return false; }
  }
}
