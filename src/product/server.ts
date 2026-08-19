import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderDashboardHtml, renderTeamDashboardHtml } from "./dashboard.js";
import type { BudgetSettings, BudgetStatus, DailyUserSummary, LocalWarehouse, OrgDailySummary, SourceScanStatus, TeamDailySummary, UploadBatch } from "../types.js";
import { PACKAGE_VERSION } from "../version.js";

interface ServerStore {
  schemaVersion: 1;
  batches: UploadBatch[];
}

interface LocalDashboardStatus {
  refreshing: boolean;
  lastError?: string;
  latestVersion?: string;
  currentSource?: string;
  lastSuccessAt?: string;
  sources?: SourceScanStatus[];
  budget?: BudgetStatus;
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
  getStatus: () => LocalDashboardStatus;
  refresh?: () => Promise<void>;
  getBudget?: () => BudgetSettings | undefined;
  saveBudget?: (budget: BudgetSettings | undefined) => Promise<void>;
  report?: (input: { userId: string; endpoint: string; apiKey?: string }) => Promise<{ accepted: boolean; duplicate: boolean }>;
}): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
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
    if (req.method === "POST" && url.pathname === "/api/dashboard/report") {
      const body = JSON.parse(await readBody(req)) as { userId?: unknown; endpoint?: unknown; apiKey?: unknown };
      if (typeof body.userId !== "string" || !body.userId.trim() || typeof body.endpoint !== "string" || !body.endpoint.trim()) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "请填写用户 ID 和上报地址。" }));
        return;
      }
      if (!options.report) throw new Error("当前仪表盘未配置数据上报。");
      const result = await options.report({ userId: body.userId.trim(), endpoint: body.endpoint.trim(), ...(typeof body.apiKey === "string" && body.apiKey ? { apiKey: body.apiKey } : {}) });
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === "/api/dashboard/budget" && req.method === "GET") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ budget: options.getBudget?.(), status: status.budget }));
      return;
    }
    if (url.pathname === "/api/dashboard/budget" && req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as { budget?: unknown };
      const budget = parseBudget(body.budget);
      await options.saveBudget?.(budget);
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ budget }));
      return;
    }
    if (url.pathname === "/api/dashboard/export" && req.method === "GET") {
      const rows = filterDaily(warehouse.dailyUserSummaries, url);
      const requestedFormat = url.searchParams.get("format");
      const format = requestedFormat === "json" || requestedFormat === "html" ? requestedFormat : "csv";
      const redaction = url.searchParams.get("project") ?? "hide";
      res.setHeader("content-type", format === "json" ? "application/json; charset=utf-8" : format === "html" ? "text/html; charset=utf-8" : "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="usagetoken-${format}"`);
      res.end(format === "json" ? JSON.stringify(rows.map((row) => redactDaily(row, redaction)), null, 2) : format === "html" ? exportHtml(rows, redaction) : exportCsv(rows, redaction));
      return;
    }
    if (url.pathname === "/api/dashboard") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ generatedAt: warehouse.generatedAt, currentVersion: PACKAGE_VERSION, latestVersion: status.latestVersion, updateAvailable: Boolean(status.latestVersion), scanSummary: scanSummary(status.sources ?? []), sources: status.sources ?? [], budget: status.budget, status, daily: warehouse.dailyUserSummaries, sessions: warehouse.sessionSummaries }));
      return;
    }
    if (url.pathname === "/api/dashboard/status") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ generatedAt: warehouse.generatedAt, currentVersion: PACKAGE_VERSION, latestVersion: status.latestVersion, updateAvailable: Boolean(status.latestVersion), scanSummary: scanSummary(status.sources ?? []), ...status }));
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

