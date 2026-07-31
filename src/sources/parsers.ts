import { basename, dirname, relative } from "node:path";
import type { UsageRecord } from "../types.js";
import { parseGenericUsage } from "./generic.js";

export function parseOpenCode(source: string, raw: unknown, session: Session): UsageRecord | undefined {
  return parseOpenCodeMessage(source, raw, session);
}

export function parseOpenCodeMessage(source: string, raw: unknown, session: Session, overrides: { messageId?: string } = {}): UsageRecord | undefined {
  const value = object(raw);
  const tokens = object(value?.tokens);
  if (!value || !tokens) return parseGenericUsage(source, raw, session);
  const cache = object(tokens.cache);
  const timestamp = millisToIso(number(tokens.created) ?? number(object(value.time)?.created));
  const inputTokens = num(tokens.input);
  const outputTokens = num(tokens.output);
  const cacheCreationTokens = num(cache?.write);
  const cacheReadTokens = num(cache?.read);
  const totalTokens = num(tokens.total);
  const extraTotalTokens = Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens - cacheReadTokens);
  if (inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + extraTotalTokens === 0) return undefined;
  return {
    source,
    timestamp: timestamp ?? new Date(0).toISOString(),
    messageId: overrides.messageId ?? string(value.id),
    sessionId: string(value.sessionID) ?? string(value.sessionId) ?? session.sessionId,
    projectPath: "OpenCode",
    model: string(value.modelID) ?? string(value.model),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    extraTotalTokens,
    costUSD: positiveNumber(value.cost),
    sourceMetadata: { provider: string(value.providerID) }
  };
}

export function parseAmp(source: string, raw: unknown, session: Session): UsageRecord[] | UsageRecord | undefined {
  const thread = object(raw);
  if (!thread) return undefined;
  const threadId = string(thread.id) ?? session.sessionId;
  const ledgerEvents = array(object(thread.usageLedger)?.events);
  if (ledgerEvents.length > 0) {
    return ledgerEvents.flatMap((eventRaw) => {
      const event = object(eventRaw);
      const tokens = object(event?.tokens);
      const timestamp = string(event?.timestamp);
      if (!event || !tokens || !timestamp) return [];
      return [{
        source,
        timestamp,
        sessionId: threadId,
        projectPath: "Amp",
        model: string(event.model),
        inputTokens: num(tokens.input),
        outputTokens: num(tokens.output),
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        extraTotalTokens: Math.max(0, num(tokens.total) - num(tokens.input) - num(tokens.output)),
        metadata: { credits: number(event.credits) }
      }];
    });
  }
  return array(thread.messages).flatMap((messageRaw) => {
    const record = parseGenericUsage(source, messageRaw, { sessionId: threadId, projectPath: "Amp" });
    return record ? [record] : [];
  });
}

export function parseDroid(source: string, raw: unknown, _session: Session, file: string): UsageRecord | undefined {
  const settings = object(raw);
  const usage = object(settings?.tokenUsage);
  if (!settings || !usage) return undefined;
  const total = num(usage.totalTokens);
  const input = num(usage.inputTokens);
  const output = num(usage.outputTokens);
  const cacheCreate = num(usage.cacheCreationTokens);
  const cacheRead = num(usage.cacheReadTokens);
  const thinking = num(usage.thinkingTokens);
  return {
    source,
    timestamp: string(settings.providerLockTimestamp) ?? new Date(0).toISOString(),
    sessionId: basename(file).replace(/\.settings\.json$/u, ""),
    projectPath: "Droid",
    model: string(settings.model) ?? string(settings.providerLock) ?? "unknown",
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    extraTotalTokens: total > 0 ? Math.max(0, total - input - output - cacheCreate - cacheRead) : thinking
  };
}

export function parseCodebuff(source: string, raw: unknown, _session: Session, file: string): UsageRecord | undefined {
  const message = object(raw);
  if (!message) return undefined;
  const role = string(message.variant) ?? string(message.role);
  if (!["ai", "agent", "assistant"].includes(role ?? "")) return undefined;
  const metadata = object(message.metadata);
  const usage = object(metadata?.usage) ?? object(object(metadata?.codebuff)?.usage);
  const record = parseUsageObject(source, usage, {
    timestamp: string(message.timestamp) ?? string(message.createdAt) ?? new Date(0).toISOString(),
    sessionId: codebuffSession(file),
    projectPath: "Codebuff",
    model: string(metadata?.model)
  });
  if (record) record.metadata = { credits: number(message.credits) };
  return record;
}

export function parseGeminiLike(source: string, raw: unknown, session: Session): UsageRecord | undefined {
  const value = object(raw);
  const usage = object(value?.usageMetadata) ?? object(value?.usage_metadata);
  if (usage) {
    return {
      source,
      timestamp: string(value?.timestamp) ?? string(value?.createdAt) ?? new Date(0).toISOString(),
      sessionId: string(value?.sessionId) ?? string(value?.session_id) ?? session.sessionId,
      projectPath: session.projectPath ?? source,
      model: string(value?.model) ?? "unknown",
      inputTokens: num(usage.promptTokenCount) || num(usage.prompt_token_count),
      outputTokens: num(usage.candidatesTokenCount) || num(usage.candidates_token_count),
      cacheCreationTokens: 0,
      cacheReadTokens: num(usage.cachedContentTokenCount) || num(usage.cached_content_token_count),
      extraTotalTokens: num(usage.thoughtsTokenCount) || num(usage.thoughts_token_count)
    };
  }
  return parseGenericUsage(source, raw, session);
}

