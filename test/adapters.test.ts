import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ClaudeSource } from "../src/sources/claude.js";
import { CodexSource } from "../src/sources/codex.js";
import { CopilotSource } from "../src/sources/copilot.js";
import { GenericJsonUsageSource } from "../src/sources/generic.js";
import { GooseSource, HermesSource, KiloSource, OpenCodeSource } from "../src/sources/sqliteSources.js";

test("generic source detects usage files instead of their parent directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-generic-"));
  const file = join(root, "session", "usage.jsonl");
  await mkdir(join(root, "session"), { recursive: true });
  await writeFile(file, "{}\n", "utf8");

  const detected = await new GenericJsonUsageSource({ name: "test", envVar: "TEST_DATA_DIR", defaultPaths: () => [] })
    .detect({ env: { TEST_DATA_DIR: root }, cwd: root, homeDir: root });

  assert.deepEqual(detected.paths, [file]);
});

test("claude source parses message usage JSONL", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-claude-"));
  const project = join(root, "projects", "project-alpha", "session-alpha");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, "chat.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-01-09T10:00:00.000Z",
      sessionId: "session-alpha",
      message: {
        id: "msg-alpha-1",
        model: "claude-sonnet-4-20250514",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 25,
          cache_read_input_tokens: 10
        }
      },
      costUSD: 0.12
    })}\n`,
    "utf8"
  );

  const source = new ClaudeSource();
  const detected = await source.detect({ env: { CLAUDE_CONFIG_DIR: root }, cwd: root, homeDir: root });
  assert.deepEqual(detected.paths, [join(project, "chat.jsonl")]);
  const records = await source.load({
    env: { CLAUDE_CONFIG_DIR: root },
    cwd: root,
    homeDir: root,
    mode: "auto",
    offline: true
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.source, "claude");
  assert.equal(records[0]?.inputTokens, 100);
  assert.equal(records[0]?.cacheCreationTokens, 25);
  assert.equal(records[0]?.costUSD, 0.12);
});

test("hermes source loads billable sessions from state.db", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-hermes-"));
  const db = new DatabaseSync(join(root, "state.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT, started_at REAL NOT NULL,
      message_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
      billing_provider TEXT, estimated_cost_usd REAL, actual_cost_usd REAL
    );
    INSERT INTO sessions VALUES ('session-1', 'cli', 'claude-sonnet-4-20250514', 1750000000.25, 42, 1200, 300, 50, 20, 10, 'anthropic', 0.12, 0.34);
  `);
  db.close();

  const records = await new HermesSource().load({ env: { HERMES_HOME: root }, cwd: root, homeDir: root, mode: "auto", offline: true });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.timestamp, "2025-06-15T15:06:40.250Z");
  assert.equal(records[0]?.sessionId, "session-1");
  assert.equal(records[0]?.cacheCreationTokens, 20);
  assert.equal(records[0]?.cacheReadTokens, 50);
  assert.equal(records[0]?.extraTotalTokens, 10);
  assert.equal(records[0]?.messageCount, 42);
  assert.equal(records[0]?.costUSD, 0.34);
});