function renderLocalDashboard(warehouse: LocalWarehouse, status: LocalDashboardStatus, defaultSince?: string): string {
  const health = renderSourceHealth(status);
  const comparison = renderMonthlyComparison(status.budget);
  if (warehouse.dailyUserSummaries.length === 0) {
    const progress = status.currentSource ? `正在扫描 ${escapeHtml(status.currentSource)}…` : "正在扫描本地日志…";
    return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>usagetoken</title><style>body{font-family:-apple-system,sans-serif;background:#f7f8fa;color:#1a1a2e;margin:0}.card{max-width:920px;margin:8vh auto 20px;padding:32px;background:#fff;border:1px solid #e8eaed;border-radius:12px}p{color:#6b7280}.card .source-health{margin:20px 0 0}</style></head><body><main class="card"><h1>正在准备 AI 用量仪表盘</h1><p>${status.lastError ? escapeHtml(status.lastError) : progress}</p>${health}</main><script>setTimeout(() => location.reload(), 3000)</script></body></html>`;
  }
  const updateBanner = status.latestVersion ? `<div id="update-banner" style="margin:12px auto -4px;max-width:1240px;padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;color:#1e3a8a;font:14px -apple-system,sans-serif">发现新版本 usagetoken@${escapeHtml(status.latestVersion)}，运行 <code>npm install -g usagetoken@${escapeHtml(status.latestVersion)}</code> 升级。<button id="dismiss-update" type="button" style="float:right;border:0;background:transparent;color:#1d4ed8;cursor:pointer">关闭</button></div>` : "";
  const budgetDialog = `<dialog id="budget-dialog" style="width:min(420px,calc(100% - 32px));border:0;border-radius:12px;padding:20px;box-shadow:0 20px 50px rgba(15,23,42,.2)"><form id="budget-form" style="font:14px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"><h2 style="margin:0 0 14px">预算设置</h2><label>月度费用上限（USD）<input id="budget-cost" type="number" min="0" step="0.01" style="display:block;width:100%;margin:6px 0 10px;padding:8px" /></label><label>月度 Token 上限<input id="budget-token" type="number" min="0" step="1" style="display:block;width:100%;margin:6px 0 10px;padding:8px" /></label><label>预警阈值（%）<input id="budget-warning" type="number" min="1" max="100" value="80" style="display:block;width:100%;margin:6px 0 14px;padding:8px" /></label><button type="submit" style="padding:9px 14px;border:0;border-radius:7px;background:#3b82f6;color:#fff">保存</button><button type="button" id="budget-close" style="margin-left:8px;padding:9px 14px;border:0;border-radius:7px">取消</button></form></dialog>`;
  const suffix = `${budgetDialog}<dialog id="report-dialog" style="width:min(420px,calc(100% - 32px));border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(15,23,42,.2)"><form id="report-form" style="padding:20px;font:14px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#1a1a2e"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><strong style="font-size:17px">数据上报</strong><button type="button" id="report-close" style="border:0;background:none;font-size:20px;cursor:pointer">×</button></div><p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.5">仅上报每日 Token 汇总，不上传原始对话内容。未填写地址不会提交数据。</p><label style="display:block;margin-bottom:12px">用户 ID<input id="report-user-id" required style="display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #d1d5db;border-radius:7px" /></label><label style="display:block;margin-bottom:14px">上报地址<input id="report-endpoint" type="url" placeholder="https://example.com/usage/daily-batch" style="display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #d1d5db;border-radius:7px" /></label><p id="report-status" style="min-height:20px;margin:0 0 12px;color:#6b7280;font-size:12px"></p><button type="submit" style="width:100%;padding:10px;border:0;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer">确认上报</button></form></dialog><script>
    const dashboardVersion = ${JSON.stringify(warehouse.generatedAt)};
    const updateVersion = ${JSON.stringify(status.latestVersion ?? "")};
    const dashboardDefaults = { since: ${JSON.stringify(defaultSince ?? lastThirtyDays())} };
    const savedRange = JSON.parse(localStorage.getItem('usagetoken-range') || 'null');
    const from = document.getElementById('date-from'), to = document.getElementById('date-to');
    if (savedRange) { from.value = savedRange.from || ''; to.value = savedRange.to || ''; }
    else { from.value = dashboardDefaults.since; }
    from.addEventListener('change', () => localStorage.setItem('usagetoken-range', JSON.stringify({from:from.value,to:to.value})));
    to.addEventListener('change', () => localStorage.setItem('usagetoken-range', JSON.stringify({from:from.value,to:to.value})));
    renderAll();
    window.exportDashboard = function(format) { const p = new URLSearchParams({format:format, project:'hide'}); if (from.value) p.set('since', from.value); if (to.value) p.set('until', to.value); const source = document.getElementById('source-filter').value; if (source) p.set('source', source); location.href = '/api/dashboard/export?' + p.toString(); };
    const badge = document.getElementById('user-badge');
    badge.title = '上报每日汇总数据';
    badge.textContent = '数据上报';
    badge.style.border = '0'; badge.style.cursor = 'pointer';
    const reportDialog = document.getElementById('report-dialog');
    const reportUserId = document.getElementById('report-user-id'), reportEndpoint = document.getElementById('report-endpoint'), reportStatus = document.getElementById('report-status');
    reportUserId.value = localStorage.getItem('usagetoken-report-user-id') || '';
    reportEndpoint.value = localStorage.getItem('usagetoken-report-endpoint') || '';
    badge.addEventListener('click', () => reportDialog.showModal());
    document.getElementById('report-close').addEventListener('click', () => reportDialog.close());
    document.getElementById('report-form').addEventListener('submit', async (event) => { event.preventDefault(); const userId = reportUserId.value.trim(), endpoint = reportEndpoint.value.trim(); if (!endpoint) { reportStatus.textContent = '未填写上报地址，未提交任何数据。'; return; } localStorage.setItem('usagetoken-report-user-id', userId); localStorage.setItem('usagetoken-report-endpoint', endpoint); reportStatus.textContent = '正在上报…'; try { const response = await fetch('/api/dashboard/report', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({userId, endpoint}) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '上报失败'); reportStatus.textContent = result.duplicate ? '数据已上报，无需重复提交。' : '上报成功。'; } catch (error) { reportStatus.textContent = error.message || '上报失败。'; } });
    reportEndpoint.insertAdjacentHTML('afterend', '<label style="display:block;margin:12px 0">API Key（可选）<input id="report-api-key" type="password" style="display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #d1d5db;border-radius:7px" /></label>');
    const reportApiKey = document.getElementById('report-api-key'); reportApiKey.value = localStorage.getItem('usagetoken-report-api-key') || '';
    document.getElementById('report-form').addEventListener('submit', async (event) => { event.preventDefault(); event.stopImmediatePropagation(); const userId = reportUserId.value.trim(), endpoint = reportEndpoint.value.trim(), apiKey = reportApiKey.value.trim(); if (!endpoint) { reportStatus.textContent = '未填写上报地址，未提交任何数据。'; return; } localStorage.setItem('usagetoken-report-user-id', userId); localStorage.setItem('usagetoken-report-endpoint', endpoint); localStorage.setItem('usagetoken-report-api-key', apiKey); reportStatus.textContent = '正在上报…'; try { const response = await fetch('/api/dashboard/report', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({userId, endpoint, apiKey}) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '上报失败'); reportStatus.textContent = result.duplicate ? '数据已上报，无需重复提交。' : '上报成功。'; } catch (error) { reportStatus.textContent = error.message || '上报失败。'; } }, true);
    const budgetDialog = document.getElementById('budget-dialog'); const budgetForm = document.getElementById('budget-form');
    document.getElementById('budget-settings').addEventListener('click', () => budgetDialog.showModal()); document.getElementById('budget-close').addEventListener('click', () => budgetDialog.close());
    budgetForm.addEventListener('submit', async (event) => { event.preventDefault(); const budget = { monthlyCostLimit: Number(document.getElementById('budget-cost').value) || undefined, monthlyTokenLimit: Number(document.getElementById('budget-token').value) || undefined, warningPercent: Number(document.getElementById('budget-warning').value) || 80, dailyCostSpikeMultiplier: 2, dailyCostSpikeMinimum: 10 }; const response = await fetch('/api/dashboard/budget', {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({budget})}); if(response.ok) location.reload(); });
    const updateBanner = document.getElementById('update-banner');
    if (updateBanner && localStorage.getItem('usagetoken-dismissed-update') === updateVersion) updateBanner.remove();
    document.getElementById('dismiss-update')?.addEventListener('click', () => { localStorage.setItem('usagetoken-dismissed-update', updateVersion); updateBanner?.remove(); });
    setInterval(async () => {
      try { const next = await (await fetch('/api/dashboard/status')).json(); if (next.generatedAt !== dashboardVersion || (next.latestVersion || '') !== updateVersion) location.reload(); } catch {};
    }, 15000);
  </script></body>`;
  return renderDashboardHtml(warehouse)
    .replace("</header>", `</header>${updateBanner}`)
    .replace("<button class=\"tab\" data-view=\"blocks\" onclick=\"switchView('blocks')\">5 小时窗口</button>", "<button class=\"tab\" data-view=\"blocks\" onclick=\"switchView('blocks')\">5 小时窗口</button><button class=\"tab\" data-view=\"source\" onclick=\"switchView('source')\">数据源</button><button class=\"tab\" data-view=\"comparison\" onclick=\"switchView('comparison')\">月度对比</button>")
    .replace("    <div class=\"date-filter\">", `    <section id="source-health-view" style="display:none">${health}</section>\n    <section id="monthly-comparison-view" style="display:none">${comparison}</section>\n    <div id="dashboard-content">\n    <div class="date-filter">`)
    .replace("    <footer class=\"footer\" id=\"footer\"></footer>", "    </div>\n    <footer class=\"footer\" id=\"footer\"></footer>")
    .replace("</body>", suffix);
}

function renderSourceHealth(status: LocalDashboardStatus): string {
  const sources = status.sources ?? [];
  const summary = scanSummary(sources);
  const abnormal = sources.filter((source) => source.state === "failed" || source.state === "no_usage");
  const sourceRows = sources.map((source) => `<tr><td>${escapeHtml(source.name)}</td><td>${sourceStateLabel(source.state)}</td><td>${source.fileCount}</td><td>${source.recordCount}${source.cacheHit ? "（缓存）" : ""}</td><td>${escapeHtml(source.latestRecordAt ?? "—")}</td><td>${escapeHtml(source.scannedAt)}</td><td title="${escapeHtml((source.paths ?? []).join("\n"))}">${escapeHtml((source.paths ?? []).join("、") || "—")}</td></tr>`).join("");
  const warnings = abnormal.length === 0 ? "" : `<div class="source-health-warnings">${abnormal.map((source) => `<span><strong>${escapeHtml(source.name)}</strong>：${escapeHtml(source.error ?? sourceHint(source))}</span>`).join("")}</div>`;
  const detail = sources.length === 0
    ? "<p class=\"source-health-empty\">等待首次扫描…</p>"
    : `<details class="source-health-details"><summary>查看数据源详情（${sources.length}）</summary><div class="source-health-table"><table><thead><tr><th>来源</th><th>状态</th><th>文件</th><th>记录</th><th>最新数据</th><th>上次扫描</th><th>扫描路径</th></tr></thead><tbody>${sourceRows}</tbody></table><p>无日志：${summary.noLogs} 个；未扫描：${sources.filter((source) => source.state === "skipped").length} 个。</p></div></details>`;
  const progress = status.refreshing ? `正在刷新${status.currentSource ? `：${escapeHtml(status.currentSource)}` : ""}` : "最近刷新完成";
  return `<section class="source-health"><style>.source-health{margin:-4px 0 18px;padding:12px 16px;background:#fff;border:1px solid #e8eaed;border-radius:12px;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a2e}.source-health-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.source-health-title{font-weight:600}.source-health-state{color:#6b7280;margin-right:auto}.source-health-count{padding:3px 8px;border-radius:999px;background:#f3f4f6;color:#4b5563;white-space:nowrap}.source-health-warnings{display:grid;gap:5px;margin-top:10px;padding:9px 11px;background:#fff7ed;border-radius:8px;color:#9a3412;font-size:12px}.source-health-details{margin-top:10px;color:#4b5563}.source-health-details summary{cursor:pointer;color:#2563eb;width:max-content}.source-health-table{overflow:auto;margin-top:10px}.source-health-table table{width:100%;border-collapse:collapse;font-size:12px}.source-health-table th,.source-health-table td{text-align:left;padding:7px 8px;border-top:1px solid #e8eaed;white-space:nowrap}.source-health-table th{color:#6b7280;font-weight:500}.source-health-table p,.source-health-empty{margin:8px 0 0;color:#6b7280;font-size:12px}@media(max-width:768px){.source-health{margin-bottom:14px}.source-health-state{width:100%;order:3}.source-health-count{font-size:12px}}</style><div class="source-health-top"><strong class="source-health-title">数据源</strong><span class="source-health-state">${progress}</span><span class="source-health-count">${summary.normal} 正常</span><span class="source-health-count">${summary.noLogs} 未检测</span>${summary.failed + summary.noUsage > 0 ? `<span class="source-health-count">${summary.failed + summary.noUsage} 异常</span>` : ""}</div>${warnings}${detail}</section>`;
}

function renderMonthlyComparison(status: BudgetStatus | undefined): string {
  if (!status) return `<section class="monthly-comparison"><style>.monthly-comparison{margin:-4px 0 18px;padding:20px;background:#fff;border:1px solid #e8eaed;border-radius:12px;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a2e}</style><strong>月度对比</strong><p style="margin:10px 0 0;color:#6b7280">等待首次扫描完成…</p></section>`;
  if (status.previousCost === 0 && status.previousTokens === 0) return `<section class="monthly-comparison"><style>.monthly-comparison{margin:-4px 0 18px;padding:20px;background:#fff;border:1px solid #e8eaed;border-radius:12px;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a2e}</style><strong>月度对比</strong>${renderBudgetOverview(status)}<p style="margin:10px 0 0;color:#6b7280">暂无上月数据，完成一个自然月后可查看环比。</p></section>`;
  return `<section class="monthly-comparison"><style>.monthly-comparison{margin:-4px 0 18px;padding:20px;background:#fff;border:1px solid #e8eaed;border-radius:12px;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a2e}.monthly-comparison header{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}.monthly-comparison header span{color:#6b7280;font-size:13px}.comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.comparison-card{padding:16px;border:1px solid #e8eaed;border-radius:10px}.comparison-card h3{margin:0 0 14px;font-size:15px}.comparison-row{display:grid;grid-template-columns:42px 1fr auto;gap:9px;align-items:center;margin-top:10px;font-size:12px;color:#6b7280}.comparison-bar{height:10px;overflow:hidden;background:#f1f5f9;border-radius:99px}.comparison-bar i{display:block;height:100%;min-width:2px;border-radius:99px}.comparison-bar .current{background:#3b82f6}.comparison-bar .previous{background:#94a3b8}.comparison-row strong{min-width:74px;text-align:right;color:#1a1a2e;font-variant-numeric:tabular-nums}.comparison-summary{margin-top:14px;padding-top:12px;border-top:1px solid #eef2f7;color:#4b5563;font-size:13px}.comparison-summary b{font-size:16px;margin-right:5px}.comparison-summary.up b{color:#dc2626}.comparison-summary.down b{color:#059669}.comparison-legend{display:flex;gap:14px;margin-top:16px;color:#6b7280;font-size:12px}.comparison-legend i{display:inline-block;width:9px;height:9px;margin-right:4px;border-radius:50%;background:#3b82f6}.comparison-legend i.previous{background:#94a3b8}@media(max-width:680px){.comparison-grid{grid-template-columns:1fr}.monthly-comparison header{display:block}.monthly-comparison header span{display:block;margin-top:5px}}</style><header><strong>月度对比</strong><span>${status.month} 与 ${status.previousMonth}</span></header>${renderBudgetOverview(status)}<div class="comparison-grid">${renderComparisonCard("Token", status.tokens, status.previousTokens, 0, "")}${renderComparisonCard("费用", status.cost, status.previousCost, 2, "$")}</div><div class="comparison-legend"><span><i></i>本月</span><span><i class="previous"></i>上月</span></div></section>`;
}

function renderBudgetOverview(status: BudgetStatus): string {
  const item = (label: string, value: string, limit: number | undefined, used: number, prefix = "") => `<span style="display:inline-block;margin:0 20px 12px 0"><small style="display:block;color:#6b7280">${label}</small><b style="display:block;margin:3px 0">${value}</b><small style="color:#6b7280">${limit ? `上限 ${prefix}${limit.toLocaleString()} · ${(used / limit * 100).toFixed(1)}%` : "未设置上限"}</small></span>`;
  const actions = `<span style="float:right;display:flex;gap:6px"><button type="button" onclick="exportDashboard('csv')" style="border:0;background:#fff;padding:5px 9px;border-radius:6px;cursor:pointer">CSV</button><button type="button" onclick="exportDashboard('json')" style="border:0;background:#fff;padding:5px 9px;border-radius:6px;cursor:pointer">JSON</button><button type="button" onclick="exportDashboard('html')" style="border:0;background:#fff;padding:5px 9px;border-radius:6px;cursor:pointer">HTML</button><button id="budget-settings" type="button" style="border:0;background:#eff6ff;color:#2563eb;padding:5px 9px;border-radius:6px;cursor:pointer">设置预算</button></span>`;
  return `<div style="margin:0 0 20px;padding:14px 16px;background:#f8fafc;border-radius:10px"><strong style="display:block;margin-bottom:10px">本月预算</strong>${actions}${item("费用", `$${status.cost.toFixed(2)}`, status.monthlyCostLimit, status.cost, "$")}${item("Token", status.tokens.toLocaleString(), status.monthlyTokenLimit, status.tokens)}${item("月末预计费用", `$${status.projectedCost.toFixed(2)}`, undefined, 0)}</div>`;
}

function renderComparisonCard(label: string, current: number, previous: number, digits: number, prefix: string): string {
  const delta = current - previous;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  const icon = delta > 0 ? "↑" : delta < 0 ? "↓" : "•";
  const maximum = Math.max(current, previous, 1);
  const display = (value: number) => digits === 0 ? `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 1 : 2)}M` : `${prefix}${value.toFixed(digits)}`;
  const change = previous === 0 ? "暂无上月数据" : `${Math.abs(delta / previous * 100).toFixed(1)}%，${delta > 0 ? "增加" : delta < 0 ? "减少" : "持平"} ${display(Math.abs(delta))}`;
  return `<article class="comparison-card"><h3>${label}</h3><div class="comparison-row"><span>本月</span><span class="comparison-bar"><i class="current" style="width:${current / maximum * 100}%"></i></span><strong>${display(current)}</strong></div><div class="comparison-row"><span>上月</span><span class="comparison-bar"><i class="previous" style="width:${previous / maximum * 100}%"></i></span><strong>${display(previous)}</strong></div><div class="comparison-summary ${direction}"><b>${icon}</b>环比 ${change}</div></article>`;
}

function sourceStateLabel(state: SourceScanStatus["state"]): string {
  return ({ normal: "正常", no_logs: "无日志", no_usage: "无可解析用量", failed: "扫描失败", skipped: "未扫描" } as const)[state];
}

function sourceHint(source: SourceScanStatus): string {
  if (source.state === "no_logs") return "未发现本地日志；请确认工具已使用或配置日志目录环境变量。";
  if (source.state === "no_usage") return "已发现日志，但当前版本无法识别其中 Token 字段。";
  if (source.state === "skipped") return "本次使用 --source 筛选，未扫描该来源。";
  return "";
}

function scanSummary(sources: SourceScanStatus[]): Record<string, number> {
  return {
    normal: sources.filter((source) => source.state === "normal").length,
    noLogs: sources.filter((source) => source.state === "no_logs").length,
    noUsage: sources.filter((source) => source.state === "no_usage").length,
    failed: sources.filter((source) => source.state === "failed").length
  };
}

function parseBudget(value: unknown): BudgetSettings | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") throw new Error("预算配置格式错误。");
  const input = value as Record<string, unknown>;
  const number = (name: string, fallback?: number): number | undefined => {
    const item = input[name];
    if (item == null || item === "") return fallback;
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) throw new Error(`预算字段 ${name} 无效。`);
    return item;
  };
  const warningPercent = number("warningPercent", 80)!;
  if (warningPercent <= 0 || warningPercent > 100) throw new Error("预警阈值必须在 1 到 100 之间。");
  const dailyCostSpikeMultiplier = number("dailyCostSpikeMultiplier", 2)!;
  if (dailyCostSpikeMultiplier < 1) throw new Error("日异常倍数不能小于 1。");
  return {
    monthlyCostLimit: number("monthlyCostLimit"),
    monthlyTokenLimit: number("monthlyTokenLimit"),
    warningPercent,
    dailyCostSpikeMultiplier,
    dailyCostSpikeMinimum: number("dailyCostSpikeMinimum", 10)!
  };
}