export function parseKimi(source: string, raw: unknown, session: Session): UsageRecord | undefined {
  const value = object(raw);
  if (!value) return undefined;
  const usage = object(value.usage) ?? object(value.token_usage);
  const scope = string(value.usageScope) ?? string(value.usage_scope);
  if (scope && scope !== "turn") return undefined;
  const timestamp = millisToIso(number(value.time)) ?? string(value.timestamp) ?? new Date(0).toISOString();
  return parseUsageObject(source, usage, {
    timestamp,
    sessionId: session.sessionId,
    projectPath: session.projectPath ?? "Kimi",
    model: (string(value.model) ?? "kimi-k2").replace(/^kimi-code\//u, "")
  });
}

export function parseCopilot(source: string, raw: unknown, session: Session): UsageRecord | undefined {
  const value = object(raw);
  const attrs = object(value?.attributes);
  if (!value || !attrs) return undefined;
  const input = num(attrs["gen_ai.usage.input_tokens"]);
  const output = num(attrs["gen_ai.usage.output_tokens"]);
  const cacheRead = num(attrs["gen_ai.usage.cache_read.input_tokens"]);
  const cacheCreate = num(attrs["gen_ai.usage.cache_write.input_tokens"]) || num(attrs["gen_ai.usage.cache_creation.input_tokens"]);
  const reasoning = num(attrs["gen_ai.usage.reasoning_tokens"]) || num(attrs["gen_ai.usage.reasoning.output_tokens"]);
  if (input + output + cacheRead + cacheCreate + reasoning === 0) return undefined;
  return {
    source,
    timestamp: timestampFromOtel(value) ?? new Date(0).toISOString(),
    messageId: string(attrs["gen_ai.response.id"]) ?? string(attrs["gen_ai.message.id"]) ?? string(attrs["message.id"]),
    requestId: string(attrs["gen_ai.request.id"]) ?? string(attrs["service.request.id"]) ?? string(attrs["request.id"]),
    sessionId: string(attrs["session.id"]) ?? string(attrs["conversation.id"]) ?? session.sessionId,
    projectPath: "GitHub Copilot CLI",
    model: string(attrs["gen_ai.request.model"]) ?? string(attrs["gen_ai.response.model"]) ?? string(attrs["gen_ai.system"]) ?? "unknown",
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    extraTotalTokens: reasoning
  };
}

export function parseOpenClaw(source: string, raw: unknown, session: Session): UsageRecord | undefined {
  return parseGenericUsage(source, raw, { ...session, projectPath: session.projectPath ?? "OpenClaw" });
}

type Session = { sessionId?: string; projectPath?: string };

function parseUsageObject(source: string, usage: Record<string, unknown> | undefined, base: { timestamp: string; sessionId?: string; projectPath?: string; model?: string }): UsageRecord | undefined {
  if (!usage) return undefined;
  const input = num(usage.inputTokens) || num(usage.input_tokens) || num(usage.input) || num(usage.inputOther);
  const output = num(usage.outputTokens) || num(usage.output_tokens) || num(usage.output);
  const cacheCreate = num(usage.cacheCreationTokens) || num(usage.cache_creation_input_tokens) || num(usage.inputCacheCreation);
  const cacheRead = num(usage.cacheReadTokens) || num(usage.cache_read_input_tokens) || num(usage.inputCacheRead);
  const total = num(usage.totalTokens) || num(usage.total);
  if (input + output + cacheCreate + cacheRead + total === 0) return undefined;
  return {
    source,
    timestamp: base.timestamp,
    sessionId: base.sessionId,
    projectPath: base.projectPath,
    model: base.model,
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    extraTotalTokens: total > 0 ? Math.max(0, total - input - output - cacheCreate - cacheRead) : 0
  };
}

function codebuffSession(file: string): string {
  const chat = basename(dirname(file));
  const project = basename(dirname(dirname(dirname(file))));
  const channel = basename(dirname(dirname(dirname(dirname(file)))));
  return `${channel || "manicode"}/${project || "unknown"}/${chat || "unknown"}`;
}

function timestampFromOtel(value: Record<string, unknown>): string | undefined {
  const direct = string(value.timestamp) ?? string(value.startTime) ?? string(value.observedTimestamp);
  if (direct) return direct;
  const unixNano = number(value.timeUnixNano);
  if (unixNano != null) return new Date(Math.floor(unixNano / 1_000_000)).toISOString();
  return undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = number(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

function num(value: unknown): number {
  return number(value) ?? 0;
}

function millisToIso(value: number | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}
