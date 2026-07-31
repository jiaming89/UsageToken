import type { CostMode, UsageRecord } from "../types.js";
import { withinDateRange } from "./date.js";
import { calculateRecordCost } from "./pricing.js";

const MILLIS_PER_HOUR = 60 * 60 * 1000;
const MILLIS_PER_MINUTE = 60 * 1000;
const DEFAULT_SESSION_DURATION_HOURS = 5;

export interface BurnRate {
  costPerHour: number;
  tokensPerMinute: number;
  tokensPerMinuteForIndicator: number;
}

export interface Projection {
  remainingMinutes: number;
  totalCost: number;
  totalTokens: number;
}

export interface UsageBlock {
  id: string;
  startTime: string;
  endTime: string;
  actualEndTime: string | null;
  isActive: boolean;
  isGap: boolean;
  entries: number;
  tokenCounts: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  totalTokens: number;
  costUSD: number;
  models: string[];
  burnRate: BurnRate | null;
  projection: Projection | null;
}

export function summarizeBlocks(records: UsageRecord[], options: { since?: string; until?: string; timezone?: string; mode: CostMode; sessionDurationHours?: number }): UsageBlock[] {
  const duration = (options.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS) * MILLIS_PER_HOUR;
  const entries = records
    .map((record) => ({ record, millis: Date.parse(record.timestamp) }))
    .filter((entry) => Number.isFinite(entry.millis))
    .sort((a, b) => a.millis - b.millis);
  if (entries.length === 0 || duration <= 0) {
    return [];
  }

  const now = Date.now();
  const blocks: UsageBlock[] = [];
  let currentStart: number | undefined;
  let currentEntries: typeof entries = [];

  for (const entry of entries) {
    if (currentStart == null) {
      currentStart = floorToHour(entry.millis);
    } else {
      const lastTime = currentEntries.at(-1)?.millis ?? currentStart;
      if (entry.millis - currentStart > duration || entry.millis - lastTime > duration) {
        blocks.push(createBlock(currentStart, currentEntries, now, duration, options.mode));
        if (entry.millis - lastTime > duration) {
          blocks.push(createGapBlock(lastTime, entry.millis, duration));
        }
        currentStart = floorToHour(entry.millis);
        currentEntries = [];
      }
    }
    currentEntries.push(entry);
  }

  if (currentStart != null && currentEntries.length > 0) {
    blocks.push(createBlock(currentStart, currentEntries, now, duration, options.mode));
  }

  return blocks.filter((block) => withinDateRange(block.startTime, options.timezone, options.since, options.until));
}

function createBlock(start: number, entries: Array<{ record: UsageRecord; millis: number }>, now: number, duration: number, mode: CostMode): UsageBlock {
  const end = start + duration;
  const actualEnd = entries.at(-1)?.millis;
  const seenModels = new Set<string>();
  const models: string[] = [];
  const tokenCounts = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0
  };
  let extraTotalTokens = 0;
  let costUSD = 0;
  for (const { record } of entries) {
    tokenCounts.inputTokens += record.inputTokens;
    tokenCounts.outputTokens += record.outputTokens;
    tokenCounts.cacheCreationInputTokens += record.cacheCreationTokens;
    tokenCounts.cacheReadInputTokens += record.cacheReadTokens;
    extraTotalTokens += record.extraTotalTokens ?? 0;
    costUSD += calculateRecordCost(record, mode).cost;
    if (record.model && record.model !== "<synthetic>" && !seenModels.has(record.model)) {
      seenModels.add(record.model);
      models.push(record.model);
    }
  }
  const isActive = actualEnd != null && now - actualEnd < duration && now < end;
  const burnRate = isActive ? calculateBurnRate(entries, tokenCounts, extraTotalTokens, costUSD) : null;
  return {
    id: iso(start),
    startTime: iso(start),
    endTime: iso(end),
    actualEndTime: actualEnd == null ? null : iso(actualEnd),
    isActive,
    isGap: false,
    entries: entries.length,
    tokenCounts,
    totalTokens: tokenCounts.inputTokens + tokenCounts.outputTokens + tokenCounts.cacheCreationInputTokens + tokenCounts.cacheReadInputTokens + extraTotalTokens,
    costUSD,
    models,
    burnRate,
    projection: isActive && burnRate ? calculateProjection(end, tokenCounts, extraTotalTokens, costUSD, burnRate) : null
  };
}

function createGapBlock(lastTime: number, nextTime: number, duration: number): UsageBlock {
  const start = lastTime + duration;
  return {
    id: `gap-${iso(start)}`,
    startTime: iso(start),
    endTime: iso(nextTime),
    actualEndTime: null,
    isActive: false,
    isGap: true,
    entries: 0,
    tokenCounts: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0
    },
    totalTokens: 0,
    costUSD: 0,
    models: [],
    burnRate: null,
    projection: null
  };
}

function floorToHour(millis: number): number {
  return Math.floor(millis / MILLIS_PER_HOUR) * MILLIS_PER_HOUR;
}

function iso(millis: number): string {
  return new Date(millis).toISOString();
}

function calculateBurnRate(
  entries: Array<{ record: UsageRecord; millis: number }>,
  tokenCounts: UsageBlock["tokenCounts"],
  extraTotalTokens: number,
  costUSD: number
): BurnRate | null {
  if (entries.length === 0) {
    return null;
  }
  const first = entries[0]?.millis;
  const last = entries.at(-1)?.millis;
  if (first == null || last == null) {
    return null;
  }
  const durationMinutes = (last - first) / MILLIS_PER_MINUTE;
  if (durationMinutes <= 0) {
    return null;
  }
  const totalTokens =
    tokenCounts.inputTokens +
    tokenCounts.outputTokens +
    tokenCounts.cacheCreationInputTokens +
    tokenCounts.cacheReadInputTokens +
    extraTotalTokens;
  const nonCacheTokens = tokenCounts.inputTokens + tokenCounts.outputTokens;
  return {
    costPerHour: costUSD / durationMinutes * 60,
    tokensPerMinute: totalTokens / durationMinutes,
    tokensPerMinuteForIndicator: nonCacheTokens / durationMinutes
  };
}

function calculateProjection(
  end: number,
  tokenCounts: UsageBlock["tokenCounts"],
  extraTotalTokens: number,
  costUSD: number,
  burnRate: BurnRate
): Projection {
  const remainingMinutes = Math.round((end - Date.now()) / MILLIS_PER_MINUTE);
  const currentTokens =
    tokenCounts.inputTokens +
    tokenCounts.outputTokens +
    tokenCounts.cacheCreationInputTokens +
    tokenCounts.cacheReadInputTokens +
    extraTotalTokens;
  return {
    remainingMinutes,
    totalCost: Math.round((costUSD + (burnRate.costPerHour / 60) * remainingMinutes) * 100) / 100,
    totalTokens: Math.round(currentTokens + burnRate.tokensPerMinute * remainingMinutes)
  };
}
