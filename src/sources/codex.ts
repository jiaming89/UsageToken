import { join } from "node:path";
import type { DetectionResult, LoadContext, RuntimeContext, UsageRecord, UsageSource } from "../types.js";
import { collectFiles, envPaths, existsDir, readJsonRecords, sessionFromPath } from "./fs.js";

export class CodexSource implements UsageSource {
  readonly name = "codex";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const files = (await Promise.all((await this.paths(ctx)).map((root) => collectFiles(root, [".jsonl"])))).flat();
    return { detected: files.length > 0, paths: [...new Set(files)] };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const roots = await this.paths(ctx);
    const records: UsageRecord[] = [];
    for (const root of roots) {
      for (const file of await collectFiles(root, [".jsonl"])) {
        const session = sessionFromPath(root, file);
        let currentModel: string | undefined;
        let previousTotals: CodexRawUsage | undefined;
        for (const raw of await readJsonRecords(file)) {
          const event = parseCodexEvent(raw, currentModel, previousTotals, session);
          if (event.modelHint) {
            currentModel = event.modelHint;
          }
          if (event.totalUsage) {
            previousTotals = event.totalUsage;
          }
          if (event.record) {
            records.push(event.record);
          }
        }
      }
    }
    return dedupeCodex(records);
  }

  private async paths(ctx: RuntimeContext): Promise<string[]> {
    const homes = envPaths(ctx.env.CODEX_HOME);
    if (homes.length === 0) {
      homes.push(join(ctx.homeDir, ".codex"));
    }
    const found: string[] = [];
    for (const home of homes) {
      const sessions = join(home, "sessions");
      const archived = join(home, "archived_sessions");
      if (await existsDir(sessions)) found.push(sessions);
      if (await existsDir(archived)) found.push(archived);
      if (found.length === 0 && await existsDir(home)) found.push(home);
    }
    return [...new Set(found)];
  }
}

interface CodexRawUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

function parseCodexEvent(raw: unknown, currentModel: string | undefined, previousTotals: CodexRawUsage | undefined, session: { sessionId?: string; projectPath?: string }): { modelHint?: string; totalUsage?: CodexRawUsage; record?: UsageRecord } {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const payload = objectValue(value.payload);
  if (value.type === "turn_context") {
    return { modelHint: stringValue(payload?.model) };
  }
  const nestedPayload = objectValue(payload?.payload) ?? payload;
  const info = objectValue(nestedPayload?.info);
  const totalUsage = readCodexUsage(objectValue(info?.total_token_usage));
  const cumulativeAdvanced = !totalUsage || !sameCodexUsage(totalUsage, previousTotals);
  const tokenUsage = (cumulativeAdvanced ? readCodexUsage(objectValue(info?.last_token_usage)) : undefined)
    ?? subtractCodexUsage(totalUsage, previousTotals);
  if (value.type !== "event_msg" || nestedPayload?.type !== "token_count" || !tokenUsage) {
    return { totalUsage };
  }
  if (tokenUsage.inputTokens + tokenUsage.cachedInputTokens + tokenUsage.outputTokens + tokenUsage.reasoningOutputTokens === 0) {
    return { totalUsage };
  }
  const timestamp = stringValue(value.timestamp);
  if (!timestamp) return { totalUsage };
  const model = stringValue(info?.model) ?? currentModel;
  const cached = Math.min(tokenUsage.cachedInputTokens, tokenUsage.inputTokens);
  const input = Math.max(0, tokenUsage.inputTokens - cached);
  return {
    totalUsage,
    modelHint: model,
    record: {
      source: "codex",
      timestamp,
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      model,
      inputTokens: input,
      outputTokens: tokenUsage.outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: cached,
      extraTotalTokens: Math.max(0, tokenUsage.totalTokens - input - cached - tokenUsage.outputTokens),
      metadata: { reasoningOutputTokens: tokenUsage.reasoningOutputTokens }
    }
  };
}

function dedupeCodex(records: UsageRecord[]): UsageRecord[] {
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const record of records) {
    const key = [record.timestamp, record.model, record.inputTokens, record.cacheReadTokens, record.outputTokens, record.extraTotalTokens].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readCodexUsage(value: Record<string, unknown> | undefined): CodexRawUsage | undefined {
  if (!value) return undefined;
  const inputTokens = numberValue(value.input_tokens) ?? numberValue(value.prompt_tokens) ?? 0;
  const cachedInputTokens = numberValue(value.cached_input_tokens) ?? 0;
  const outputTokens = numberValue(value.output_tokens) ?? 0;
  const reasoningOutputTokens = numberValue(value.reasoning_output_tokens) ?? 0;
  const totalTokens = numberValue(value.total_tokens) ?? inputTokens + outputTokens + reasoningOutputTokens;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens };
}

function subtractCodexUsage(current: CodexRawUsage | undefined, previous: CodexRawUsage | undefined): CodexRawUsage | undefined {
  if (!current) return undefined;
  return {
    inputTokens: Math.max(0, current.inputTokens - (previous?.inputTokens ?? 0)),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - (previous?.cachedInputTokens ?? 0)),
    outputTokens: Math.max(0, current.outputTokens - (previous?.outputTokens ?? 0)),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0)),
    totalTokens: Math.max(0, current.totalTokens - (previous?.totalTokens ?? 0))
  };
}

function sameCodexUsage(left: CodexRawUsage | undefined, right: CodexRawUsage | undefined): boolean {
  return Boolean(left && right
    && left.inputTokens === right.inputTokens
    && left.cachedInputTokens === right.cachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.reasoningOutputTokens === right.reasoningOutputTokens
    && left.totalTokens === right.totalTokens);
}
