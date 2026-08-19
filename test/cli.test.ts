import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { loadCachedRecords, parseArgs, run } from "../src/cli.js";
import { calculateBudgetStatus } from "../src/product/budget.js";
import type { LocalWarehouse, UsageSource } from "../src/types.js";

test("cli writes upload file envelope even with no data", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-cli-"));
  const upload = join(root, "upload", "daily.json");
  const envNames = [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "OPENCODE_DATA_DIR",
    "AMP_DATA_DIR",
    "DROID_SESSIONS_DIR",
    "CODEBUFF_DATA_DIR",
    "HERMES_HOME",
    "PI_AGENT_DIR",
    "GOOSE_PATH_ROOT",
    "OPENCLAW_DIR",
    "KILO_DATA_DIR",
    "COPILOT_SESSION_STATE_DIR",
    "COPILOT_OTEL_FILE_EXPORTER_PATH",
    "GEMINI_DATA_DIR",
    "KIMI_DATA_DIR",
    "QWEN_DATA_DIR",
    "ANTIGRAVITY_DATA_DIR"
  ];
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) {
    process.env[name] = join(root, `missing-${name.toLowerCase()}`);
  }
  try {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const code = await run(["daily", "--json", "--upload-file", upload], { stdout, stderr });
    assert.equal(code, 0);
    assert.equal((await stat(upload)).isFile(), true);
    const envelope = JSON.parse(await readFile(upload, "utf8")) as Record<string, unknown>;
    assert.equal(envelope.tool, "usagetoken");
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.command, "daily");
    assert.match(stdout.text, /"daily": \[\]/);
  } finally {
    for (const [name, value] of previous) {
      restoreEnv(name, value);
    }
  }
});

test("cli supports blocks JSON with no data", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-cli-blocks-"));
  const envNames = sourceEnvNames();
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) {
    process.env[name] = join(root, `missing-${name.toLowerCase()}`);
  }
  try {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const code = await run(["blocks", "--json"], { stdout, stderr });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout.text), { blocks: [] });
  } finally {
    for (const [name, value] of previous) {
      restoreEnv(name, value);
    }
  }
});

test("cli accepts source and by-source options with no data", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-cli-source-"));
  const envNames = sourceEnvNames();
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) {
    process.env[name] = join(root, `missing-${name.toLowerCase()}`);
  }
  try {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const code = await run(["daily", "--json", "--source", "copilot", "--by-source"], { stdout, stderr });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout.text), {
      daily: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        totalCost: 0
      }
    });
  } finally {
    for (const [name, value] of previous) {
      restoreEnv(name, value);
    }
  }
});

test("cached refresh reports source health and isolates source failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-source-health-"));
  const file = join(root, "usage.jsonl");
  await writeFile(file, "{}\n", "utf8");
  let normalLoads = 0;
  let emptyLoads = 0;
  const sources: UsageSource[] = [
    {
      name: "normal",
      detect: async () => ({ detected: true, paths: [file] }),
      load: async () => {
        normalLoads += 1;
        return [{ source: "normal", timestamp: "2026-08-19T01:00:00.000Z", inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 }];
      }
    },
    { name: "no-logs", detect: async () => ({ detected: false, paths: [] }), load: async () => [] },
    {
      name: "no-usage",
      detect: async () => ({ detected: true, paths: [file] }),
      load: async () => {
        emptyLoads += 1;
        return [];
      }
    },
    { name: "broken", detect: async () => ({ detected: true, paths: [file] }), load: async () => { throw new Error("fixture failed"); } }
  ];
  const warehouse = emptyWarehouse();
  const first = await loadCachedRecords(parseArgs(["utoken"]), root, warehouse, { stdout: new MemoryWritable() }, sources);
  assert.deepEqual(Object.fromEntries(first.sources.map((status) => [status.name, status.state])), {
    normal: "normal", "no-logs": "no_logs", "no-usage": "no_usage", broken: "failed"
  });
  assert.equal(first.records.length, 1);
  assert.equal(first.sources.find((status) => status.name === "broken")?.error, "fixture failed");

  const second = await loadCachedRecords(parseArgs(["utoken"]), root, { ...warehouse, usageRecords: first.records }, { stdout: new MemoryWritable() }, sources);
  assert.equal(second.sources.find((status) => status.name === "normal")?.cacheHit, true);
  assert.equal(second.sources.find((status) => status.name === "no-usage")?.cacheHit, true);
  assert.equal(normalLoads, 1);
  assert.equal(emptyLoads, 1);

  const selected = await loadCachedRecords(parseArgs(["utoken", "--source", "normal"]), root, { ...warehouse, usageRecords: first.records }, { stdout: new MemoryWritable() }, sources);
  assert.equal(selected.sources.find((status) => status.name === "no-logs")?.state, "skipped");
});

test("budget warns for cost, token, and daily spike", () => {
  const status = calculateBudgetStatus([
    { date: "2026-07-01", totalCost: 20, totalTokens: 400, sourceBreakdown: [], modelBreakdown: [], projectBreakdown: [] },
    { date: "2026-08-01", totalCost: 10, totalTokens: 100, sourceBreakdown: [], modelBreakdown: [], projectBreakdown: [] },
    { date: "2026-08-02", totalCost: 10, totalTokens: 100, sourceBreakdown: [], modelBreakdown: [], projectBreakdown: [] },
    { date: "2026-08-03", totalCost: 30, totalTokens: 900, sourceBreakdown: [], modelBreakdown: [], projectBreakdown: [] }
  ] as never, { monthlyCostLimit: 40, monthlyTokenLimit: 1000, warningPercent: 80, dailyCostSpikeMultiplier: 2, dailyCostSpikeMinimum: 10 }, new Date("2026-08-03T12:00:00.000Z"));
  assert.equal(status.alerts.some((alert) => alert.key === "cost-100"), true);
  assert.equal(status.alerts.some((alert) => alert.key === "token-100"), true);
  assert.equal(status.alerts.some((alert) => alert.key === "spike-2026-08-03"), true);
  assert.equal(status.previousMonth, "2026-07");
  assert.equal(status.previousTokens, 400);
  assert.equal(status.previousCost, 20);
  assert.equal(status.monthlyCostLimit, 40);
  assert.equal(status.monthlyTokenLimit, 1000);
});

class MemoryWritable extends Writable {
  text = "";
  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString();
    callback();
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function sourceEnvNames(): string[] {
  return [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "OPENCODE_DATA_DIR",
    "AMP_DATA_DIR",
    "DROID_SESSIONS_DIR",
    "CODEBUFF_DATA_DIR",
    "HERMES_HOME",
    "PI_AGENT_DIR",
    "GOOSE_PATH_ROOT",
    "OPENCLAW_DIR",
    "KILO_DATA_DIR",
    "COPILOT_SESSION_STATE_DIR",
    "COPILOT_OTEL_FILE_EXPORTER_PATH",
    "GEMINI_DATA_DIR",
    "KIMI_DATA_DIR",
    "QWEN_DATA_DIR",
    "ANTIGRAVITY_DATA_DIR"
  ];
}

function emptyWarehouse(): LocalWarehouse {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-19T00:00:00.000Z",
    config: { identity: { userId: "test", displayName: "Test", role: "individual" }, upload: { enabled: false, schedule: "daily" } },
    usageRecords: [],
    sessionSummaries: [],
    dailyUserSummaries: []
  };
}
