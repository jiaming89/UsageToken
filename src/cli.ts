import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { blocksToCcusageJson, reportToCcusageJson } from "./compat/ccusage.js";
import { summarizeBlocks } from "./core/blocks.js";
import { normalizeDateBound, withinDateRange } from "./core/date.js";
import { summarizeAllAgent, summarizeBySource } from "./core/summary.js";
import { renderBlocksTable, renderTable } from "./output/table.js";
import { renderReportHtml, writeReportHtml } from "./output/html-report.js";
import { readProductConfig } from "./product/config.js";
import { writeDashboardFile } from "./product/dashboard.js";
import { openInBrowser } from "./product/open.js";
import { startLocalDashboardServer, startUsageServer } from "./product/server.js";
import { readPendingUploads, readWarehouse, writePendingUploads, writeWarehouse, readSourceCache, writeSourceCache } from "./product/store.js";
import { postDailyBatch } from "./product/upload.js";
import { createDailyUserSummaries, createSessionSummaries, createUploadBatch } from "./product/warehouse.js";
import { sources } from "./sources/index.js";
import type { CliCommand, CliOptions, CostMode, LocalWarehouse, ProductCommand, ReportKind, UsageRecord } from "./types.js";
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

  if (isProductCommand(options.command)) {
    return await runProductCommand(options, io);
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
    } else if (options.html) {
      const path = await writeReportHtml(options.command, options.htmlFile, blocks);
      io.stdout.write(`${path}\n`);
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
  } else if (options.html) {
    const path = await writeReportHtml(options.command, options.htmlFile, rows);
    io.stdout.write(`${path}\n`);
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
    process.stdout.write("usagetoken 0.1.8\n");
    process.exit(0);
  }
  let command: CliCommand = "daily";
  if (args[0] && !args[0].startsWith("-")) {
    command = parseCommand(args.shift() ?? "daily");
  }
  const options: CliOptions = {
    command,
    json: false,
    mode: "auto",
    offline: true,
    noCost: false,
    host: "127.0.0.1",
    port: 8787,
    serverMode: "team"
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
      case "--html":
        options.html = true;
        break;
      case "--html-file":
        options.htmlFile = requireValue(arg, args.shift());
        break;
      case "--store-dir":
        options.storeDir = requireValue(arg, args.shift());
        break;
      case "--port":
        options.port = Number.parseInt(requireValue(arg, args.shift()), 10);
        break;
      case "--host":
        options.host = requireValue(arg, args.shift());
        break;
      case "--server-mode":
        options.serverMode = parseServerMode(requireValue(arg, args.shift()));
        break;
      case "--endpoint":
        options.endpoint = requireValue(arg, args.shift());
        break;
      default:
        if (arg.startsWith("--since=")) options.since = normalizeDateBound(arg.slice("--since=".length));
        else if (arg.startsWith("--until=")) options.until = normalizeDateBound(arg.slice("--until=".length));
        else if (arg.startsWith("--timezone=")) options.timezone = arg.slice("--timezone=".length);
        else if (arg.startsWith("--mode=")) options.mode = parseMode(arg.slice("--mode=".length));
        else if (arg.startsWith("--upload-file=")) options.uploadFile = arg.slice("--upload-file=".length);
        else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length);
        else if (arg.startsWith("--html-file=")) options.htmlFile = arg.slice("--html-file=".length);
        else if (arg.startsWith("--store-dir=")) options.storeDir = arg.slice("--store-dir=".length);
        else if (arg.startsWith("--port=")) options.port = Number.parseInt(arg.slice("--port=".length), 10);
        else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
        else if (arg.startsWith("--server-mode=")) options.serverMode = parseServerMode(arg.slice("--server-mode=".length));
        else if (arg.startsWith("--endpoint=")) options.endpoint = arg.slice("--endpoint=".length);
        else throw new Error(`Unknown option '${arg}'`);
    }
  }
  if (options.port != null && (!Number.isFinite(options.port) || options.port <= 0)) {
    throw new Error("Invalid --port");
  }
  return options;
}

function filterRecordsBySource(records: UsageRecord[], source: string | undefined): UsageRecord[] {
  if (!source) return records;
  return records.filter((record) => record.source === source);
}

