#!/usr/bin/env node
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const commands = parseCommands(process.argv.slice(2));
const scenarios = [
  ["--json", "--offline"],
  ["--json", "--offline", "--mode", "display"],
  ["--json", "--offline", "--timezone", "Asia/Shanghai"],
  ["--json", "--offline", "--no-cost"]
];

const ccusage = findCcusage();
const usagetoken = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "usagetoken.js");
let failures = 0;

for (const command of commands) {
  for (const args of scenarios) {
    const expected = runJson(ccusage, [command, ...args]);
    const actual = runJson(["node", usagetoken], [command, ...args], usagetokenDiffEnv());
    const diffs = diff(normalize(expected), normalize(actual));
    const label = `${command} ${args.join(" ")}`;
    if (diffs.length === 0) {
      process.stdout.write(`ok ${label}\n`);
    } else {
      failures += 1;
      process.stderr.write(`not ok ${label}\n`);
      for (const item of diffs.slice(0, 80)) {
        process.stderr.write(`  ${item.path}: expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}\n`);
      }
      if (diffs.length > 80) {
        process.stderr.write(`  ... ${diffs.length - 80} more differences\n`);
      }
    }
  }
}

process.exit(failures === 0 ? 0 : 1);

function parseCommands(args: string[]): string[] {
  const selected = args.filter((arg) => ["daily", "weekly", "monthly", "session", "blocks"].includes(arg));
  return selected.length > 0 ? selected : ["daily", "weekly", "monthly", "session"];
}

function findCcusage(): Command {
  const root = process.env.CCUSAGE_ROOT;
  const platformName = platform() === "darwin" ? "darwin" : platform() === "linux" ? "linux" : "win32";
  const archName = arch() === "arm64" ? "arm64" : "x64";
  const candidates: Command[] = [["ccusage"]];
  if (root) {
    candidates.unshift(
      [join(root, "rust", "target", "release", "ccusage")],
      [join(root, "packages", `ccusage-${platformName}-${archName}`, "bin", platformName === "win32" ? "ccusage.exe" : "ccusage")]
    );
    candidates.push(["cargo", "run", "--quiet", "--manifest-path", join(root, "rust", "Cargo.toml"), "--bin", "ccusage", "--"]);
  }
  for (const candidate of candidates) {
    if (candidate[0] === "ccusage") {
      if (commandAvailable("ccusage")) return candidate;
    } else if (candidate[0] === "cargo") {
      const manifestPath = candidate[candidate.indexOf("--manifest-path") + 1];
      if (manifestPath && existsSync(manifestPath) && commandAvailable("cargo")) return candidate;
    } else if (existsSync(candidate[0])) {
      return candidate;
    }
  }
  throw new Error("Could not find a runnable ccusage executable. Install ccusage globally, or set CCUSAGE_ROOT to a local ccusage checkout.");
}

function runJson(command: Command, args: string[], env: NodeJS.ProcessEnv = process.env): unknown {
  const [bin, ...prefix] = command;
  const result = spawnSync(bin, [...prefix, ...args], { encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(`${[bin, ...prefix, ...args].join(" ")} failed\n${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${[bin, ...prefix, ...args].join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

type Command = [string, ...string[]];

function normalize(value: unknown): unknown {
  if (typeof value === "number") {
    return Number(value.toFixed(10));
  }
  if (Array.isArray(value)) {
    return value.map(normalize).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (["duration", "cacheCreationTokensDetails"].includes(key)) continue;
    out[key] = normalize(input[key]);
  }
  return out;
}

function sortKey(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const row = value as Record<string, unknown>;
  return String(`${row.agent ?? ""}\0${row.period ?? row.date ?? row.week ?? row.month ?? row.sessionId ?? row.modelName ?? JSON.stringify(row)}`);
}

function usagetokenDiffEnv(): NodeJS.ProcessEnv {
  if (process.env.USAGETOKEN_DIFF_INCLUDE_COPILOT_SESSION_STATE === "1") {
    return process.env;
  }
  return {
    ...process.env,
    COPILOT_SESSION_STATE_DIR: process.env.COPILOT_SESSION_STATE_DIR ?? "/tmp/usagetoken-missing-copilot-session-state"
  };
}

function diff(expected: unknown, actual: unknown, path = "$"): Array<{ path: string; expected: unknown; actual: unknown }> {
  if (Object.is(expected, actual)) return [];
  if (typeof expected === "number" && typeof actual === "number" && Math.abs(expected - actual) < 1e-8) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [{ path, expected, actual }];
    const out: Array<{ path: string; expected: unknown; actual: unknown }> = expected.length === actual.length ? [] : [{ path: `${path}.length`, expected: expected.length, actual: actual.length }];
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      out.push(...diff(expected[index], actual[index], `${path}[${index}]`));
    }
    return out;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => diff(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, expected, actual }];
}
