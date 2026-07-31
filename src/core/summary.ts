import type { CostMode, ModelBreakdown, ReportKind, UsageRecord, UsageSummary } from "../types.js";
import { dateKey, formatDate, monthKey, weekStartMonday, withinDateRange } from "./date.js";
import { calculateRecordCost } from "./pricing.js";

export function summarize(records: UsageRecord[], kind: ReportKind, options: { timezone?: string; since?: string; until?: string; mode: CostMode }): UsageSummary[] {
  if (kind === "session") {
    return summarizeBy(records, (record) => sessionKey(record), options.mode, true)
      .filter((row) => !row.lastActivity || withinDateRange(row.lastActivity, options.timezone, options.since, options.until));
  }
  const filtered = records.filter((record) => withinDateRange(record.timestamp, options.timezone, options.since, options.until));
  const daily = summarizeBy(filtered, (record) => formatDate(record.timestamp, options.timezone), options.mode, false);
  if (kind === "daily") {
    return daily;
  }
  if (kind === "monthly") {
    return summarizeSummaries(daily, (row) => monthKey(row.period));
  }
  if (kind === "weekly") {
    return summarizeSummaries(daily, (row) => weekStartMonday(row.period));
  }
  return daily;
}

export function summarizeAllAgent(records: UsageRecord[], kind: ReportKind, options: { timezone?: string; since?: string; until?: string; mode: CostMode }): UsageSummary[] {
  const sourceRows = summarizeBySource(records, kind, options);
  if (kind === "session") {
    return sourceRows;
  }
  return combineRowsByPeriod(sourceRows);
}

export function summarizeBySource(records: UsageRecord[], kind: ReportKind, options: { timezone?: string; since?: string; until?: string; mode: CostMode }): UsageSummary[] {
  const bySource = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const group = bySource.get(record.source);
    if (group) {
      group.push(record);
    } else {
      bySource.set(record.source, [record]);
    }
  }
  const sourceRows = [...bySource.entries()].flatMap(([source, sourceRecords]) =>
    summarize(sourceRecords, kind, options).map((row) => ({ ...row, agents: [source], source }))
  );
  if (kind === "session") {
    return sourceRows.sort((a, b) => `${a.source ?? ""}\0${a.period}`.localeCompare(`${b.source ?? ""}\0${b.period}`));
  }
  return sourceRows.sort((a, b) => `${a.period}\0${a.source ?? ""}`.localeCompare(`${b.period}\0${b.source ?? ""}`));
}

export function totals(rows: UsageSummary[]): UsageSummary {
  return combineSummaries("total", rows);
}

function summarizeBy(records: UsageRecord[], keyFn: (record: UsageRecord) => string, mode: CostMode, session: boolean): UsageSummary[] {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = keyFn(record);
    const group = groups.get(key);
    if (group) {
      group.push(record);
    } else {
      groups.set(key, [record]);
    }
  }
  return [...groups.entries()]
    .map(([period, group]) => summarizeRecords(period, group, mode, session))
    .filter((row) => row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens + row.extraTotalTokens > 0)
    .sort((a, b) => a.period.localeCompare(b.period));
}

function summarizeRecords(period: string, records: UsageRecord[], mode: CostMode, session: boolean): UsageSummary {
  const modelIndexes = new Map<string, ModelBreakdown>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let extraTotalTokens = 0;
  let totalCost = 0;
  let credits = 0;
  let messageCount = 0;
  let reasoningOutputTokens = 0;
  let firstActivity: string | undefined;
  let lastActivity: string | undefined;
  let latestRecord: UsageRecord | undefined;
  const agents: string[] = [];
  const seenAgents = new Set<string>();

  for (const record of records) {
    inputTokens += record.inputTokens;
    outputTokens += record.outputTokens;
    cacheCreationTokens += record.cacheCreationTokens;
    cacheReadTokens += record.cacheReadTokens;
    extraTotalTokens += record.extraTotalTokens ?? 0;
    credits += record.credits ?? 0;
    messageCount += record.messageCount ?? 0;
    reasoningOutputTokens += Number(record.metadata?.reasoningOutputTokens ?? 0);
    const priced = calculateRecordCost(record, mode);
    totalCost += priced.cost;
    if (!firstActivity || record.timestamp < firstActivity) {
      firstActivity = record.timestamp;
    }
    if (!lastActivity || record.timestamp > lastActivity) {
      lastActivity = record.timestamp;
      latestRecord = record;
    }
    if (!seenAgents.has(record.source)) {
      seenAgents.add(record.source);
      agents.push(record.source);
    }
    const modelName = normalizeSummaryModel(record.model);
    if (modelName) {
      const breakdown = modelIndexes.get(modelName) ?? {
        modelName,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        extraTotalTokens: 0,
        cost: 0,
        credits: 0,
        messageCount: 0,
        missingPricing: false
      };
      breakdown.inputTokens += record.inputTokens;
      breakdown.outputTokens += record.outputTokens;
      breakdown.cacheCreationTokens += record.cacheCreationTokens;
      breakdown.cacheReadTokens += record.cacheReadTokens;
      breakdown.extraTotalTokens += record.extraTotalTokens ?? 0;
      breakdown.cost += priced.cost;
      breakdown.credits += record.credits ?? 0;
      breakdown.messageCount += record.messageCount ?? 0;
      breakdown.missingPricing = Boolean(breakdown.missingPricing || priced.missingPricing);
      modelIndexes.set(modelName, breakdown);
    }
  }

  const row: UsageSummary = {
    period,
    agents: [...agents].sort(),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    extraTotalTokens,
    totalCost,
    credits,
    messageCount,
    reasoningOutputTokens,
    modelsUsed: [...modelIndexes.keys()].sort(),
    modelBreakdowns: [...modelIndexes.values()].sort((a, b) => b.cost - a.cost)
  };
  if (session) {
    row.sessionId = latestRecord?.sessionId ?? records[0]?.sessionId ?? period;
    row.period = sessionDisplayPeriod(latestRecord ?? records[0], row.sessionId);
    row.projectPath = latestRecord?.projectPath ?? records[0]?.projectPath;
    row.firstActivity = firstActivity;
    row.lastActivity = lastActivity;
  }
  return row;
}

