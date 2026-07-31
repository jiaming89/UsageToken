import { stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DetectionResult, LoadContext, RuntimeContext, UsageRecord, UsageSource } from "../types.js";
import { collectFiles, envPaths, existsDir, readJsonRecords } from "./fs.js";
import { parseCopilot as parseCopilotOtel } from "./parsers.js";

export class CopilotSource implements UsageSource {
  readonly name = "copilot";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const paths = await this.paths(ctx);
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const sessionStateRecords = await this.loadSessionState(ctx);
    const otelRecords = await this.loadExplicitOtel(ctx);
    return dedupeCombined([...sessionStateRecords, ...otelRecords]);
  }

  private async paths(ctx: RuntimeContext): Promise<string[]> {
    const [sessionStateFiles, otelFiles] = await Promise.all([
      sessionStateEventFiles(ctx),
      explicitOtelFiles(ctx)
    ]);
    return [...new Set([...sessionStateFiles, ...otelFiles])].sort();
  }

  private async loadSessionState(ctx: RuntimeContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    for (const file of await sessionStateEventFiles(ctx)) {
      records.push(...parseSessionStateFile(await readJsonRecords(file), basename(dirname(file))));
    }
    return records;
  }

  private async loadExplicitOtel(ctx: RuntimeContext): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    for (const file of await explicitOtelFiles(ctx)) {
      const session = { sessionId: basename(file).replace(/\.(jsonl|json)$/u, ""), projectPath: "GitHub Copilot CLI" };
      for (const raw of await readJsonRecords(file)) {
        const parsed = parseCopilotOtel(this.name, raw, session);
        if (parsed) {
          records.push(parsed);
        }
      }
    }
    return records;
  }
}

