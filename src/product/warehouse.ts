import { createHash, randomUUID } from "node:crypto";
import type { DailyUserSummary, ProductConfig, SessionSummaryRecord, UploadBatch, UsageRecord, UsageSummary } from "../types.js";
import { formatDate } from "../core/date.js";
import { calculateRecordCost } from "../core/pricing.js";
import { summarize, summarizeBySource } from "../core/summary.js";

export function createSessionSummaries(records: UsageRecord[], timezone: string | undefined, mode: "auto" | "display" | "calculate"): SessionSummaryRecord[] {
  return summarize(records, "session", { timezone, mode }).map((row) => toSessionSummary(row));
}

export function createDailyUserSummaries(records: UsageRecord[], config: ProductConfig, timezone: string | undefined, mode: "auto" | "display" | "calculate"): DailyUserSummary[] {
  const dailyRows = summarize(records, "daily", { timezone, mode });
  const dailyBySource = summarizeBySource(records, "daily", { timezone, mode });

  return dailyRows.map((row) => {
    const dateRows = dailyBySource.filter((item) => item.period === row.period);
    const projectBreakdown = summarizeProjects(records, row.period, timezone, mode);
    return {
      date: row.period,
      identity: config.identity,
      agents: row.agents,
      modelsUsed: row.modelsUsed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      extraTotalTokens: row.extraTotalTokens,
      totalTokens: totalTokens(row),
      totalCost: row.totalCost,
      credits: row.credits,
      messageCount: row.messageCount,
      sourceBreakdown: dateRows.map((item) => ({
        source: item.source ?? item.agents[0] ?? "unknown",
        totalTokens: totalTokens(item),
        totalCost: item.totalCost,
        messageCount: item.messageCount
      })),
      modelBreakdown: row.modelBreakdowns.map((item) => ({
        model: item.modelName,
        totalTokens: item.inputTokens + item.outputTokens + item.cacheCreationTokens + item.cacheReadTokens + item.extraTotalTokens,
        totalCost: item.cost,
        messageCount: item.messageCount
      })),
      projectBreakdown
    };
  });
}

export function createUploadBatch(config: ProductConfig, summaries: DailyUserSummary[]): UploadBatch {
  const digest = createHash("sha256").update(JSON.stringify({
    userId: config.identity.userId,
    dates: summaries.map((item) => item.date),
    totals: summaries.map((item) => [item.date, item.totalTokens, item.totalCost])
  })).digest("hex").slice(0, 16);
  return {
    batchId: `${config.identity.userId}-${digest}-${randomUUID()}`,
    uploadedAt: new Date().toISOString(),
    identity: config.identity,
    summaries
  };
}

function toSessionSummary(row: UsageSummary): SessionSummaryRecord {
  return {
    source: row.source ?? row.agents[0] ?? "unknown",
    sessionId: row.sessionId ?? row.period,
    period: row.period,
    projectPath: row.projectPath,
    firstActivity: row.firstActivity,
    lastActivity: row.lastActivity,
    agents: row.agents,
    modelsUsed: row.modelsUsed,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    extraTotalTokens: row.extraTotalTokens,
    totalCost: row.totalCost,
    messageCount: row.messageCount,
    credits: row.credits
  };
}

function summarizeProjects(
  records: UsageRecord[],
  period: string,
  timezone: string | undefined,
  mode: "auto" | "display" | "calculate"
): DailyUserSummary["projectBreakdown"] {
  const filtered = records.filter((record) => formatDate(record.timestamp, timezone) === period);
  const map = new Map<string, { totalTokens: number; totalCost: number; messageCount: number }>();
  for (const record of filtered) {
    const projectPath = record.projectPath ?? "Unknown Project";
    const entry = map.get(projectPath) ?? { totalTokens: 0, totalCost: 0, messageCount: 0 };
    entry.totalTokens += record.inputTokens + record.outputTokens + record.cacheCreationTokens + record.cacheReadTokens + (record.extraTotalTokens ?? 0);
    entry.messageCount += record.messageCount ?? 0;
    entry.totalCost += calculateRecordCost(record, mode).cost;
    map.set(projectPath, entry);
  }
  return [...map.entries()]
    .map(([projectPath, value]) => ({ projectPath, ...value }))
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens)
    .slice(0, 10);
}

function totalTokens(row: Pick<UsageSummary, "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens" | "extraTotalTokens">): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens + row.extraTotalTokens;
}
