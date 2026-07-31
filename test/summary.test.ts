import assert from "node:assert/strict";
import test from "node:test";
import { reportToCcusageJson } from "../src/compat/ccusage.js";
import { summarizeBlocks } from "../src/core/blocks.js";
import { calculateRecordCost } from "../src/core/pricing.js";
import { summarize, summarizeAllAgent, summarizeBySource } from "../src/core/summary.js";
import type { UsageRecord } from "../src/types.js";

test("summarizes daily rows with ccusage-compatible totals", () => {
  const records: UsageRecord[] = [
    {
      source: "test",
      timestamp: "2026-01-01T10:00:00.000Z",
      model: "model-a",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 10,
      cacheReadTokens: 5,
      costUSD: 0.25
    },
    {
      source: "test",
      timestamp: "2026-01-01T11:00:00.000Z",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      extraTotalTokens: 3,
      costUSD: 0.05
    }
  ];

  const rows = summarize(records, "daily", { mode: "auto" });
  const json = reportToCcusageJson("daily", rows) as { daily: Array<Record<string, unknown>>; totals: Record<string, unknown> };

  assert.equal(json.daily.length, 1);
  assert.equal(json.daily[0]?.inputTokens, 110);
  assert.equal(json.daily[0]?.totalTokens, 183);
  assert.equal(json.totals.totalCost, 0.3);
});

test("display mode calculates Codex and Hermes but preserves recorded-cost behavior for OpenCode", () => {
  const codex: UsageRecord = { source: "codex", timestamp: "2026-01-01T00:00:00.000Z", model: "gpt-5", inputTokens: 100, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const hermes: UsageRecord = { ...codex, source: "hermes" };
  const opencode: UsageRecord = { ...codex, source: "opencode" };

  assert.equal(calculateRecordCost(codex, "display").cost > 0, true);
  assert.equal(calculateRecordCost(hermes, "display").cost > 0, true);
  assert.equal(calculateRecordCost(opencode, "display").cost, 0);
});

test("blocks JSON groups five-hour sessions and emits gap rows", () => {
  const rows = summarizeBlocks(
    [
      { source: "codex", timestamp: "2026-01-01T10:15:00.000Z", model: "gpt-5", inputTokens: 10, outputTokens: 1, cacheCreationTokens: 2, cacheReadTokens: 3 },
      { source: "codex", timestamp: "2026-01-01T11:15:00.000Z", model: "gpt-5", inputTokens: 20, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { source: "codex", timestamp: "2026-01-01T20:30:00.000Z", model: "gpt-5.4", inputTokens: 30, outputTokens: 3, cacheCreationTokens: 0, cacheReadTokens: 0 }
    ],
    { mode: "calculate" }
  );

  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.id, "2026-01-01T10:00:00.000Z");
  assert.equal(rows[0]?.entries, 2);
  assert.equal(rows[0]?.tokenCounts.cacheCreationInputTokens, 2);
  assert.equal(rows[1]?.isGap, true);
  assert.equal(rows[2]?.entries, 1);
});

test("active blocks include burn rate and projection", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-01-01T11:00:00.000Z");
  try {
    const rows = summarizeBlocks(
      [
        { source: "claude", timestamp: "2026-01-01T10:00:00.000Z", model: "claude-sonnet-4-20250514", inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 1 },
        { source: "claude", timestamp: "2026-01-01T10:30:00.000Z", model: "claude-sonnet-4-20250514", inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 1 }
      ],
      { mode: "display" }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.isActive, true);
    assert.deepEqual(rows[0]?.burnRate, {
      costPerHour: 4,
      tokensPerMinute: 10,
      tokensPerMinuteForIndicator: 10
    });
    assert.deepEqual(rows[0]?.projection, {
      remainingMinutes: 240,
      totalCost: 18,
      totalTokens: 2700
    });
  } finally {
    Date.now = originalNow;
  }
});

test("groups weekly by Monday start", () => {
  const rows = summarize(
    [
      { source: "test", timestamp: "2026-01-07T00:00:00.000Z", inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { source: "test", timestamp: "2026-01-10T00:00:00.000Z", inputTokens: 2, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
    ],
    "weekly",
    { mode: "auto" }
  );

  assert.deepEqual(rows.map((row) => [row.period, row.inputTokens]), [["2026-01-05", 3]]);
});

test("session JSON emits per-agent rows with session period and last activity metadata", () => {
  const records: UsageRecord[] = [
    {
      source: "claude",
      timestamp: "2026-01-01T10:00:00.000Z",
      sessionId: "session-a",
      projectPath: "project-a",
      model: "model-a",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    },
    {
      source: "claude",
      timestamp: "2026-01-02T10:00:00.000Z",
      sessionId: "session-a",
      projectPath: "project-a",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    },
    {
      source: "codex",
      timestamp: "2026-01-03T10:00:00.000Z",
      sessionId: "session-a",
      projectPath: "project-a",
      model: "model-b",
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      metadata: { reasoningOutputTokens: 7 }
    }
  ];

  const rows = summarizeAllAgent(records, "session", { mode: "auto" });
  const json = reportToCcusageJson("session", rows, true) as { session: Array<Record<string, unknown>> };

  assert.deepEqual(json.session.map((row) => [row.agent, row.period, row.inputTokens]), [
    ["claude", "session-a", 110],
    ["codex", "project-a/session-a", 1]
  ]);
  assert.deepEqual(json.session[0]?.metadata, { lastActivity: "2026-01-02T10:00:00.000Z" });
  assert.deepEqual(json.session[1]?.metadata, { lastActivity: "2026-01-03T10:00:00.000Z", reasoningOutputTokens: 7 });
  assert.equal("sessionId" in (json.session[0] ?? {}), false);
  assert.equal("projectPath" in (json.session[0] ?? {}), false);
  assert.equal("firstActivity" in (json.session[0] ?? {}), false);
  assert.equal("lastActivity" in (json.session[0] ?? {}), false);
});

test("by-source daily JSON emits one row per source", () => {
  const records: UsageRecord[] = [
    { source: "claude", timestamp: "2026-01-01T10:00:00.000Z", model: "model-a", inputTokens: 100, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 },
    { source: "copilot", timestamp: "2026-01-01T11:00:00.000Z", model: "model-b", inputTokens: 20, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 5 }
  ];

  const rows = summarizeBySource(records, "daily", { mode: "auto" });
  const json = reportToCcusageJson("daily", rows, true) as { daily: Array<Record<string, unknown>>; totals: Record<string, unknown> };

  assert.deepEqual(json.daily.map((row) => [row.agent, row.period, row.inputTokens, row.cacheReadTokens]), [
    ["claude", "2026-01-01", 100, 0],
    ["copilot", "2026-01-01", 20, 5]
  ]);
  assert.equal(json.totals.inputTokens, 120);
  assert.equal(json.totals.cacheReadTokens, 5);
});