function filterDaily(rows: DailyUserSummary[], url: URL): DailyUserSummary[] {
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  const source = url.searchParams.get("source") ?? "";
  return rows.filter((row) => (!since || row.date >= since) && (!until || row.date <= until) && (!source || row.sourceBreakdown.some((item) => item.source === source)));
}

function redactDaily(row: DailyUserSummary, project: string): DailyUserSummary {
  const projectBreakdown = row.projectBreakdown.map((item) => ({ ...item, projectPath: project === "full" ? item.projectPath : project === "name" ? item.projectPath.split(/[\\/]/u).filter(Boolean).pop() ?? "项目" : "已隐藏" }));
  return { ...row, projectBreakdown };
}

function exportCsv(rows: DailyUserSummary[], project: string): string {
  const fields = ["日期", "来源", "模型", "项目", "Token", "费用(USD)"];
  const lines = [fields.join(",")];
  for (const row of rows.map((item) => redactDaily(item, project))) {
    const source = row.sourceBreakdown.map((item) => item.source).join("|");
    const model = row.modelBreakdown.map((item) => item.model).join("|");
    const projects = row.projectBreakdown.map((item) => item.projectPath).join("|");
    lines.push([row.date, source, model, projects, row.totalTokens, row.totalCost].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function exportHtml(rows: DailyUserSummary[], project: string): string {
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${row.totalTokens.toLocaleString()}</td><td>$${row.totalCost.toFixed(2)}</td><td>${escapeHtml(redactDaily(row, project).projectBreakdown.map((item) => item.projectPath).join("、") || "—")}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>usagetoken 用量报告</title><style>body{font:14px -apple-system,'PingFang SC';max-width:900px;margin:40px auto;color:#1a1a2e}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left}</style><h1>AI 用量报告</h1><p>已脱敏：项目路径已隐藏；不包含会话 ID、原始日志或对话内容。</p><table><thead><tr><th>日期</th><th>Token</th><th>费用</th><th>项目</th></tr></thead><tbody>${body}</tbody></table></html>`;
}

function csvCell(value: unknown): string { return `"${String(value).replace(/"/g, '""')}"`; }

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
    const apiKeys = (process.env.USAGETOKEN_API_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
    if (apiKeys.length > 0 && !apiKeys.includes((req.headers.authorization ?? "").replace(/^Bearer\s+/iu, ""))) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
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
