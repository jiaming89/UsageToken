import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { DetectionResult, LoadContext, RuntimeContext, UsageRecord, UsageSource } from "../types.js";
import { collectFiles, envPaths, existsDir, readJsonRecords } from "./fs.js";
import { parseOpenCodeMessage } from "./parsers.js";
import { queryRows, type SqliteRow } from "./sqlite.js";

type RootResolver = (home: string, env?: string) => string[];

export class HermesSource implements UsageSource {
  readonly name = "hermes";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const paths = await hermesDbPaths(ctx);
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const seen = new Set<string>();
    for (const dbPath of await hermesDbPaths(ctx)) {
      const rows = await queryRows(dbPath, `
        SELECT id, model, billing_provider, started_at, message_count, input_tokens,
               output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
               estimated_cost_usd, actual_cost_usd
        FROM sessions
        WHERE model IS NOT NULL AND TRIM(model) != ''
      `);
      for (const row of rows) {
        const record = hermesRow(row);
        if (!record || seen.has(record.sessionId ?? "")) continue;
        seen.add(record.sessionId ?? "");
        records.push(record);
      }
    }
    return records.sort(compareTimestamp);
  }
}

export class GooseSource implements UsageSource {
  readonly name = "goose";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const paths = await gooseDbPaths(ctx);
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const seen = new Set<string>();
    for (const dbPath of await gooseDbPaths(ctx)) {
      const rows = await queryRows(dbPath, `
        SELECT id, model_config_json, provider_name, created_at, total_tokens, input_tokens,
               output_tokens, accumulated_total_tokens, accumulated_input_tokens,
               accumulated_output_tokens
        FROM sessions
        WHERE model_config_json IS NOT NULL AND TRIM(model_config_json) != ''
      `);
      for (const row of rows) {
        const record = gooseRow(row);
        const key = `${dbPath}:${record?.sessionId ?? ""}`;
        if (!record || seen.has(key)) continue;
        seen.add(key);
        records.push(record);
      }
    }
    return records.sort(compareTimestamp);
  }
}

export class KiloSource implements UsageSource {
  readonly name = "kilo";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const paths = await kiloDbPaths(ctx);
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const seen = new Set<string>();
    for (const dbPath of await kiloDbPaths(ctx)) {
      for (const row of await queryRows(dbPath, "SELECT id, session_id, data FROM message")) {
        const record = kiloRow(row, dbPath);
        const id = record?.messageId;
        if (!record || (id && seen.has(id))) continue;
        if (id) seen.add(id);
        records.push(record);
      }
    }
    return records.sort(compareTimestamp);
  }
}

export class OpenCodeSource implements UsageSource {
  readonly name = "opencode";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const roots = await existingRoots(ctx, "OPENCODE_DATA_DIR", (home) => [join(home, ".local", "share", "opencode")]);
    const paths: string[] = [];
    for (const root of roots) {
      const dbPath = await opencodeDbPath(root);
      if (dbPath) {
        paths.push(dbPath);
      }
      paths.push(...await collectFiles(join(root, "storage", "message"), [".json"]));
    }
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const globalSeen = new Set<string>();
    for (const root of await existingRoots(ctx, "OPENCODE_DATA_DIR", (home) => [join(home, ".local", "share", "opencode")])) {
      const localSeen = new Set<string>();
      const dbPath = await opencodeDbPath(root);
      if (dbPath) {
        for (const row of await queryRows(dbPath, "SELECT id, session_id, data FROM message")) {
          const raw = parseJson(stringValue(row.data));
          const record = parseOpenCodeMessage("opencode", raw, { sessionId: stringValue(row.session_id), projectPath: "OpenCode" }, { messageId: stringValue(row.id) });
          const id = record?.messageId;
          if (!record || (id && (localSeen.has(id) || globalSeen.has(id)))) continue;
          if (id) {
            localSeen.add(id);
            globalSeen.add(id);
          }
          records.push(record);
        }
      }

      const files = await collectFiles(join(root, "storage", "message"), [".json"]);
      for (const file of files.filter((file) => !localSeen.has(basename(file, extname(file))))) {
        for (const raw of await readJsonRecords(file)) {
          const record = parseOpenCodeMessage("opencode", raw, { sessionId: basename(file, extname(file)), projectPath: "OpenCode" });
          const id = record?.messageId;
          if (!record || (id && globalSeen.has(id))) continue;
          if (id) globalSeen.add(id);
          records.push(record);
        }
      }
    }
    return records.sort(compareTimestamp);
  }
}

