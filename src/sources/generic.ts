import { join } from "node:path";
import type { DetectionResult, LoadContext, RuntimeContext, UsageRecord, UsageSource } from "../types.js";
import { collectFiles, envPaths, existsDir, readJsonRecords, sessionFromPath } from "./fs.js";

interface GenericSourceOptions {
  name: string;
  envVar: string;
  defaultPaths: (home: string) => string[];
  extensions?: string[];
  fileFilter?: (path: string) => boolean;
  parser?: (source: string, raw: unknown, session: { sessionId?: string; projectPath?: string }, file: string, root: string) => UsageRecord | UsageRecord[] | undefined;
}

export class GenericJsonUsageSource implements UsageSource {
  readonly name: string;
  private readonly envVar: string;
  private readonly defaultPaths: (home: string) => string[];
  private readonly extensions: string[];
  private readonly fileFilter?: (path: string) => boolean;
  private readonly parser: NonNullable<GenericSourceOptions["parser"]>;

  constructor(options: GenericSourceOptions) {
    this.name = options.name;
    this.envVar = options.envVar;
    this.defaultPaths = options.defaultPaths;
    this.extensions = options.extensions ?? [".jsonl", ".json"];
    this.fileFilter = options.fileFilter;
    this.parser = options.parser ?? ((source, raw, session) => parseGenericUsage(source, raw, session));
  }

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const files = (await Promise.all((await this.paths(ctx)).map((root) => collectFiles(root, this.extensions)))).flat()
      .filter((path) => this.fileFilter?.(path) ?? true);
    return { detected: files.length > 0, paths: [...new Set(files)] };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const roots = await this.paths(ctx);
    const records: UsageRecord[] = [];
    for (const root of roots) {
      for (const file of (await collectFiles(root, this.extensions)).filter((path) => this.fileFilter?.(path) ?? true)) {
        const session = sessionFromPath(root, file);
        for (const raw of await readJsonRecords(file)) {
          const parsed = this.parser(this.name, raw, session, file, root);
          if (Array.isArray(parsed)) {
            records.push(...parsed);
          } else if (parsed) {
            records.push(parsed);
          }
        }
      }
    }
    return records;
  }

  private async paths(ctx: RuntimeContext): Promise<string[]> {
    const overridePaths = envPaths(ctx.env[this.envVar]);
    const candidates = overridePaths.length > 0 ? overridePaths : this.defaultPaths(ctx.homeDir);
    const found: string[] = [];
    for (const path of candidates) {
      if (await existsDir(path)) {
        found.push(path);
      }
    }
    return [...new Set(found)];
  }
}

export function parseGenericUsage(source: string, raw: unknown, session: { sessionId?: string; projectPath?: string } = {}): UsageRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const envelope = nestedObject(value, "data") ?? value;
  const messageHolder = nestedObject(envelope, "message") ?? envelope;
  const message = nestedObject(messageHolder, "message") ?? messageHolder;
  const usage = nestedObject(message, "usage") ?? nestedObject(envelope, "usage");
  const timestamp = stringValue(envelope.timestamp) ?? stringValue(messageHolder.timestamp) ?? stringValue(value.timestamp);
  if (!usage || !timestamp) {
    return undefined;
  }
  const model = stringValue(message.model) ?? stringValue(envelope.model) ?? stringValue(value.model);
  return {
    source,
    timestamp,
    messageId: stringValue(message.id),
    requestId: stringValue(envelope.requestId) ?? stringValue(messageHolder.requestId) ?? stringValue(value.requestId),
    sessionId: stringValue(envelope.sessionId) ?? stringValue(envelope.session_id) ?? session.sessionId,
    projectPath: stringValue(envelope.projectPath) ?? session.projectPath,
    model,
    inputTokens: numberValue(usage.input_tokens) ?? numberValue(usage.inputTokens) ?? numberValue(usage.prompt_tokens) ?? 0,
    outputTokens: numberValue(usage.output_tokens) ?? numberValue(usage.outputTokens) ?? numberValue(usage.completion_tokens) ?? 0,
    cacheCreationTokens: cacheCreationTokens(usage),
    cacheReadTokens: numberValue(usage.cache_read_input_tokens) ?? numberValue(usage.cacheReadTokens) ?? numberValue(usage.cached_input_tokens) ?? 0,
    costUSD: positiveNumber(envelope.costUSD) ?? positiveNumber(envelope.cost_usd),
    versions: stringValue(envelope.version) ? [stringValue(envelope.version) as string] : undefined,
    sourceMetadata: {
      isSidechain: booleanValue(envelope.isSidechain) ?? booleanValue(messageHolder.isSidechain),
      isApiErrorMessage: booleanValue(envelope.isApiErrorMessage) ?? booleanValue(messageHolder.isApiErrorMessage)
    },
    metadata: { rawType: stringValue(value.type), speed: stringValue(usage.speed) }
  };
}

export function defaultSourcePath(home: string, ...parts: string[]): string[] {
  return [join(home, ...parts)];
}

function nestedObject(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const item = value[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function cacheCreationTokens(usage: Record<string, unknown>): number {
  const direct = numberValue(usage.cache_creation_input_tokens) ?? numberValue(usage.cacheCreationTokens);
  const breakdown = nestedObject(usage, "cache_creation");
  if (breakdown) {
    return (numberValue(breakdown.ephemeral_5m_input_tokens) ?? 0) + (numberValue(breakdown.ephemeral_1h_input_tokens) ?? 0);
  }
  return direct ?? 0;
}
