import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run } from "../src/cli.js";
import { startUsageServer } from "../src/product/server.js";
import { startLocalDashboardServer } from "../src/product/server.js";
import type { LocalWarehouse } from "../src/types.js";

test("sync writes warehouse and dashboard renders html", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-product-"));
  const codexHome = join(root, ".codex");
  const sessionDir = join(codexHome, "sessions", "project-alpha");
  const storeDir = join(root, "store");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session-alpha.jsonl"),
    [
      { timestamp: "2026-07-31T09:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.2-codex" } },
      {
        timestamp: "2026-07-31T09:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.2-codex",
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 10,
              reasoning_output_tokens: 5,
              total_tokens: 115
            }
          }
        }
      }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const code = await run(["sync", "--store-dir", storeDir, "--timezone", "Asia/Shanghai", "--source", "codex"]);
    assert.equal(code, 0);
    const warehouse = JSON.parse(await readFile(join(storeDir, "warehouse.json"), "utf8")) as { usageRecords: unknown[]; dailyUserSummaries: unknown[] };
    assert.equal(warehouse.usageRecords.length, 1);
    assert.equal(warehouse.dailyUserSummaries.length, 1);

    const dashboardPath = join(storeDir, "dashboard.html");
    const dashboardCode = await run(["dashboard", "--store-dir", storeDir, "--html-file", dashboardPath]);
    assert.equal(dashboardCode, 0);
    const html = await readFile(dashboardPath, "utf8");
    assert.match(html, /AI 用量仪表盘/);
    assert.match(html, /Token 构成/);
    assert.match(html, /每日明细/);
    assert.match(html, /缓存命中率/);
    assert.equal((await stat(dashboardPath)).isFile(), true);
  } finally {
    if (previousCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("cc syncs and renders dashboard in one command", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-cc-"));
  const codexHome = join(root, ".codex");
  const sessionDir = join(codexHome, "sessions", "project-cc");
  const storeDir = join(root, "store");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session-cc.jsonl"),
    [
      { timestamp: "2026-07-31T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.2-codex" } },
      {
        timestamp: "2026-07-31T12:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.2-codex",
            last_token_usage: {
              input_tokens: 60,
              cached_input_tokens: 10,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 85
            }
          }
        }
      }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const previousCodexHome = process.env.CODEX_HOME;
  const previousNoOpen = process.env.USAGETOKEN_NO_OPEN;
  process.env.CODEX_HOME = codexHome;
  process.env.USAGETOKEN_NO_OPEN = "1";
  try {
    const code = await run(["cc", "--store-dir", storeDir, "--source", "codex"]);
    assert.equal(code, 0);
    const html = await readFile(join(storeDir, "dashboard.html"), "utf8");
    assert.match(html, /AI 用量仪表盘/);
    assert.match(html, /Token 构成/);
    assert.match(html, /会话列表/);
  } finally {
    if (previousCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousNoOpen == null) delete process.env.USAGETOKEN_NO_OPEN;
    else process.env.USAGETOKEN_NO_OPEN = previousNoOpen;
  }
});

test("local dashboard server exposes cached dashboard data", async () => {
  let reported: { userId: string; endpoint: string } | undefined;
  const warehouse: LocalWarehouse = {
    schemaVersion: 1,
    generatedAt: "2026-08-03T00:00:00.000Z",
    config: { identity: { userId: "local", displayName: "Local", role: "individual" }, upload: { enabled: false, schedule: "daily" } },
    usageRecords: [],
    sessionSummaries: [],
    dailyUserSummaries: []
  };
  const dashboard = await startLocalDashboardServer({
    host: "127.0.0.1",
    getWarehouse: () => warehouse,
    getStatus: () => ({
      refreshing: true,
      currentSource: "codex",
      sources: [{ name: "codex", state: "normal", fileCount: 2, recordCount: 4, latestRecordAt: "2026-08-03T00:00:00.000Z", scannedAt: "2026-08-03T00:00:00.000Z", cacheHit: false }]
    }),
    report: async (input) => {
      reported = input;
      return { accepted: true, duplicate: false };
    }
  });
  try {
    const response = await fetch(`${dashboard.url}/api/dashboard/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      generatedAt: warehouse.generatedAt,
      currentVersion: "0.4.0",
      updateAvailable: false,
      scanSummary: { normal: 1, noLogs: 0, noUsage: 0, failed: 0 },
      refreshing: true,
      currentSource: "codex",
      sources: [{ name: "codex", state: "normal", fileCount: 2, recordCount: 4, latestRecordAt: "2026-08-03T00:00:00.000Z", scannedAt: "2026-08-03T00:00:00.000Z", cacheHit: false }]
    });
    const html = await (await fetch(`${dashboard.url}/`)).text();
    assert.match(html, /正在准备 AI 用量仪表盘/);
    assert.match(html, /查看数据源详情/);
    assert.match(html, /codex/);
    const report = await fetch(`${dashboard.url}/api/dashboard/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "user-a", endpoint: "https://example.com/usage/daily-batch" }) });
    assert.deepEqual(await report.json(), { accepted: true, duplicate: false });
    assert.deepEqual(reported, { userId: "user-a", endpoint: "https://example.com/usage/daily-batch" });
  } finally {
    await new Promise<void>((resolve) => dashboard.server.close(() => resolve()));
  }
});

test("daily batch upload ingests into local server rollups", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-server-"));
  const storeDir = join(root, "store");
  const serverDir = join(root, "server");
  const codexHome = join(root, ".codex");
  const sessionDir = join(codexHome, "sessions", "project-beta");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session-beta.jsonl"),
    [
      { timestamp: "2026-07-31T10:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.2-codex" } },
      {
        timestamp: "2026-07-31T10:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.2-codex",
            last_token_usage: {
              input_tokens: 200,
              cached_input_tokens: 50,
              output_tokens: 40,
              reasoning_output_tokens: 10,
              total_tokens: 250
            }
          }
        }
      }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const server = await startUsageServer({
    storeDir: serverDir,
    host: "127.0.0.1",
    port: 0,
    mode: "team",
    io: process
  });

  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    await run(["sync", "--store-dir", storeDir, "--source", "codex"]);
    const configPath = join(storeDir, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { identity: Record<string, string>; upload: Record<string, unknown> };
    config.identity.userId = "user-a";
    config.identity.displayName = "User A";
    config.identity.teamId = "team-a";
    config.identity.teamName = "Team A";
    config.identity.orgId = "org-a";
    config.identity.orgName = "Org A";
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    config.upload.endpoint = `http://127.0.0.1:${address.port}/usage/daily-batch`;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await run(["sync", "--store-dir", storeDir, "--source", "codex"]);

    const code = await run(["upload-daily", "--store-dir", storeDir]);
    assert.equal(code, 0);

    const rollups = JSON.parse(await readFile(join(serverDir, "server-store.json"), "utf8")) as { batches: Array<{ summaries: unknown[] }> };
    assert.equal(rollups.batches.length, 1);
    assert.equal(rollups.batches[0]?.summaries.length, 1);
  } finally {
    server.close();
    if (previousCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});
