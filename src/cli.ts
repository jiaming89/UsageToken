import { homedir } from "node:os";
import { blocksToCcusageJson, reportToCcusageJson } from "./compat/ccusage.js";
import { normalizeDateBound } from "./core/date.js";
import { summarizeBlocks } from "./core/blocks.js";
import { summarizeAllAgent, summarizeBySource } from "./core/summary.js";
import { renderBlocksTable, renderTable } from "./output/table.js";
import { sources } from "./sources/index.js";
import type { CliOptions, CostMode, ReportKind, UsageRecord } from "./types.js";
import { writeUploadFile } from "./upload.js";

export async function run(argv: string[], io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } = process): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    io.stderr.write("Run 'usagetoken --help' for usage.\n");
    return 2;
  }

  const records = filterRecordsBySource(await loadAllRecords(options), options.source);
  if (options.command === "blocks") {
    const blocks = summarizeBlocks(records.filter((record) => record.source === "claude"), {
      since: options.since,
      until: options.until,
      timezone: options.timezone,
      mode: options.mode
    });
    const payload = blocksToCcusageJson(blocks, options.noCost);
    if (options.uploadFile) {
      await writeUploadFile(options.uploadFile, options.command, payload);
    }
    if (options.json) {
      io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      io.stdout.write(`${renderBlocksTable(blocks)}\n`);
    }
    return 0;
  }

  const summarizeRows = options.bySource && options.command !== "session" ? summarizeBySource : summarizeAllAgent;
  const rows = summarizeRows(records, options.command, {
    since: options.since,
    until: options.until,
    timezone: options.timezone,
    mode: options.mode
  });
  const payload = reportToCcusageJson(options.command, rows, options.noCost);
  if (options.uploadFile) {
    await writeUploadFile(options.uploadFile, options.command, payload);
  }
  if (options.json) {
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    io.stdout.write(`${renderTable(options.command, rows)}\n`);
  }
  return 0;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    printHelpAndExit();
  }
  if (args.includes("--version") || args.includes("-v") || args.includes("-V")) {
    process.stdout.write("usagetoken 0.1.0\n");
    process.exit(0);
  }
  let command: ReportKind = "daily";
  if (args[0] && !args[0].startsWith("-")) {
    command = parseCommand(args.shift() ?? "daily");
  }
  const options: CliOptions = {
    command,
    json: false,
    mode: "auto",
    offline: true,
    noCost: false
  };
  while (args.length > 0) {
    const arg = args.shift() ?? "";
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--since":
      case "-s":
        options.since = normalizeDateBound(requireValue(arg, args.shift()));
        break;
      case "--until":
      case "-u":
        options.until = normalizeDateBound(requireValue(arg, args.shift()));
        break;
      case "--timezone":
      case "-z":
        options.timezone = requireValue(arg, args.shift());
        break;
      case "--mode":
      case "-m":
        options.mode = parseMode(requireValue(arg, args.shift()));
        break;
      case "--offline":
      case "-O":
        options.offline = true;
        break;
      case "--no-offline":
        options.offline = false;
        break;
      case "--no-cost":
        options.noCost = true;
        break;
      case "--upload-file":
        options.uploadFile = requireValue(arg, args.shift());
        break;
      case "--source":
        options.source = requireValue(arg, args.shift());
        break;
      case "--by-source":
        options.bySource = true;
        break;
      default:
        if (arg.startsWith("--since=")) options.since = normalizeDateBound(arg.slice("--since=".length));
        else if (arg.startsWith("--until=")) options.until = normalizeDateBound(arg.slice("--until=".length));
        else if (arg.startsWith("--timezone=")) options.timezone = arg.slice("--timezone=".length);
        else if (arg.startsWith("--mode=")) options.mode = parseMode(arg.slice("--mode=".length));
        else if (arg.startsWith("--upload-file=")) options.uploadFile = arg.slice("--upload-file=".length);
        else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length);
        else throw new Error(`Unknown option '${arg}'`);
    }
  }
  return options;
}

function filterRecordsBySource(records: UsageRecord[], source: string | undefined): UsageRecord[] {
  if (!source) return records;
  return records.filter((record) => record.source === source);
}

async function loadAllRecords(options: CliOptions): Promise<UsageRecord[]> {
  const ctx = {
    env: process.env,
    cwd: process.cwd(),
    homeDir: homedir(),
    since: options.since,
    until: options.until,
    timezone: options.timezone,
    mode: options.mode,
    offline: options.offline
  };
  const all: UsageRecord[] = [];
  for (const source of sources) {
    all.push(...await source.load(ctx));
  }
  return all;
}

function parseCommand(value: string): ReportKind {
  if (["daily", "weekly", "monthly", "session", "blocks"].includes(value)) {
    return value as ReportKind;
  }
  throw new Error(`Unknown command '${value}'`);
}

function parseMode(value: string): CostMode {
  if (["auto", "display", "calculate"].includes(value)) {
    return value as CostMode;
  }
  throw new Error(`Invalid --mode '${value}'`);
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelpAndExit(): never {
  process.stdout.write(`Usage: usagetoken [daily|weekly|monthly|session|blocks] [options]

Options:
  --json                  Print ccusage-compatible JSON
  -s, --since <date>      Include records on or after YYYY-MM-DD
  -u, --until <date>      Include records on or before YYYY-MM-DD
  -z, --timezone <tz>     Date grouping timezone
  -m, --mode <mode>       auto, display, or calculate
  -O, --offline           Use embedded pricing only
  --no-cost               Remove cost fields from JSON
  --upload-file <path>    Write local upload envelope
  --source <name>         Include only one source, e.g. copilot
  --by-source             Split daily/weekly/monthly rows by source
  -h, --help              Show help
  -v, --version           Show version
`);
  process.exit(0);
}