test("goose source loads accumulated token columns from sessions.db", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-goose-"));
  const dir = join(root, "data", "sessions");
  await mkdir(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "sessions.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, model_config_json TEXT, provider_name TEXT, created_at TEXT,
      total_tokens INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      accumulated_total_tokens INTEGER, accumulated_input_tokens INTEGER, accumulated_output_tokens INTEGER
    );
    INSERT INTO sessions VALUES ('session-a', '{"model_name":"claude-sonnet-4-20250514"}', 'anthropic', '2026-05-01 01:02:03', 0, 0, 0, 180, 100, 50);
  `);
  db.close();

  const records = await new GooseSource().load({ env: { GOOSE_PATH_ROOT: root }, cwd: root, homeDir: root, mode: "auto", offline: true });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.timestamp, "2026-05-01T01:02:03.000Z");
  assert.equal(records[0]?.inputTokens, 100);
  assert.equal(records[0]?.outputTokens, 50);
  assert.equal(records[0]?.extraTotalTokens, 30);
});

test("kilo source loads assistant messages from kilo.db", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-kilo-"));
  const db = new DatabaseSync(join(root, "kilo.db"));
  db.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)");
  db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
    "row-1",
    "session-a",
    JSON.stringify({
      id: "msg-1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      time: { created: 1767312000000 },
      tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 20 } },
      cost: 0.02
    })
  );
  db.close();

  const records = await new KiloSource().load({ env: { KILO_DATA_DIR: root }, cwd: root, homeDir: root, mode: "display", offline: true });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.timestamp, "2026-01-02T00:00:00.000Z");
  assert.equal(records[0]?.messageId, "msg-1");
  assert.equal(records[0]?.extraTotalTokens, 5);
  assert.equal(records[0]?.costUSD, 0.02);
});

test("opencode source prefers database messages over duplicate legacy files", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-opencode-"));
  await mkdir(join(root, "storage", "message", "session-a"), { recursive: true });
  await writeFile(
    join(root, "storage", "message", "session-a", "msg-1.json"),
    JSON.stringify({ id: "msg-1", sessionID: "json-session", providerID: "anthropic", modelID: "claude-sonnet-4-20250514", time: { created: 1767312000000 }, tokens: { input: 999, output: 999 }, cost: 0.99 }),
    "utf8"
  );
  const db = new DatabaseSync(join(root, "opencode.db"));
  db.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)");
  db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
    "msg-1",
    "db-session",
    JSON.stringify({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514", time: { created: 1767312000000 }, tokens: { input: 120, output: 60, cache: { read: 12, write: 24 } }, cost: 0.03 })
  );
  db.close();

  const source = new OpenCodeSource();
  const detected = await source.detect({ env: { OPENCODE_DATA_DIR: root }, cwd: root, homeDir: root });
  assert.deepEqual(detected.paths, [join(root, "opencode.db"), join(root, "storage", "message", "session-a", "msg-1.json")]);
  const records = await source.load({ env: { OPENCODE_DATA_DIR: root }, cwd: root, homeDir: root, mode: "display", offline: true });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.sessionId, "db-session");
  assert.equal(records[0]?.inputTokens, 120);
  assert.equal(records[0]?.costUSD, 0.03);
});

test("opencode source detects legacy message files instead of its parent directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-opencode-"));
  const file = join(root, "storage", "message", "session-a", "msg-1.json");
  await mkdir(join(root, "storage", "message", "session-a"), { recursive: true });
  await writeFile(file, "{}", "utf8");

  const detected = await new OpenCodeSource().detect({ env: { OPENCODE_DATA_DIR: root }, cwd: root, homeDir: root });

  assert.deepEqual(detected.paths, [file]);
});

test("codex source parses token_count events with cached and reasoning tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-codex-"));
  const sessions = join(root, "sessions", "project-alpha");
  await mkdir(sessions, { recursive: true });
  await writeFile(
    join(sessions, "session-alpha.jsonl"),
    [
      { timestamp: "2026-05-13T09:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.2-codex" } },
      {
        timestamp: "2026-05-13T09:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.2-codex",
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 250,
              output_tokens: 125,
              reasoning_output_tokens: 75,
              total_tokens: 1200
            }
          }
        }
      }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const source = new CodexSource();
  const detected = await source.detect({ env: { CODEX_HOME: root }, cwd: root, homeDir: root });
  assert.deepEqual(detected.paths, [join(sessions, "session-alpha.jsonl")]);
  const records = await source.load({
    env: { CODEX_HOME: root },
    cwd: root,
    homeDir: root,
    mode: "auto",
    offline: true
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.inputTokens, 750);
  assert.equal(records[0]?.cacheReadTokens, 250);
  assert.equal(records[0]?.outputTokens, 125);
  assert.equal(records[0]?.extraTotalTokens, 75);
});

test("copilot source discovers and parses session-state events.jsonl files", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-copilot-"));
  const sessionRoot = join(root, ".copilot", "session-state");
  const sessionDir = join(sessionRoot, "7c70a95b-d455-4a70-8aa5-79dca6a23c56");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "events.jsonl"),
    [
      {
        type: "session.model_change",
        id: "model-change-1",
        timestamp: "2026-07-31T08:00:00.000Z",
        data: { newModel: "gpt-5-copilot" }
      },
      {
        type: "assistant.message",
        id: "event-1",
        timestamp: "2026-07-31T08:01:00.000Z",
        data: {
          messageId: "message-1",
          requestId: "request-1",
          outputTokens: 123,
          interactionId: "interaction-1",
          turnId: "turn-1"
        }
      },
      {
        type: "assistant.message",
        id: "event-2",
        timestamp: "2026-07-31T08:02:00.000Z",
        data: {
          sessionId: "session-from-data",
          messageId: "message-2",
          serviceRequestId: "service-request-2",
          model: "gpt-5-copilot-explicit",
          outputTokens: 45,
          interactionId: "interaction-2",
          turnId: "turn-2"
        }
      },
      {
        type: "assistant.message",
        id: "event-2-duplicate",
        timestamp: "2026-07-31T08:02:30.000Z",
        data: {
          sessionId: "session-from-data",
          messageId: "message-2",
          serviceRequestId: "service-request-2",
          model: "gpt-5-copilot-explicit",
          outputTokens: 45
        }
      },
      { type: "assistant.message", id: "zero-output", timestamp: "2026-07-31T08:03:00.000Z", data: { outputTokens: 0 } },
      { type: "assistant.message", id: "missing-timestamp", data: { outputTokens: 10 } }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const source = new CopilotSource();
  const detection = await source.detect({ env: {}, cwd: root, homeDir: root });
  const records = await source.load({ env: {}, cwd: root, homeDir: root, mode: "auto", offline: true });

  assert.equal(detection.detected, true);
  assert.deepEqual(detection.paths, [join(sessionDir, "events.jsonl")]);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.source, "copilot");
  assert.equal(records[0]?.sessionId, "7c70a95b-d455-4a70-8aa5-79dca6a23c56");
  assert.equal(records[0]?.messageId, "message-1");
  assert.equal(records[0]?.requestId, "request-1");
  assert.equal(records[0]?.model, "gpt-5-copilot");
  assert.equal(records[0]?.inputTokens, 0);
  assert.equal(records[0]?.outputTokens, 123);
  assert.equal(records[0]?.cacheCreationTokens, 0);
  assert.equal(records[0]?.cacheReadTokens, 0);
  assert.equal(records[0]?.projectPath, "GitHub Copilot CLI");
  assert.deepEqual(records[0]?.metadata, {
    interactionId: "interaction-1",
    turnId: "turn-1",
    eventType: "session-state"
  });
  assert.equal(records[1]?.sessionId, "session-from-data");
  assert.equal(records[1]?.requestId, "service-request-2");
  assert.equal(records[1]?.model, "gpt-5-copilot-explicit");
  assert.equal(records[1]?.outputTokens, 45);
});

test("copilot source supplements assistant output with session shutdown model metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-copilot-shutdown-"));
  const sessionRoot = join(root, ".copilot", "session-state");
  const sessionDir = join(sessionRoot, "session-with-shutdown");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "events.jsonl"),
    [
      {
        type: "assistant.message",
        id: "event-1",
        timestamp: "2026-07-31T08:01:00.000Z",
        data: { messageId: "message-1", outputTokens: 10 }
      },
      {
        type: "session.shutdown",
        id: "shutdown-1",
        timestamp: "2026-07-31T08:02:00.000Z",
        data: {
          totalPremiumRequests: 2,
          totalApiDurationMs: 3456,
          modelMetrics: {
            "gpt-5.4": {
              requests: { count: 2, cost: 1 },
              usage: {
                inputTokens: 1000,
                outputTokens: 10,
                cacheReadTokens: 800,
                cacheWriteTokens: 50,
                reasoningTokens: 25
              },
              tokenDetails: {
                input: { tokenCount: 150 },
                cache_read: { tokenCount: 800 },
                cache_write: { tokenCount: 50 },
                output: { tokenCount: 10 }
              }
            }
          }
        }
      }
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );

  const records = await new CopilotSource().load({ env: {}, cwd: root, homeDir: root, mode: "auto", offline: true });

  assert.equal(records.length, 2);
  const totals = records.reduce((acc, record) => {
    acc.inputTokens += record.inputTokens;
    acc.outputTokens += record.outputTokens;
    acc.cacheReadTokens += record.cacheReadTokens;
    acc.cacheCreationTokens += record.cacheCreationTokens;
    acc.extraTotalTokens += record.extraTotalTokens ?? 0;
    return acc;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, extraTotalTokens: 0 });
  assert.deepEqual(totals, {
    inputTokens: 150,
    outputTokens: 10,
    cacheReadTokens: 800,
    cacheCreationTokens: 50,
    extraTotalTokens: 25
  });
  assert.equal(records[0]?.model, "gpt-5.4");
  assert.equal(records[0]?.outputTokens, 0);
  assert.equal(records[0]?.messageCount, 2);
  assert.equal(records[0]?.credits, 1);
  assert.equal(records[0]?.metadata?.eventType, "session-state-shutdown");
});

test("copilot source only reads OTel when COPILOT_OTEL_FILE_EXPORTER_PATH is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "usagetoken-copilot-otel-"));
  const otelDir = join(root, ".copilot", "otel");
  await mkdir(otelDir, { recursive: true });
  const otelFile = join(otelDir, "events.jsonl");
  await writeFile(
    otelFile,
    `${JSON.stringify({
      timestamp: "2026-07-31T09:00:00.000Z",
      attributes: {
        "session.id": "otel-session",
        "gen_ai.request.model": "gpt-5-copilot-otel",
        "gen_ai.usage.input_tokens": 50,
        "gen_ai.usage.output_tokens": 20,
        "gen_ai.message.id": "otel-message",
        "gen_ai.request.id": "otel-request"
      }
    })}\n`,
    "utf8"
  );

  const source = new CopilotSource();
  const defaultRecords = await source.load({ env: {}, cwd: root, homeDir: root, mode: "auto", offline: true });
  const explicitRecords = await source.load({
    env: { COPILOT_OTEL_FILE_EXPORTER_PATH: otelFile },
    cwd: root,
    homeDir: root,
    mode: "auto",
    offline: true
  });

  assert.equal(defaultRecords.length, 0);
  assert.equal(explicitRecords.length, 1);
  assert.equal(explicitRecords[0]?.sessionId, "otel-session");
  assert.equal(explicitRecords[0]?.messageId, "otel-message");
  assert.equal(explicitRecords[0]?.requestId, "otel-request");
  assert.equal(explicitRecords[0]?.inputTokens, 50);
  assert.equal(explicitRecords[0]?.outputTokens, 20);
});