function summarizeSummaries(rows: UsageSummary[], keyFn: (row: UsageSummary) => string): UsageSummary[] {
  const groups = new Map<string, UsageSummary[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return [...groups.entries()].map(([period, group]) => combineSummaries(period, group)).sort((a, b) => a.period.localeCompare(b.period));
}

function combineRowsByPeriod(rows: UsageSummary[]): UsageSummary[] {
  const groups = new Map<string, UsageSummary[]>();
  for (const row of rows) {
    const group = groups.get(row.period);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.period, [row]);
    }
  }
  return [...groups.entries()].map(([period, group]) => combineSummaries(period, group)).sort((a, b) => a.period.localeCompare(b.period));
}

function combineSummaries(period: string, rows: UsageSummary[]): UsageSummary {
  const modelIndexes = new Map<string, ModelBreakdown>();
  const out: UsageSummary = {
    period,
    agents: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    extraTotalTokens: 0,
    totalCost: 0,
    credits: 0,
    messageCount: 0,
    reasoningOutputTokens: 0,
    modelsUsed: [],
    modelBreakdowns: []
  };
  for (const row of rows) {
    out.inputTokens += row.inputTokens;
    out.outputTokens += row.outputTokens;
    out.cacheCreationTokens += row.cacheCreationTokens;
    out.cacheReadTokens += row.cacheReadTokens;
    out.extraTotalTokens += row.extraTotalTokens;
    out.totalCost += row.totalCost;
    out.credits += row.credits;
    out.messageCount += row.messageCount;
    out.reasoningOutputTokens = (out.reasoningOutputTokens ?? 0) + (row.reasoningOutputTokens ?? 0);
    for (const agent of row.agents) {
      if (!out.agents.includes(agent)) {
        out.agents.push(agent);
      }
    }
    for (const item of row.modelBreakdowns) {
      const existing = modelIndexes.get(item.modelName) ?? {
        modelName: item.modelName,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        extraTotalTokens: 0,
        cost: 0,
        credits: 0,
        messageCount: 0,
        missingPricing: false
      };
      existing.inputTokens += item.inputTokens;
      existing.outputTokens += item.outputTokens;
      existing.cacheCreationTokens += item.cacheCreationTokens;
      existing.cacheReadTokens += item.cacheReadTokens;
      existing.extraTotalTokens += item.extraTotalTokens;
      existing.cost += item.cost;
      existing.credits += item.credits;
      existing.messageCount += item.messageCount;
      existing.missingPricing = Boolean(existing.missingPricing || item.missingPricing);
      modelIndexes.set(item.modelName, existing);
    }
  }
  out.agents.sort();
  out.modelsUsed = [...modelIndexes.keys()].sort();
  out.modelBreakdowns = [...modelIndexes.values()].sort((a, b) => b.cost - a.cost);
  return out;
}

function sessionKey(record: UsageRecord): string {
  if (record.source === "claude") {
    return [record.source, record.sessionId ?? dateKey(record.timestamp)].join("/");
  }
  return [record.source, record.projectPath ?? "unknown", record.sessionId ?? dateKey(record.timestamp)].join("/");
}

function sessionDisplayPeriod(record: UsageRecord | undefined, fallback: string): string {
  if (record?.source === "codex" && record.projectPath && record.sessionId) {
    return `${record.projectPath}/${record.sessionId}`;
  }
  return fallback;
}

function normalizeSummaryModel(model: string | undefined): string | undefined {
  if (!model || model === "<synthetic>") {
    return undefined;
  }
  return model;
}
