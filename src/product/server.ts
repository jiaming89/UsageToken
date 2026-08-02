import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderTeamDashboardHtml } from "./dashboard.js";
import type { OrgDailySummary, TeamDailySummary, UploadBatch } from "../types.js";

interface ServerStore {
  schemaVersion: 1;
  batches: UploadBatch[];
}

export async function startUsageServer(options: {
  storeDir: string;
  host: string;
  port: number;
  mode: "local" | "team" | "org";
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
}): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      await routeRequest(options.storeDir, options.mode, req, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
  options.io.stdout.write(`Usage server listening on http://${options.host}:${options.port}\n`);
  return server;
}

export async function ingestUploadBatch(storeDir: string, batch: UploadBatch): Promise<{ accepted: boolean; duplicate: boolean }> {
  const store = await readServerStore(storeDir);
  if (store.batches.some((item) => item.batchId === batch.batchId)) {
    return { accepted: true, duplicate: true };
  }
  store.batches.push(batch);
  await writeServerStore(storeDir, store);
  return { accepted: true, duplicate: false };
}

export async function readRollups(storeDir: string): Promise<{ teamDaily: TeamDailySummary[]; orgDaily: OrgDailySummary[] }> {
  const store = await readServerStore(storeDir);
  return {
    teamDaily: buildTeamDaily(store.batches),
    orgDaily: buildOrgDaily(store.batches)
  };
}

async function routeRequest(storeDir: string, mode: "local" | "team" | "org", req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  if (method === "POST" && url.pathname === "/usage/daily-batch") {
    const raw = await readBody(req);
    const payload = JSON.parse(raw) as UploadBatch;
    const result = await ingestUploadBatch(storeDir, payload);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
    return;
  }
  if (method === "GET" && url.pathname === "/api/rollups") {
    const payload = await readRollups(storeDir);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload, null, 2));
    return;
  }
  if (method === "GET" && url.pathname === "/") {
    const payload = await readRollups(storeDir);
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(renderTeamDashboardHtml(mode, payload));
    return;
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Not found" }));
}

function buildTeamDaily(batches: UploadBatch[]): TeamDailySummary[] {
  const map = new Map<string, TeamDailySummary>();
  for (const batch of batches) {
    for (const summary of batch.summaries) {
      const teamId = summary.identity.teamId ?? "unassigned-team";
      const teamName = summary.identity.teamName ?? "Unassigned Team";
      const key = `${summary.date}\0${teamId}`;
      const existing = map.get(key) ?? {
        date: summary.date,
        teamId,
        teamName,
        users: [],
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0
      };
      if (!existing.users.some((item) => item.userId === summary.identity.userId)) {
        existing.users.push({
          userId: summary.identity.userId,
          displayName: summary.identity.displayName,
          totalTokens: summary.totalTokens,
          totalCost: summary.totalCost,
          messageCount: summary.messageCount
        });
        existing.totalTokens += summary.totalTokens;
        existing.totalCost += summary.totalCost;
        existing.messageCount += summary.messageCount;
      }
      map.set(key, existing);
    }
  }
  return [...map.values()].sort((a, b) => `${a.date}\0${a.teamId}`.localeCompare(`${b.date}\0${b.teamId}`));
}

function buildOrgDaily(batches: UploadBatch[]): OrgDailySummary[] {
  const teamDaily = buildTeamDaily(batches);
  const map = new Map<string, OrgDailySummary>();
  for (const batch of batches) {
    const orgId = batch.identity.orgId ?? "local-org";
    const orgName = batch.identity.orgName ?? "Local Org";
    for (const team of teamDaily.filter((item) => item.date && item.users.some((user) => user.userId === batch.identity.userId))) {
      const key = `${team.date}\0${orgId}`;
      const existing = map.get(key) ?? {
        date: team.date,
        orgId,
        orgName,
        teams: [],
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0
      };
      if (!existing.teams.some((item) => item.teamId === team.teamId)) {
        existing.teams.push({
          teamId: team.teamId,
          teamName: team.teamName,
          totalTokens: team.totalTokens,
          totalCost: team.totalCost,
          messageCount: team.messageCount
        });
        existing.totalTokens += team.totalTokens;
        existing.totalCost += team.totalCost;
        existing.messageCount += team.messageCount;
      }
      map.set(key, existing);
    }
  }
  return [...map.values()].sort((a, b) => `${a.date}\0${a.orgId}`.localeCompare(`${b.date}\0${b.orgId}`));
}

async function readServerStore(storeDir: string): Promise<ServerStore> {
  const path = serverStorePath(storeDir);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ServerStore;
    return { schemaVersion: 1, batches: parsed.batches ?? [] };
  } catch {
    return { schemaVersion: 1, batches: [] };
  }
}

async function writeServerStore(storeDir: string, store: ServerStore): Promise<void> {
  const path = serverStorePath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function serverStorePath(storeDir: string): string {
  return join(storeDir, "server-store.json");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