export class AntigravitySource implements UsageSource {
  readonly name = "antigravity";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const roots = await existingRoots(ctx, "ANTIGRAVITY_DATA_DIR", (home) => [join(home, ".gemini", "antigravity-cli", "conversations")]);
    const paths: string[] = [];
    for (const root of roots) {
      paths.push(...await collectFiles(root, [".db", ".sqlite", ".sqlite3"]));
    }
    return { detected: paths.length > 0, paths };
  }

  async load(_ctx: LoadContext): Promise<UsageRecord[]> {
    return [];
  }
}

async function hermesDbPaths(ctx: RuntimeContext): Promise<string[]> {
  const homes = envPaths(ctx.env.HERMES_HOME);
  const roots = homes.length > 0 ? homes : [join(ctx.homeDir, ".hermes")];
  return existingFiles(roots.map((root) => join(root, "state.db")));
}

async function gooseDbPaths(ctx: RuntimeContext): Promise<string[]> {
  const override = ctx.env.GOOSE_PATH_ROOT?.trim();
  const candidates = override
    ? [join(override, "data", "sessions", "sessions.db")]
    : [
        join(ctx.homeDir, ".local", "share", "goose", "sessions", "sessions.db"),
        join(ctx.homeDir, "Library", "Application Support", "goose", "sessions", "sessions.db"),
        join(ctx.homeDir, ".local", "share", "Block", "goose", "sessions", "sessions.db")
      ];
  return existingFiles(candidates);
}

async function kiloDbPaths(ctx: RuntimeContext): Promise<string[]> {
  const roots = await existingRoots(ctx, "KILO_DATA_DIR", (home) => [join(home, ".local", "share", "kilo")]);
  return existingFiles(roots.map((root) => join(root, "kilo.db")));
}

async function existingRoots(ctx: RuntimeContext, envVar: string, defaults: RootResolver): Promise<string[]> {
  const override = envPaths(ctx.env[envVar]);
  const candidates = override.length > 0 ? override : defaults(ctx.homeDir, ctx.env[envVar]);
  const found: string[] = [];
  for (const candidate of candidates) {
    if (await existsDir(candidate)) found.push(candidate);
  }
  return [...new Set(found)];
}

async function existingFiles(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    try {
      if ((await stat(path)).isFile()) found.push(path);
    } catch {
      // ignore absent source
    }
  }
  return [...new Set(found)];
}

async function opencodeDbPath(root: string): Promise<string | undefined> {
  const defaultPath = join(root, "opencode.db");
  if ((await existingFiles([defaultPath])).length > 0) return defaultPath;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  return entries
    .filter((entry) => entry.isFile() && /^opencode-[A-Za-z0-9_-]+\.db$/u.test(entry.name))
    .map((entry) => join(root, entry.name))
    .sort()[0];
}

function hermesRow(row: SqliteRow): UsageRecord | undefined {
  const sessionId = stringValue(row.id);
  const model = stringValue(row.model)?.trim();
  const startedAt = numberValue(row.started_at);
  if (!sessionId || !model || startedAt == null) return undefined;
  const timestamp = timestampFromNumber(startedAt);
  if (!timestamp) return undefined;
  const inputTokens = nonNegativeInt(row.input_tokens);
  const outputTokens = nonNegativeInt(row.output_tokens);
  const cacheReadTokens = nonNegativeInt(row.cache_read_tokens);
  const cacheCreationTokens = nonNegativeInt(row.cache_write_tokens);
  const extraTotalTokens = nonNegativeInt(row.reasoning_tokens);
  const costUSD = positiveNumber(row.actual_cost_usd) ?? positiveNumber(row.estimated_cost_usd);
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + extraTotalTokens === 0 && (costUSD ?? 0) === 0) return undefined;
  return {
    source: "hermes",
    timestamp,
    sessionId,
    messageId: `hermes:${sessionId}`,
    projectPath: "Hermes",
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    extraTotalTokens,
    costUSD,
    messageCount: nonNegativeInt(row.message_count),
    sourceMetadata: { provider: normalizeHermesProvider(stringValue(row.billing_provider), model) }
  };
}

function gooseRow(row: SqliteRow): UsageRecord | undefined {
  const sessionId = stringValue(row.id);
  const model = parseModelConfig(stringValue(row.model_config_json));
  const timestamp = parseGooseTimestamp(row.created_at);
  if (!sessionId || !model || !timestamp) return undefined;
  const inputTokens = positiveInt(row.accumulated_input_tokens) ?? positiveInt(row.input_tokens) ?? 0;
  const outputTokens = positiveInt(row.accumulated_output_tokens) ?? positiveInt(row.output_tokens) ?? 0;
  const totalTokens = positiveInt(row.accumulated_total_tokens) ?? positiveInt(row.total_tokens) ?? inputTokens + outputTokens;
  if (inputTokens + outputTokens + totalTokens === 0) return undefined;
  return {
    source: "goose",
    timestamp,
    sessionId,
    messageId: sessionId,
    projectPath: "Goose",
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    extraTotalTokens: Math.max(0, totalTokens - inputTokens - outputTokens),
    sourceMetadata: { provider: normalizeGooseProvider(stringValue(row.provider_name), model) }
  };
}

