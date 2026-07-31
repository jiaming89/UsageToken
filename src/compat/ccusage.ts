import type { UsageBlock } from "../core/blocks.js";
import type { ReportKind, UsageSummary } from "../types.js";

export function reportToCcusageJson(kind: ReportKind, rows: UsageSummary[], noCost = false): unknown {
  const key = rowsKey(kind);
  const body: Record<string, unknown> = {
    [key]: rows.map((row) => rowToJson(kind, row)),
    totals: totalsJson(rows)
  };
  if (noCost) {
    stripCost(body);
  }
  return body;
}

export function blocksToCcusageJson(blocks: UsageBlock[], noCost = false): unknown {
  const body: Record<string, unknown> = { blocks };
  if (noCost) {
    stripCost(body);
  }
  return body;
}

function rowToJson(kind: ReportKind, row: UsageSummary): Record<string, unknown> {
  const output: Record<string, unknown> = {
    agent: kind === "session" ? (row.source ?? row.agents[0] ?? "all") : "all",
    period: row.period,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: totalTokens(row),
    totalCost: row.totalCost,
    modelsUsed: row.modelsUsed,
    modelBreakdowns: row.modelBreakdowns.map((item) => ({
      modelName: item.modelName,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheCreationTokens: item.cacheCreationTokens,
      cacheReadTokens: item.cacheReadTokens,
      cost: item.cost
    }))
  };
  if (kind !== "session" && row.source) {
    output.agent = row.source;
  }
  if (kind === "session") {
    const source = row.source ?? row.agents[0];
    const metadata: Record<string, unknown> = {};
    if (row.credits > 0) {
      metadata.credits = row.credits;
    }
    if (row.lastActivity && shouldIncludeSessionLastActivity(source)) {
      metadata.lastActivity = row.lastActivity;
    }
    if (source === "codex") {
      metadata.reasoningOutputTokens = row.reasoningOutputTokens ?? 0;
    }
    if (row.projectPath && shouldIncludeSessionProjectPath(source)) {
      metadata.projectPath = row.projectPath;
    }
    if (Object.keys(metadata).length > 0) {
      output.metadata = metadata;
    }
    return output;
  }
  output.metadata = { agents: row.agents };
  if (row.credits > 0) {
    output.credits = row.credits;
  }
  return output;
}

function totalsJson(rows: UsageSummary[]): Record<string, number> {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.cacheCreationTokens += row.cacheCreationTokens;
      acc.cacheReadTokens += row.cacheReadTokens;
      acc.extraTotalTokens += row.extraTotalTokens;
      acc.totalTokens += totalTokens(row);
      acc.totalCost += row.totalCost;
      acc.credits += row.credits;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, extraTotalTokens: 0, totalTokens: 0, totalCost: 0, credits: 0 }
  );
  if (totals.extraTotalTokens === 0) {
    delete (totals as Partial<typeof totals>).extraTotalTokens;
  }
  delete (totals as Partial<typeof totals>).extraTotalTokens;
  if (totals.credits === 0) {
    delete (totals as Partial<typeof totals>).credits;
  }
  return totals;
}

function totalTokens(row: UsageSummary): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens + row.extraTotalTokens;
}

function rowsKey(kind: ReportKind): string {
  if (kind === "monthly") return "monthly";
  if (kind === "weekly") return "weekly";
  if (kind === "session") return "session";
  return "daily";
}

function shouldIncludeSessionProjectPath(source: string | undefined): boolean {
  return source === "pi";
}

function shouldIncludeSessionLastActivity(source: string | undefined): boolean {
  return source === "claude" || source === "codex" || source === "opencode";
}

export function stripCost(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripCost(item);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const key of Object.keys(value)) {
    if (key === "totalCost" || key === "cost" || key === "costUSD") {
      delete (value as Record<string, unknown>)[key];
    } else {
      stripCost((value as Record<string, unknown>)[key]);
    }
  }
}