function parseSessionStateFile(events: unknown[], fallbackSessionId: string): UsageRecord[] {
  const records: UsageRecord[] = parseShutdownMetrics(events, fallbackSessionId);
  const seen = new Set<string>();
  const fallbackModel = firstModelHint(events);
  let currentModel: string | undefined;

  for (const raw of events) {
    const event = object(raw);
    if (!event) continue;
    const data = object(event.data);
    const type = string(event.type);

    if (type === "session.model_change") {
      currentModel = string(data?.newModel) ?? currentModel;
      continue;
    }
    currentModel = string(data?.model) ?? string(data?.currentModel) ?? string(event.currentModel) ?? currentModel;

    if (type !== "assistant.message" || !data) continue;
    const timestamp = string(event.timestamp);
    const outputTokens = number(data.outputTokens);
    if (!timestamp || outputTokens == null || outputTokens <= 0) continue;

    const messageId = string(data.messageId) ?? string(event.id);
    const requestId = string(data.serviceRequestId) ?? string(data.requestId);
    const dedupeKey = `${messageId ?? ""}\u0000${requestId ?? ""}\u0000${outputTokens}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    records.push({
      source: "copilot",
      timestamp,
      sessionId: string(data.sessionId) ?? fallbackSessionId,
      messageId,
      requestId,
      projectPath: "GitHub Copilot CLI",
      model: string(data.model) ?? currentModel ?? fallbackModel ?? "unknown",
      inputTokens: 0,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      metadata: {
        interactionId: string(data.interactionId),
        turnId: string(data.turnId),
        eventType: "session-state"
      }
    });
  }

  return records;
}

function parseShutdownMetrics(events: unknown[], fallbackSessionId: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  const previousByModel = new Map<string, MetricSnapshot>();
  const shutdownEvents = events
    .map((raw) => object(raw))
    .filter((event): event is Record<string, unknown> => Boolean(event && string(event.type) === "session.shutdown" && string(event.timestamp)))
    .sort((a, b) => (string(a.timestamp) ?? "").localeCompare(string(b.timestamp) ?? ""));

  for (const event of shutdownEvents) {
    const data = object(event.data);
    const timestamp = string(event.timestamp);
    const modelMetrics = object(data?.modelMetrics);
    if (!timestamp) continue;

    const sessionId = string(data?.sessionId) ?? fallbackSessionId;
    const metrics: Array<[string, unknown]> = modelMetrics && Object.keys(modelMetrics).length > 0
      ? Object.entries(modelMetrics)
      : [[string(data?.currentModel) ?? string(event.currentModel) ?? "unknown", { tokenDetails: data?.tokenDetails, requests: { count: data?.totalPremiumRequests ?? 0, cost: data?.totalPremiumRequests ?? 0 } }]];

    for (const [model, rawMetric] of metrics) {
      const metric = object(rawMetric);
      if (!metric) continue;
      const current = metricSnapshot(metric);
      const previous = previousByModel.get(model);
      previousByModel.set(model, current);

      const inputTokens = delta(current.inputTokens, previous?.inputTokens);
      const cacheReadTokens = delta(current.cacheReadTokens, previous?.cacheReadTokens);
      const cacheCreationTokens = delta(current.cacheCreationTokens, previous?.cacheCreationTokens);
      const extraTotalTokens = delta(current.extraTotalTokens, previous?.extraTotalTokens);
      const credits = delta(current.credits, previous?.credits);
      const messageCount = delta(current.messageCount, previous?.messageCount);
      if (inputTokens + cacheReadTokens + cacheCreationTokens + extraTotalTokens + credits + messageCount === 0) continue;
      const requests = object(metric?.requests);

      records.push({
        source: "copilot",
        timestamp,
        sessionId,
        messageId: `copilot-session-state:${sessionId}:${model}:${timestamp}`,
        projectPath: "GitHub Copilot CLI",
        model,
        inputTokens,
        outputTokens: 0,
        cacheCreationTokens,
        cacheReadTokens,
        extraTotalTokens,
        credits,
        messageCount,
        metadata: {
          eventType: "session-state-shutdown",
          totalPremiumRequests: nonNegativeNumber(data?.totalPremiumRequests),
          totalApiDurationMs: nonNegativeNumber(data?.totalApiDurationMs),
          cumulativeOutputTokens: current.outputTokens,
          cumulativeInputTokens: current.inputTokens,
          cumulativeCacheReadTokens: current.cacheReadTokens,
          cumulativeCacheCreationTokens: current.cacheCreationTokens,
          cumulativeReasoningTokens: current.extraTotalTokens,
          cumulativeMessageCount: current.messageCount,
          cumulativeCredits: current.credits,
          requestCountDelta: requests ? messageCount : undefined
        }
      });
    }
  }

  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || (a.model ?? "").localeCompare(b.model ?? ""));
}

interface MetricSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  extraTotalTokens: number;
  credits: number;
  messageCount: number;
}

function metricSnapshot(metric: Record<string, unknown>): MetricSnapshot {
  const usage = object(metric.usage);
  const details = object(metric.tokenDetails);
  const cacheReadTokens = tokenDetail(details, "cache_read") ?? nonNegativeNumber(usage?.cacheReadTokens);
  const cacheCreationTokens = tokenDetail(details, "cache_write") ?? nonNegativeNumber(usage?.cacheWriteTokens);
  const rawInputTokens = nonNegativeNumber(usage?.inputTokens);
  const inputTokens = tokenDetail(details, "input") ?? Math.max(0, rawInputTokens - cacheReadTokens - cacheCreationTokens);
  const outputTokens = tokenDetail(details, "output") ?? nonNegativeNumber(usage?.outputTokens);
  const requests = object(metric.requests);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    extraTotalTokens: nonNegativeNumber(usage?.reasoningTokens),
    credits: nonNegativeNumber(requests?.cost),
    messageCount: nonNegativeNumber(requests?.count)
  };
}

function tokenDetail(details: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!details) return undefined;
  const value = nonNegativeNumber(object(details[key])?.tokenCount);
  return value > 0 ? value : 0;
}

function delta(current: number, previous = 0): number {
  return Math.max(0, current - previous);
}

function firstModelHint(events: unknown[]): string | undefined {
  for (const raw of events) {
    const event = object(raw);
    const data = object(event?.data);
    const model = string(data?.model) ?? string(data?.newModel) ?? string(data?.currentModel) ?? string(event?.currentModel);
    if (model) return model;
  }
  return undefined;
}

async function sessionStateEventFiles(ctx: RuntimeContext): Promise<string[]> {
  const overrideRoots = envPaths(ctx.env.COPILOT_SESSION_STATE_DIR);
  const roots = overrideRoots.length > 0 ? overrideRoots : [join(ctx.homeDir, ".copilot", "session-state")];
  const files = await Promise.all(roots.map(async (root) => {
    if (await isFile(root)) {
      return basename(root) === "events.jsonl" ? [root] : [];
    }
    if (!(await existsDir(root))) {
      return [];
    }
    return (await collectFiles(root, [".jsonl"])).filter((file) => basename(file) === "events.jsonl");
  }));
  return [...new Set(files.flat())].sort();
}

async function explicitOtelFiles(ctx: RuntimeContext): Promise<string[]> {
  const candidates = envPaths(ctx.env.COPILOT_OTEL_FILE_EXPORTER_PATH);
  if (candidates.length === 0) {
    return [];
  }
  const files = await Promise.all(candidates.map(async (candidate) => {
    if (await isFile(candidate)) {
      return extname(candidate) === ".jsonl" || extname(candidate) === ".json" ? [candidate] : [];
    }
    if (!(await existsDir(candidate))) {
      return [];
    }
    return collectFiles(candidate, [".jsonl", ".json"]);
  }));
  return [...new Set(files.flat())].sort();
}

function dedupeCombined(records: UsageRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  const byIdentity = new Map<string, number>();

  for (const record of records) {
    const keys = identityKeys(record);
    if (keys.length === 0) {
      out.push(record);
      continue;
    }
    const existingIndex = keys.map((key) => byIdentity.get(key)).find((index) => index != null);
    if (existingIndex == null) {
      for (const key of keys) {
        byIdentity.set(key, out.length);
      }
      out.push(record);
      continue;
    }
    const existing = out[existingIndex];
    if (!existing || tokenCompleteness(record) > tokenCompleteness(existing)) {
      out[existingIndex] = record;
    }
    for (const key of keys) {
      byIdentity.set(key, existingIndex);
    }
  }

  return out;
}

function identityKeys(record: UsageRecord): string[] {
  return [
    record.messageId ? `message:${record.messageId}` : undefined,
    record.requestId ? `request:${record.requestId}` : undefined
  ].filter((key): key is string => key != null);
}

function tokenCompleteness(record: UsageRecord): number {
  return [
    record.inputTokens,
    record.outputTokens,
    record.cacheCreationTokens,
    record.cacheReadTokens,
    record.extraTotalTokens ?? 0
  ].filter((value) => value > 0).length;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = number(value);
  return parsed != null && parsed > 0 ? parsed : 0;
}