function kiloRow(row: SqliteRow, dbPath: string): UsageRecord | undefined {
  const value = parseJson(stringValue(row.data));
  if (!value || objectValue(value).role !== "assistant") return undefined;
  const tokens = objectValue(objectValue(value).tokens);
  const time = objectValue(objectValue(value).time);
  const model = stringValue(objectValue(value).modelID);
  const timestamp = timestampFromNumber(numberValue(time.created));
  if (!model || !timestamp) return undefined;
  const cache = objectValue(tokens.cache);
  const inputTokens = nonNegativeInt(tokens.input);
  const outputTokens = nonNegativeInt(tokens.output);
  const cacheCreationTokens = nonNegativeInt(cache.write);
  const cacheReadTokens = nonNegativeInt(cache.read);
  const reasoningTokens = nonNegativeInt(tokens.reasoning);
  const totalTokens = nonNegativeInt(tokens.total);
  const extraTotalTokens = reasoningTokens + Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens - cacheReadTokens - reasoningTokens);
  if (inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + extraTotalTokens === 0) return undefined;
  const messageId = stringValue(objectValue(value).id) ?? `${dbPath}:${stringValue(row.id) ?? ""}`;
  return {
    source: "kilo",
    timestamp,
    messageId,
    sessionId: stringValue(objectValue(value).session_id) ?? stringValue(row.session_id),
    projectPath: "Kilo",
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    extraTotalTokens,
    costUSD: positiveNumber(objectValue(value).cost),
    sourceMetadata: { provider: stringValue(objectValue(value).providerID) }
  };
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseModelConfig(value: string | undefined): string | undefined {
  const parsed = parseJson(value);
  return stringValue(objectValue(parsed).model_name);
}

function parseGooseTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") return timestampFromNumber(value);
  const text = stringValue(value)?.trim();
  if (!text) return undefined;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) return timestampFromNumber(asNumber);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/u.test(text)) {
    const normalized = `${text.slice(0, 10)}T${text.slice(11)}Z`;
    const millis = Date.parse(normalized);
    return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    return `${text}T00:00:00.000Z`;
  }
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  return undefined;
}

function timestampFromNumber(value: number | undefined): string | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  const millis = value > 1_000_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
  return new Date(millis).toISOString();
}

function compareTimestamp(a: UsageRecord, b: UsageRecord): number {
  return a.timestamp.localeCompare(b.timestamp);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

function nonNegativeInt(value: unknown): number {
  const numeric = numberValue(value);
  return numeric != null && numeric > 0 ? Math.trunc(numeric) : 0;
}

function positiveInt(value: unknown): number | undefined {
  const out = nonNegativeInt(value);
  return out > 0 ? out : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const numeric = numberValue(value);
  return numeric != null && numeric >= 0 ? numeric : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = nonNegativeNumber(value);
  return numeric != null && numeric > 0 ? numeric : undefined;
}

function normalizeHermesProvider(value: string | undefined, model: string): string {
  const normalized = value?.trim().toLowerCase().replace(/-/gu, "_");
  if (!normalized) {
    const lower = model.toLowerCase();
    if (lower.startsWith("claude-") || lower.startsWith("claude/")) return "anthropic";
    if (lower.startsWith("gpt") || lower.startsWith("chatgpt") || /^o\d/u.test(lower)) return "openai";
    if (lower.startsWith("gemini-") || lower.startsWith("gemini/")) return "google";
    return "hermes";
  }
  if (["anthropic", "claude"].includes(normalized)) return "anthropic";
  if (["openai", "openai_codex"].includes(normalized)) return "openai";
  if (["google", "google_ai", "gemini", "vertex", "vertex_ai"].includes(normalized)) return "google";
  return normalized;
}

function normalizeGooseProvider(value: string | undefined, model: string): string {
  const provider = value?.trim();
  if (provider) return provider.replace(/-/gu, "_");
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("chatgpt-") || model.startsWith("o")) return "openai";
  if (model.startsWith("gemini-")) return "google";
  if (model.toLowerCase().startsWith("qwen")) return "openrouter";
  return "goose";
}
