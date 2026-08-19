import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DailyUserSummary, LocalWarehouse, ProductConfig, SessionSummaryRecord, SourceScanStatus, UploadBatch, UsageRecord } from "../types.js";

export interface AlertState { sent: Record<string, string>; }

export interface SourceCache {
  fingerprints: Record<string, string>;
  statuses: Record<string, SourceScanStatus>;
}

export async function readWarehouse(storeDir: string, config: ProductConfig): Promise<LocalWarehouse> {
  const path = warehousePath(storeDir);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as LocalWarehouse;
    return {
      schemaVersion: 1,
      generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
      config,
      usageRecords: parsed.usageRecords ?? [],
      sessionSummaries: parsed.sessionSummaries ?? [],
      dailyUserSummaries: parsed.dailyUserSummaries ?? []
    };
  } catch {
    return emptyWarehouse(config);
  }
}

export async function writeWarehouse(
  storeDir: string,
  config: ProductConfig,
  payload: { usageRecords: UsageRecord[]; sessionSummaries: SessionSummaryRecord[]; dailyUserSummaries: DailyUserSummary[] }
): Promise<LocalWarehouse> {
  const warehouse: LocalWarehouse = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    config,
    usageRecords: payload.usageRecords,
    sessionSummaries: payload.sessionSummaries,
    dailyUserSummaries: payload.dailyUserSummaries
  };
  const path = warehousePath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(warehouse, null, 2)}\n`, "utf8");
  return warehouse;
}

export async function readPendingUploads(storeDir: string): Promise<UploadBatch[]> {
  const path = pendingUploadsPath(storeDir);
  try {
    return JSON.parse(await readFile(path, "utf8")) as UploadBatch[];
  } catch {
    return [];
  }
}

export async function writePendingUploads(storeDir: string, batches: UploadBatch[]): Promise<void> {
  const path = pendingUploadsPath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(batches, null, 2)}\n`, "utf8");
}

export async function readSourceCache(storeDir: string): Promise<SourceCache> {
  try {
    const parsed = JSON.parse(await readFile(sourceCachePath(storeDir), "utf8")) as SourceCache;
    return { fingerprints: parsed.fingerprints ?? {}, statuses: parsed.statuses ?? {} };
  } catch {
    return { fingerprints: {}, statuses: {} };
  }
}

export async function writeSourceCache(storeDir: string, cache: SourceCache): Promise<void> {
  const path = sourceCachePath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export async function enqueuePendingUpload(storeDir: string, batch: UploadBatch): Promise<void> {
  const batches = await readPendingUploads(storeDir);
  if (!batches.some((item) => item.batchId === batch.batchId)) {
    batches.push(batch);
    await writePendingUploads(storeDir, batches);
  }
}

export async function readAlertState(storeDir: string): Promise<AlertState> {
  try { return { sent: (JSON.parse(await readFile(alertStatePath(storeDir), "utf8")) as AlertState).sent ?? {} }; } catch { return { sent: {} }; }
}

export async function writeAlertState(storeDir: string, state: AlertState): Promise<void> {
  const path = alertStatePath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function warehousePath(storeDir: string): string {
  return join(storeDir, "warehouse.json");
}

function pendingUploadsPath(storeDir: string): string {
  return join(storeDir, "pending-uploads.json");
}

function sourceCachePath(storeDir: string): string {
  return join(storeDir, "source-cache.json");
}

function alertStatePath(storeDir: string): string { return join(storeDir, "alert-state.json"); }

function emptyWarehouse(config: ProductConfig): LocalWarehouse {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    config,
    usageRecords: [],
    sessionSummaries: [],
    dailyUserSummaries: []
  };
}
