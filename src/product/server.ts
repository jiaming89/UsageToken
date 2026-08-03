import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderDashboardHtml, renderTeamDashboardHtml } from "./dashboard.js";
import type { LocalWarehouse, OrgDailySummary, TeamDailySummary, UploadBatch } from "../types.js";

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

export async function startLocalDashboardServer(options: {
  host: string;
  defaultSince?: string;
  getWarehouse: () => LocalWarehouse;
  getStatus: () => { refreshing: boolean; lastError?: string };
  refresh?: () => Promise<void>;
}): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const warehouse = options.getWarehouse();
    const status = options.getStatus();
    if (req.method === "POST" && url.pathname === "/api/dashboard/refresh") {
      void options.refresh?.();
      res.statusCode = 202;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ accepted: true, refreshing: true }));
      return;
    }
    if (url.pathname === "/api/dashboard") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ generatedAt: warehouse.generatedAt, status, daily: warehouse.dailyUserSummaries, sessions: warehouse.sessionSummaries }));
      return;
    }
    if (url.pathname === "/api/dashboard/status") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ generatedAt: warehouse.generatedAt, ...status }));
      return;
    }
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(renderLocalDashboard(warehouse, status, options.defaultSince));
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, options.host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine dashboard server address");
  return { server, url: `http://${options.host}:${address.port}` };
}

function renderLocalDashboard(warehouse: LocalWarehouse, status: { refreshing: boolean; lastError?: string }, defaultSince?: string): string {
  if (warehouse.dailyUserSummaries.length === 0) {
    return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>usagetoken</title><style>body{font-family:-apple-system,sans-serif;background:#f7f8fa;color:#1a1a2e;margin:0}.card{max-width:620px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e8eaed;border-radius:12px}p{color:#6b7280}</style></head><body><main class="card"><h1>Preparing usage dashboard…</h1><p>${status.lastError ? escapeHtml(status.lastError) : "Scanning local agent logs. This page will update when the first cache is ready."}</p></main><script>setTimeout(() => location.reload(), 3000)</script></body></html>`;
  }
  const suffix = `<script>
    const dashboardVersion = ${JSON.stringify(warehouse.generatedAt)};
    const dashboardDefaults = { since: ${JSON.stringify(defaultSince ?? lastThirtyDays())} };
    const savedRange = JSON.parse(localStorage.getItem('usagetoken-range') || 'null');
    const from = document.getElementById('date-from'), to = document.getElementById('date-to');
    if (savedRange) { from.value = savedRange.from || ''; to.value = savedRange.to || ''; }
    else { from.value = dashboardDefaults.since; }
    from.addEventListener('change', () => localStorage.setItem('usagetoken-range', JSON.stringify({from:from.value,to:to.value})));
    to.addEventListener('change', () => localStorage.setItem('usagetoken-range', JSON.stringify({from:from.value,to:to.value})));
    renderAll();
    const badge = document.getElementById('user-badge');
    badge.title = ${JSON.stringify(status.lastError ?? '')};
    badge.textContent = ${JSON.stringify(status.refreshing ? 'Refreshing cache…' : 'Local dashboard')};
    setInterval(async () => {
      try { const next = await (await fetch('/api/dashboard/status')).json(); if (next.generatedAt !== dashboardVersion) location.reload(); } catch {};
    }, 15000);
  </script></body>`;
  return renderDashboardHtml(warehouse).replace("</body>", suffix);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function lastThirtyDays(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
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
