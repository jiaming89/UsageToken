import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { run } from "../src/cli.js";

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