async function runProductCommand(options: CliOptions, io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream }): Promise<number> {
  const storeDir = resolveStoreDir(options.storeDir);
  const config = await readProductConfig(storeDir);
  if (options.command === "sync") {
    const records = filterRecordsBySource(await loadAllRecords(options), options.source);
    const sessionSummaries = createSessionSummaries(records, options.timezone, options.mode);
    const dailyUserSummaries = createDailyUserSummaries(records, config, options.timezone, options.mode);
    const warehouse = await writeWarehouse(storeDir, config, { usageRecords: records, sessionSummaries, dailyUserSummaries });
    io.stdout.write(`Synced ${warehouse.usageRecords.length} usage records into ${storeDir}\n`);
    return 0;
  }
  if (options.command === "dashboard") {
    const warehouse = await ensureWarehouse(storeDir, options);
    const path = await writeDashboardFile(storeDir, warehouse, options.htmlFile);
    io.stdout.write(`${path}\n`);
    return 0;
  }
  if (options.command === "cc") {
    const records = filterRecordsBySource(await loadAllRecords(options), options.source);
    const sessionSummaries = createSessionSummaries(records, options.timezone, options.mode);
    const dailyUserSummaries = createDailyUserSummaries(records, config, options.timezone, options.mode);
    const warehouse = await writeWarehouse(storeDir, config, { usageRecords: records, sessionSummaries, dailyUserSummaries });
    const path = await writeDashboardFile(storeDir, warehouse, options.htmlFile);
    await openInBrowser(path);
    io.stdout.write(`Opened ${path}\n`);
    return 0;
  }
  if (options.command === "utoken") {
    let warehouse = await readWarehouse(storeDir, config);
    let refreshing = false;
    let lastError: string | undefined;
    let refresh: () => Promise<void>;
    const dashboard = await startLocalDashboardServer({
      host: "127.0.0.1",
      defaultSince: options.since,
      getWarehouse: () => warehouse,
      getStatus: () => ({ refreshing, lastError }),
      refresh: () => refresh()
    });
    io.stdout.write(`Dashboard listening on ${dashboard.url}\n`);
    refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      lastError = undefined;
      try {
        io.stdout.write("Refreshing usage cache…\n");
        const records = await loadCachedRecords(options, storeDir, warehouse, io);
        const sessionSummaries = createSessionSummaries(records, options.timezone, options.mode);
        const dailyUserSummaries = createDailyUserSummaries(records, config, options.timezone, options.mode);
        warehouse = await writeWarehouse(storeDir, config, { usageRecords: records, sessionSummaries, dailyUserSummaries });
        io.stdout.write(`Cache refreshed: ${records.length} records. Next refresh in 15 minutes.\n`);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        io.stderr.write(`Cache refresh failed: ${lastError}\n`);
      } finally {
        refreshing = false;
      }
    };
    await openInBrowser(dashboard.url);
    void refresh();
    const timer = setInterval(() => void refresh(), 15 * 60 * 1000);
    return await new Promise<number>((resolve) => {
      const stop = () => {
        clearInterval(timer);
        dashboard.server.close(() => resolve(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }
  if (options.command === "upload-daily") {
    const warehouse = await ensureWarehouse(storeDir, options);
    const endpoint = options.endpoint ?? config.upload.endpoint;
    if (!endpoint) {
      io.stderr.write("No upload endpoint configured. Set --endpoint or store config upload.endpoint.\n");
      return 2;
    }
    if (warehouse.dailyUserSummaries.length === 0) {
      io.stdout.write("No daily summaries to upload.\n");
      return 0;
    }
    const batch = createUploadBatch(config, warehouse.dailyUserSummaries);
    try {
      const result = await postDailyBatch(endpoint, batch);
      if (!result.duplicate) {
        await writePendingUploads(storeDir, []);
      }
      io.stdout.write(`${result.duplicate ? "Duplicate" : "Uploaded"} daily batch ${batch.batchId}\n`);
      return 0;
    } catch (error) {
      const pending = await readPendingUploads(storeDir);
      pending.push(batch);
      await writePendingUploads(storeDir, pending);
      io.stderr.write(`Upload failed, batch queued locally: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (options.command === "serve") {
    await startUsageServer({
      storeDir,
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 8787,
      mode: options.serverMode ?? "team",
      io
    });
    return await new Promise<number>(() => {});
  }
  io.stderr.write(`Unsupported command '${options.command}'\n`);
  return 2;
}

async function ensureWarehouse(storeDir: string, options: CliOptions) {
  const config = await readProductConfig(storeDir);
  const existing = await readWarehouse(storeDir, config);
  if (existing.usageRecords.length > 0 || existing.dailyUserSummaries.length > 0) {
    return existing;
  }
  const records = filterRecordsBySource(await loadAllRecords(options), options.source);
  const sessionSummaries = createSessionSummaries(records, options.timezone, options.mode);
  const dailyUserSummaries = createDailyUserSummaries(records, config, options.timezone, options.mode);
  return await writeWarehouse(storeDir, config, { usageRecords: records, sessionSummaries, dailyUserSummaries });
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
    if (options.source && source.name !== options.source) continue;
    const records = await source.load(ctx);
    all.push(...records.filter((record) => withinDateRange(record.timestamp, options.timezone, options.since, options.until)));
  }
  return all;
}

async function loadCachedRecords(options: CliOptions, storeDir: string, warehouse: LocalWarehouse, io: { stdout: NodeJS.WritableStream }): Promise<UsageRecord[]> {
  const cache = await readSourceCache(storeDir);
  const ctx = { env: process.env, cwd: process.cwd(), homeDir: homedir(), mode: options.mode, offline: options.offline };
  const cachedBySource = new Map<string, UsageRecord[]>();
  for (const record of warehouse.usageRecords) {
    const entries = cachedBySource.get(record.source) ?? [];
    entries.push(record);
    cachedBySource.set(record.source, entries);
  }
  const all: UsageRecord[] = [];
  const fingerprints: Record<string, string> = {};
  for (const source of sources) {
    if (options.source && source.name !== options.source) continue;
    const detected = await source.detect(ctx);
    const fingerprint = await fingerprintPaths(detected.paths);
    fingerprints[source.name] = fingerprint;
    if (cache.fingerprints[source.name] === fingerprint && cachedBySource.has(source.name)) {
      io.stdout.write(`Using cached ${source.name} records.\n`);
      all.push(...(cachedBySource.get(source.name) ?? []));
    } else {
      io.stdout.write(`Scanning ${source.name}…\n`);
      all.push(...await source.load(ctx));
    }
  }
  if (options.source) {
    for (const [name, records] of cachedBySource) {
      if (name !== options.source) all.push(...records);
    }
  }
  await writeSourceCache(storeDir, { fingerprints: { ...cache.fingerprints, ...fingerprints } });
  return all;
}

async function fingerprintPaths(paths: string[]): Promise<string> {
  const parts = await Promise.all(paths.sort().map(async (path) => {
    try { const info = await stat(path); return `${path}:${info.size}:${info.mtimeMs}`; } catch { return `${path}:missing`; }
  }));
  return parts.join("|");
}

function parseCommand(value: string): CliCommand {
  if (["daily", "weekly", "monthly", "session", "blocks", "sync", "dashboard", "upload-daily", "serve", "cc", "utoken"].includes(value)) {
    return value as CliCommand;
  }
  throw new Error(`Unknown command '${value}'`);
}

function parseMode(value: string): CostMode {
  if (["auto", "display", "calculate"].includes(value)) {
    return value as CostMode;
  }
  throw new Error(`Invalid --mode '${value}'`);
}

function parseServerMode(value: string): "local" | "team" | "org" {
  if (["local", "team", "org"].includes(value)) {
    return value as "local" | "team" | "org";
  }
  throw new Error(`Invalid --server-mode '${value}'`);
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function resolveStoreDir(storeDir: string | undefined): string {
  return storeDir ?? join(homedir(), ".usagetoken");
}

function isProductCommand(value: CliCommand): value is ProductCommand {
  return ["sync", "dashboard", "upload-daily", "serve", "cc", "utoken"].includes(value);
}

function printHelpAndExit(): never {
  process.stdout.write(`Usage: usagetoken [daily|weekly|monthly|session|blocks|sync|dashboard|upload-daily|serve|cc] [options]

Classic report options:
  --json                  Print ccusage-compatible JSON
  --html                  Generate an HTML report file
  -s, --since <date>      Include records on or after YYYY-MM-DD
  -u, --until <date>      Include records on or before YYYY-MM-DD
  -z, --timezone <tz>     Date grouping timezone
  -m, --mode <mode>       auto, display, or calculate
  -O, --offline           Use embedded pricing only
  --no-cost               Remove cost fields from JSON
  --upload-file <path>    Write local upload envelope
  --source <name>         Include only one source, e.g. copilot
  --by-source             Split daily/weekly/monthly rows by source

Product options:
  --store-dir <path>      Local warehouse directory, default ~/.usagetoken
  --html-file <path>      Dashboard output HTML file
  --endpoint <url>        Upload endpoint for upload-daily
  --host <host>           Host for serve, default 127.0.0.1
  --port <port>           Port for serve, default 8787
  --server-mode <mode>    local, team, or org
  utoken                  Start the live local dashboard with background refresh
  cc                      Legacy one-shot dashboard command

Other:
  -h, --help              Show help
  -v, --version           Show version
`);
  process.exit(0);
}
