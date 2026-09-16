import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "./redact.js";

export class EvidenceWriter {
  readonly directory: string;
  private readonly sensitiveValues = new Set<string>();
  constructor(readonly runId: string, root = "evidence/runs", sensitiveValues: readonly string[] = []) {
    this.directory = path.resolve(root, runId);
    this.addSensitiveValues(sensitiveValues);
  }
  addSensitiveValues(values: readonly unknown[]): void { for (const value of values) if (typeof value === "string" && value) this.sensitiveValues.add(value); }
  sanitize<T>(value: T): T { return redact(value, "", [...this.sensitiveValues]) as T; }
  async init(): Promise<void> { await mkdir(this.directory, { recursive: true }); }
  async manifest(value: Record<string, unknown>): Promise<void> {
    await writeFile(path.join(this.directory, "manifest.json"), JSON.stringify(this.sanitize(value), null, 2) + "\n");
  }
  async event(event: Record<string, unknown>): Promise<void> {
    await appendFile(path.join(this.directory, "events.jsonl"), JSON.stringify(this.sanitize({ at: new Date().toISOString(), ...event })) + "\n");
  }
  async result(result: unknown): Promise<void> {
    await writeFile(path.join(this.directory, "result.json"), JSON.stringify(this.sanitize(result), null, 2) + "\n");
  }
  path(...parts: string[]): string { return path.join(this.directory, ...parts); }
  async ensure(...parts: string[]): Promise<string> {
    const target = this.path(...parts); await mkdir(target, { recursive: true }); return target;
  }
}
