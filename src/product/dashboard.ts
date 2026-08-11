import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeBlocks } from "../core/blocks.js";
import type { DailyUserSummary, LocalWarehouse, OrgDailySummary, SessionSummaryRecord, TeamDailySummary } from "../types.js";
import { createDailyUserSummaries } from "./warehouse.js";

export function renderDashboardHtml(warehouse: LocalWarehouse): string {
  const daily = warehouse.dailyUserSummaries;
  const sessions = warehouse.sessionSummaries;
  const records = warehouse.usageRecords;
  const friendlyDate = formatFriendlyDate(warehouse.generatedAt);
  const sourceCount = new Set(records.map((r) => r.source)).size;

  if (daily.length === 0) {
    return renderEmptyDashboard(friendlyDate);
  }

  const blocks = summarizeBlocks(records, { mode: "auto" });
  const bySource = Object.fromEntries([...new Set(records.map((record) => record.source))].map((source) => [source, createDailyUserSummaries(records.filter((record) => record.source === source), warehouse.config, undefined, "auto")]));

  const dashboardDaily = (rows: DailyUserSummary[]) => rows.map((d) => ({
    date: d.date,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cacheCreationTokens: d.cacheCreationTokens,
    cacheReadTokens: d.cacheReadTokens,
    totalTokens: d.totalTokens,
    totalCost: d.totalCost,
    messageCount: d.messageCount,
    models: d.modelBreakdown.map((m) => ({ model: m.model, totalTokens: m.totalTokens, totalCost: m.totalCost })),
    projects: d.projectBreakdown.map((p) => ({ projectPath: p.projectPath, totalTokens: p.totalTokens, totalCost: p.totalCost }))
  }));
  const dailyJson = safeJson(dashboardDaily(daily));
  const sourceDailyJson = safeJson(Object.fromEntries(Object.entries(bySource).map(([source, rows]) => [source, dashboardDaily(rows)])));

  const sessionJson = safeJson(sessions.map((s) => ({
    sessionId: s.sessionId,
    source: s.source,
    firstActivity: s.firstActivity ?? "",
    lastActivity: s.lastActivity ?? "",
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheCreationTokens: s.cacheCreationTokens,
    cacheReadTokens: s.cacheReadTokens,
    extraTotalTokens: s.extraTotalTokens,
    totalCost: s.totalCost,
    messageCount: s.messageCount
  })));

  const blocksJson = safeJson(blocks.map((b) => ({
    startTime: b.startTime,
    endTime: b.endTime,
    entries: b.entries,
    totalTokens: b.totalTokens,
    costUSD: b.costUSD,
    models: b.models,
    isActive: b.isActive,
    isGap: b.isGap
  })));

  const metaJson = safeJson({
    friendlyDate,
    displayName: warehouse.config.identity.displayName,
    sourceCount,
    recordCount: records.length,
    sessionCount: sessions.length
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 用量仪表盘</title>
  <style>
    :root {
      --bg: #f7f8fa; --card: #ffffff; --border: #e8eaed; --text: #1a1a2e; --muted: #6b7280;
      --blue: #3b82f6; --blue-light: #dbeafe; --green: #10b981; --green-light: #d1fae5;
      --amber: #f59e0b; --amber-light: #fef3c7; --red: #ef4444; --red-light: #fee2e2;
      --purple: #8b5cf6; --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .container { max-width: 1280px; margin: 0 auto; padding: 28px 24px 56px; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    .header h1 { font-size: 24px; font-weight: 650; letter-spacing: -0.025em; }
    .header-sub { font-size: 13px; color: var(--muted); margin-top: 4px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: var(--blue-light); color: #1e40af; font-size: 12px; font-weight: 500; }
    .tab-bar { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
    .tab-bar::-webkit-scrollbar { display: none; }
    .tab { flex: 0 0 auto; padding: 9px 16px; border: none; background: none; font-size: 13px; font-weight: 550; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; border-radius: 7px 7px 0 0; }
    .tab:hover { color: var(--text); background: #f0f4f8; }
    .tab.active { color: var(--blue); border-bottom-color: var(--blue); }
    .date-filter { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; position:sticky; top:0; z-index:5; background:var(--bg); padding:10px 0 12px; }
    .filter-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .filter-range { padding: 5px 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
    .date-filter input[type="date"], .date-filter select { height: 32px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; font-size: 13px; color: var(--text); background: var(--card); }
    .date-filter label { font-size: 12px; color: var(--muted); }
    .date-btn { height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; color: var(--muted); background: var(--card); cursor: pointer; white-space: nowrap; }
    .date-btn.primary { color: #fff; background: var(--blue); border-color: var(--blue); }
    .date-btn:hover { color: var(--blue); border-color: var(--blue); }
    .kpi-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    .kpi-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .kpi-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; display: block; }
    .kpi-delta { display: inline-block; font-size: 11px; font-weight: 500; margin-top: 4px; }
    .kpi-delta.up { color: var(--red); }
    .kpi-delta.down { color: var(--green); }
    .kpi-delta.neutral { color: var(--muted); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.02); }
    .card h2 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
    .chart-row { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-bottom: 16px; }
    .trend-chart { width: 100%; height: auto; min-height: 190px; display: block; }
    .donut-wrap { display: flex; align-items: center; gap: 16px; }
    .legend { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .legend-label { color: var(--muted); }
    .legend-val { margin-left: auto; font-weight: 500; font-variant-numeric: tabular-nums; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th { text-align: right; padding: 6px 10px; font-weight: 500; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); }
    .data-table th:first-child { text-align: left; }
    .data-table td { text-align: right; padding: 8px 10px; border-bottom: 1px solid #f3f4f6; font-variant-numeric: tabular-nums; }
    .data-table td:first-child { text-align: left; font-weight: 500; }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: #f9fafb; }
    .cache-cell { color: var(--green); font-weight: 500; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .breakdown-item { margin-bottom: 14px; }
    .breakdown-item:last-child { margin-bottom: 0; }
    .breakdown-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
    .breakdown-label { font-size: 13px; font-weight: 500; word-break: break-all; }
    .breakdown-cost { font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; margin-left: 12px; }
    .breakdown-sub { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .progress-track { height: 6px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
    .session-id { font-family: "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 11px; }
    .insight { padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; line-height: 1.4; }
    .insight:last-child { margin-bottom: 0; }
    .insight.warning { background: var(--amber-light); color: #92400e; }
    .insight.success { background: var(--green-light); color: #065f46; }
    .insight.info { background: var(--blue-light); color: #1e40af; }
    .empty-text { color: var(--muted); font-size: 13px; }
    .footer { text-align: center; font-size: 12px; color: var(--muted); padding: 16px 0 8px; }
    .footer a { color: var(--muted); text-decoration: none; }
    .footer a:hover { color: var(--blue); text-decoration: underline; }
    .session-card { padding:0; overflow:hidden; }.session-header{padding:18px 20px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}.session-scroll{max-height:520px;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.session-scroll th{position:sticky;top:0;background:#fbfcff;z-index:2}.load-more{padding:14px;text-align:center}.load-more button{color:var(--blue);font-weight:600}.session-count{font-size:12px;color:var(--muted);font-weight:400}
    @media (max-width: 768px) {
      .container { padding: 18px 14px 40px; }
      .header h1 { font-size: 21px; }
      .date-filter { align-items: stretch; }
      .filter-group { width: 100%; }
      .filter-range { width: 100%; }
      .date-filter input[type="date"] { flex: 1 1 120px; min-width: 0; }
      .filter-group:last-child { justify-content: space-between; }
      .date-filter select { flex: 1; min-width: 0; }
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .chart-row, .two-col { grid-template-columns: 1fr; }
      .donut-wrap { flex-direction: column; }
      .trend-chart { min-height: 170px; }
      .data-table { font-size: 12px; }
      .data-table th, .data-table td { padding: 6px 6px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div>
        <h1>AI 用量仪表盘</h1>
        <div class="header-sub" id="header-sub"></div>
      </div>
      <span class="badge" id="user-badge"></span>
    </header>

    <div class="tab-bar" id="tab-bar">
      <button class="tab active" data-view="daily" onclick="switchView('daily')">每日</button><button class="tab" data-view="weekly" onclick="switchView('weekly')">每周</button><button class="tab" data-view="monthly" onclick="switchView('monthly')">每月</button><button class="tab" data-view="session" onclick="switchView('session')">会话</button><button class="tab" data-view="blocks" onclick="switchView('blocks')">5 小时窗口</button>
    </div>

    <div class="date-filter">
      <div class="filter-group"><button class="date-btn" onclick="recentThirtyDays()">最近 30 天</button><button class="date-btn" onclick="clearDates()">全部时间</button></div>
      <div class="filter-group filter-range"><label for="date-from">起始日期</label><input type="date" id="date-from" onchange="onDateChange()" /><label for="date-to">结束日期</label><input type="date" id="date-to" onchange="onDateChange()" /></div>
      <div class="filter-group"><select id="source-filter" aria-label="数据来源" onchange="onSourceChange()"><option value="">全部来源</option></select><button id="refresh-cache" class="date-btn primary" onclick="refreshCache()">刷新缓存</button></div>
    </div>

    <div class="kpi-row" id="kpi-row"></div>

    <div class="chart-row">
      <div class="card">
        <h2 id="chart-title">成本趋势</h2>
        <div id="chart"></div>
      </div>
      <div class="card">
        <h2>Token 构成</h2>
        <div id="donut"></div>
      </div>
    </div>

    <div class="card" id="breakdown-card">
      <h2 id="table-title">明细 <span class="session-count" id="table-count"></span></h2>
      <div id="table" style="overflow-x:auto"></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>模型排行</h2>
        <div id="models"></div>
      </div>
      <div class="card">
        <h2>项目排行</h2>
        <div id="projects"></div>
      </div>
    </div>

    <div class="card"><h2>智能洞察</h2><div id="insights"></div></div>
    <div class="card session-card"><div class="session-header"><h2>会话列表 <span class="session-count" id="session-count"></span></h2></div><div class="session-scroll" id="sessions"></div><div class="load-more"><button id="load-more" onclick="loadMoreSessions()">加载更多 50 条</button></div></div>

    <footer class="footer" id="footer"></footer>
  </div>

<script>
var dailyData = ${dailyJson};
var sourceDailyData = ${sourceDailyJson};
var sessionData = ${sessionJson};
var blocksData = ${blocksJson};
var meta = ${metaJson};
var currentView = 'daily';
var sessionLimit = 50;
var blockLimit = 10;
var periodLimit = 10;

document.getElementById('header-sub').textContent = meta.friendlyDate + ' \u00b7 ' + meta.sourceCount + ' 个来源 \u00b7 ' + meta.recordCount + ' 条记录 \u00b7 ' + meta.sessionCount + ' 个会话';
document.getElementById('user-badge').textContent = meta.displayName === 'Local dashboard' ? '本地仪表盘' : meta.displayName;
Object.keys(sourceDailyData).sort().forEach(function(source){var o=document.createElement('option');o.value=source;o.textContent=source;document.getElementById('source-filter').appendChild(o);});

function fmt(n) {
  n = Math.round(n);
  if (n < 1000) return String(n);
  if (n < 1000000) return trimZ((n / 1000).toFixed(1)) + 'K';
  if (n < 1000000000) return trimZ((n / 1000000).toFixed(2)) + 'M';
  return trimZ((n / 1000000000).toFixed(2)) + 'B';
}
function trimZ(s) { return s.replace(/\\.?0+$/, ''); }
function usd(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDur(start, end) {
  if (!start || !end) return '\u2014';
  var ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0 || isNaN(ms)) return '\u2014';
  var totalMin = Math.floor(ms / 60000);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h > 0) return h + '小时' + m + '分';
  if (m > 0) return m + '分';
  return '<1分';
}
function dateStr(iso) { return iso ? iso.slice(0, 10) : ''; }

function getFilteredDaily() {
  var from = document.getElementById('date-from').value;
  var to = document.getElementById('date-to').value;
  var source = document.getElementById('source-filter').value;
  var rows = source ? (sourceDailyData[source] || []) : dailyData;
  return rows.filter(function(d) {
    if (from && d.date < from) return false;
    if (to && d.date > to) return false;
    return true;
  });
}
function getFilteredSessions() {
  var from = document.getElementById('date-from').value;
  var to = document.getElementById('date-to').value;
  var source = document.getElementById('source-filter').value;
  return sessionData.filter(function(s) {
    if (source && s.source !== source) return false;
    var d = dateStr(s.firstActivity);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}
function getFilteredBlocks() {
  var from = document.getElementById('date-from').value;
  var to = document.getElementById('date-to').value;
  return blocksData.filter(function(b) {
    if (b.isGap) return false;
    var d = dateStr(b.startTime);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function computeWeekly(daily) {
  var groups = {};
  daily.forEach(function(d) {
    var date = new Date(d.date + 'T00:00:00');
    var day = date.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    var monday = new Date(date);
    monday.setDate(date.getDate() + diff);
    var key = monday.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return Object.keys(groups).sort().map(function(key) {
    return aggregateGroup(key, groups[key]);
  });
}
function computeMonthly(daily) {
  var groups = {};
  daily.forEach(function(d) {
    var key = d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return Object.keys(groups).sort().map(function(key) {
    return aggregateGroup(key, groups[key]);
  });
}
function aggregateGroup(period, items) {
  var r = { period: period, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0, messageCount: 0, models: [], projects: [] };
  var mm = {}, pm = {};
  items.forEach(function(d) {
    r.inputTokens += d.inputTokens;
    r.outputTokens += d.outputTokens;
    r.cacheCreationTokens += d.cacheCreationTokens;
    r.cacheReadTokens += d.cacheReadTokens;
    r.totalTokens += d.totalTokens;
    r.totalCost += d.totalCost;
    r.messageCount += d.messageCount;
    d.models.forEach(function(m) {
      if (!mm[m.model]) mm[m.model] = { model: m.model, totalTokens: 0, totalCost: 0 };
      mm[m.model].totalTokens += m.totalTokens;
      mm[m.model].totalCost += m.totalCost;
    });
    d.projects.forEach(function(p) {
      if (!pm[p.projectPath]) pm[p.projectPath] = { projectPath: p.projectPath, totalTokens: 0, totalCost: 0 };
      pm[p.projectPath].totalTokens += p.totalTokens;
      pm[p.projectPath].totalCost += p.totalCost;
    });
  });
  r.models = Object.keys(mm).map(function(k) { return mm[k]; }).sort(function(a, b) { return b.totalCost - a.totalCost; });
  r.projects = Object.keys(pm).map(function(k) { return pm[k]; }).sort(function(a, b) { return b.totalCost - a.totalCost; });
  return r;
}

function computeTotals(daily) {
  var t = { totalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, messageCount: 0, days: daily.length };
  daily.forEach(function(d) {
    t.totalTokens += d.totalTokens;
    t.totalCost += d.totalCost;
    t.inputTokens += d.inputTokens;
    t.outputTokens += d.outputTokens;
    t.cacheCreationTokens += d.cacheCreationTokens;
    t.cacheReadTokens += d.cacheReadTokens;
    t.messageCount += d.messageCount;
  });
  t.averageCost = t.days > 0 ? t.totalCost / t.days : 0;
  return t;
}

function aggregateModels(daily) {
  var mm = {};
  daily.forEach(function(d) {
    d.models.forEach(function(m) {
      if (!mm[m.model]) mm[m.model] = { label: m.model, totalTokens: 0, totalCost: 0 };
      mm[m.model].totalTokens += m.totalTokens;
      mm[m.model].totalCost += m.totalCost;
    });
  });
  return Object.keys(mm).map(function(k) { return mm[k]; }).sort(function(a, b) { return b.totalCost - a.totalCost; });
}
function aggregateProjects(daily) {
  var pm = {};
  daily.forEach(function(d) {
    d.projects.forEach(function(p) {
      if (!pm[p.projectPath]) pm[p.projectPath] = { label: p.projectPath, totalTokens: 0, totalCost: 0 };
      pm[p.projectPath].totalTokens += p.totalTokens;
      pm[p.projectPath].totalCost += p.totalCost;
    });
  });
  return Object.keys(pm).map(function(k) { return pm[k]; }).sort(function(a, b) { return b.totalCost - a.totalCost; });
}

function computeInsights(daily, totals, models, cacheHitRate) {
  var insights = [];
  var today = daily[daily.length - 1];
  if (today && totals.averageCost > 0 && today.totalCost > totals.averageCost * 1.5) {
    var ratio = today.totalCost / totals.averageCost;
    insights.push({ type: 'warning', text: '最近时段成本 ' + usd(today.totalCost) + '，是平均值的 ' + ratio.toFixed(1) + ' 倍' });
  }
  if (cacheHitRate > 0) {
    insights.push({ type: 'success', text: '缓存命中率 ' + cacheHitRate.toFixed(1) + '%，已节省 ' + fmt(totals.cacheReadTokens) + ' Token 读取' });
  }
  if (models.length >= 2) {
    var wr = models.filter(function(m) { return m.totalTokens > 0; });
    if (wr.length >= 2) {
      var sorted = wr.slice().sort(function(a, b) { return (a.totalCost / a.totalTokens) - (b.totalCost / b.totalTokens); });
      var ch = sorted[0], ex = sorted[sorted.length - 1];
      var r2 = (ex.totalCost / ex.totalTokens) / (ch.totalCost / ch.totalTokens);
      if (r2 > 1.2) insights.push({ type: 'info', text: ch.label + ' 的单 Token 成本比 ' + ex.label + ' 低 ' + r2.toFixed(1) + ' 倍' });
    }
  }
  if (daily.length > 0) {
    var busiest = daily.slice().sort(function(a, b) { return b.totalTokens - a.totalTokens; })[0];
    insights.push({ type: 'info', text: '最繁忙日期：' + busiest.date + '，共 ' + fmt(busiest.totalTokens) + ' Token（' + usd(busiest.totalCost) + '）' });
  }
  return insights.slice(0, 5);
}

function renderKPI(totals, viewData, view) {
  var cacheHitRate = totals.totalTokens > 0 ? (totals.cacheReadTokens / totals.totalTokens) * 100 : 0;
  var latest = viewData[viewData.length - 1];
  var latestCost = latest ? (latest.totalCost !== undefined ? latest.totalCost : (latest.costUSD !== undefined ? latest.costUSD : 0)) : 0;
  var latestTokens = latest ? (latest.totalTokens !== undefined ? latest.totalTokens : 0) : 0;
  var periodLabel = view === 'daily' ? '天' : view === 'weekly' ? '周' : view === 'monthly' ? '月' : view === 'session' ? '个会话' : '个窗口';

  var html = '';
  html += '<div class="kpi-card"><span class="kpi-label">总成本</span><span class="kpi-value">' + usd(totals.totalCost) + '</span>';
  html += '<span class="kpi-delta neutral">平均 ' + usd(totals.averageCost) + '/' + periodLabel + '</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">总 Token</span><span class="kpi-value">' + fmt(totals.totalTokens) + '</span>';
  html += '<span class="kpi-delta neutral">统计 ' + viewData.length + ' ' + periodLabel + '</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">缓存命中率</span><span class="kpi-value" style="color:' + (cacheHitRate > 50 ? 'var(--green)' : 'var(--text)') + '">' + cacheHitRate.toFixed(1) + '%</span>';
  html += '<span class="kpi-delta neutral">' + fmt(totals.cacheReadTokens) + ' 来自缓存</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">最近' + periodLabel + '</span><span class="kpi-value">' + (latest ? usd(latestCost) : '\u2014') + '</span>';
  html += '<span class="kpi-delta neutral">' + (latest ? fmt(latestTokens) + ' Token' : '暂无数据') + '</span></div>';
  return html;
}

function renderChart(data, view) {
  if (!data || data.length === 0) return '<p class="empty-text">暂无趋势数据。</p>';
  var costs = data.map(function(d) { return d.totalCost !== undefined ? d.totalCost : (d.costUSD || 0); });
  var maxCost = Math.max.apply(null, costs.concat([0.01]));
  var chartW = 480, chartH = 190, padL = 42, padR = 12, padT = 12, padB = 36;
  var plotW = chartW - padL - padR, plotH = chartH - padT - padB;
  var barSlot = plotW / data.length, barW = Math.min(barSlot * 0.6, 36);
  var labelStep = Math.max(1, Math.ceil(data.length / 7));
  var svg = '';
  [0, 0.25, 0.5, 0.75, 1].forEach(function(p) {
    var y = padT + plotH * (1 - p);
    var val = maxCost * p;
    svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (chartW - padR) + '" y2="' + y.toFixed(1) + '" stroke="#f0f0f0" stroke-width="1"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" font-size="9" fill="#9ca3af" text-anchor="end" font-family="sans-serif">$' + val.toFixed(val < 1 ? 2 : 1) + '</text>';
  });
  data.forEach(function(d, i) {
    var cost = d.totalCost !== undefined ? d.totalCost : (d.costUSD || 0);
    var barH = Math.max(2, (cost / maxCost) * plotH);
    var x = padL + i * barSlot + (barSlot - barW) / 2;
    var y = padT + plotH - barH;
    var label = chartLabel(d, view);
    var shortLabel = chartShortLabel(d, view);
    var isLast = i === data.length - 1;
    var color = isLast ? '#3b82f6' : '#93c5fd';
    svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="3" fill="' + color + '"><title>' + esc(label) + ': ' + usd(cost) + '</title></rect>';
    if (i === 0 || i === data.length - 1 || (i % labelStep === 0 && data.length - 1 - i >= Math.ceil(labelStep / 2))) {
      svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (chartH - 10) + '" font-size="9" fill="#9ca3af" text-anchor="middle" font-family="sans-serif">' + esc(shortLabel) + '</text>';
    }
  });
  return '<svg class="trend-chart" viewBox="0 0 ' + chartW + ' ' + chartH + '" xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>';
}
function chartLabel(d, view) {
  if (view === 'session') return d.sessionId ? (d.sessionId.length > 20 ? d.sessionId.slice(0, 20) + '...' : d.sessionId) : 'session';
  if (view === 'blocks') return (d.startTime || '').slice(0, 16);
  return d.period || d.date || '';
}
function chartShortLabel(d, view) {
  if (view === 'session') return d.sessionId ? d.sessionId.slice(0, 8) : 's';
  if (view === 'blocks') return (d.startTime || '').slice(5, 10);
  if (view === 'monthly') return (d.period || d.date || '').slice(0, 7);
  return (d.period || d.date || '').slice(5);
}

function renderDonut(totals) {
  var segs = [
    { label: '输入', value: totals.inputTokens, color: '#3b82f6' }, { label: '输出', value: totals.outputTokens, color: '#f59e0b' }, { label: '缓存读取', value: totals.cacheReadTokens, color: '#10b981' }, { label: '缓存写入', value: totals.cacheCreationTokens, color: '#8b5cf6' }
  ].filter(function(s) { return s.value > 0; });
  if (segs.length === 0 || totals.totalTokens === 0) return '<p class="empty-text">暂无 Token 数据。</p>';
  var r = 42, cx = 52, cy = 52, circ = 2 * Math.PI * r, offset = 0;
  var arcs = '';
  segs.forEach(function(s) {
    var pct = s.value / totals.totalTokens;
    var dl = pct * circ;
    arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="14" stroke-dasharray="' + dl.toFixed(2) + ' ' + (circ - dl).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
    offset += dl;
  });
  var legend = '';
  segs.forEach(function(s) {
    var pct = ((s.value / totals.totalTokens) * 100).toFixed(1);
    legend += '<div class="legend-item"><span class="legend-dot" style="background:' + s.color + '"></span><span class="legend-label">' + s.label + '</span><span class="legend-val">' + pct + '%</span></div>';
  });
  return '<div class="donut-wrap"><svg width="104" height="104" viewBox="0 0 104 104" xmlns="http://www.w3.org/2000/svg"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#f3f4f6" stroke-width="14"/>' + arcs + '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="13" font-weight="600" fill="#1a1a2e" text-anchor="middle" font-family="sans-serif">' + fmt(totals.totalTokens) + '</text><text x="' + cx + '" y="' + (cy + 14) + '" font-size="9" fill="#6b7280" text-anchor="middle" font-family="sans-serif">总 Token</text></svg><div class="legend">' + legend + '</div></div>';
}

function renderTable(data, view) {
  if (!data || data.length === 0) return '<p class="empty-text">暂无数据。</p>';
  if (view === 'session') return renderSessionTable(data, sessionLimit);
  if (view === 'blocks') return renderBlocksTable(data, blockLimit);
  return renderPeriodTable(data, view, periodLimit);
}
function renderPeriodTable(data, view, limit) {
  var firstCol = view === 'weekly' ? '周' : view === 'monthly' ? '月' : '日期';
  var rows = data.slice().reverse();
  if (limit) rows = rows.slice(0, limit);
  var html = limit ? '<div class="session-scroll" id="period-list">' : '';
  html += '<table class="data-table"><thead><tr><th>' + firstCol + '</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th><th>总计</th><th>成本</th></tr></thead><tbody>';
  rows.forEach(function(d) {
    html += '<tr><td>' + esc(d.period || d.date || '') + '</td>';
    html += '<td>' + fmt(d.inputTokens) + '</td>';
    html += '<td>' + fmt(d.outputTokens) + '</td>';
    html += '<td class="cache-cell">' + fmt(d.cacheReadTokens) + '</td>';
    html += '<td>' + fmt(d.cacheCreationTokens) + '</td>';
    html += '<td>' + fmt(d.totalTokens) + '</td>';
    html += '<td>' + usd(d.totalCost) + '</td></tr>';
  });
  html += '</tbody></table>';
  if (limit) {
    html += '</div>';
    if (limit < data.length) html += '<div class="load-more"><button onclick="loadMorePeriods()">加载更多 10 条</button></div>';
  }
  return html;
}
function renderSessionTable(data, limit) {
  if (limit) data = data.slice().sort(function(a, b) { return (b.firstActivity || '').localeCompare(a.firstActivity || ''); }).slice(0, limit);
  var html = '<table class="data-table"><thead><tr><th>会话</th><th>来源</th><th>Token</th><th>成本</th><th>消息数</th><th>持续时间</th></tr></thead><tbody>';
  data.slice().sort(function(a, b) { return (b.firstActivity || '').localeCompare(a.firstActivity || ''); }).forEach(function(s) {
    var tok = s.inputTokens + s.outputTokens + s.cacheCreationTokens + s.cacheReadTokens + (s.extraTotalTokens || 0);
    var sid = s.sessionId || '';
    html += '<tr><td class="session-id" title="' + esc(sid) + '">' + esc(sid.length > 22 ? sid.slice(0, 22) + '\u2026' : sid) + '</td>';
    html += '<td style="text-align:left">' + esc(s.source) + '</td>';
    html += '<td>' + fmt(tok) + '</td>';
    html += '<td>' + usd(s.totalCost) + '</td>';
    html += '<td>' + (s.messageCount || 0) + '</td>';
    html += '<td>' + fmtDur(s.firstActivity, s.lastActivity) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}
function renderBlocksTable(data, limit) {
  if (data.length === 0) return '<p class="empty-text">暂无 5 小时窗口数据。</p>';
  var html = '<div class="session-scroll" id="block-list"><table class="data-table"><thead><tr><th>开始</th><th>结束</th><th>记录数</th><th>模型</th><th>总 Token</th><th>成本</th><th>状态</th></tr></thead><tbody>';
  data.slice(0, limit).forEach(function(b) {
    html += '<tr><td>' + esc((b.startTime || '').slice(0, 16)) + '</td>';
    html += '<td>' + esc((b.endTime || '').slice(0, 16)) + '</td>';
    html += '<td>' + b.entries + '</td>';
    html += '<td style="text-align:left">' + esc((b.models || []).join(', ') || '-') + '</td>';
    html += '<td>' + fmt(b.totalTokens) + '</td>';
    html += '<td>' + usd(b.costUSD) + '</td>';
    html += '<td>' + (b.isActive ? '进行中' : '已完成') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (limit < data.length) html += '<div class="load-more"><button onclick="loadMoreBlocks()">加载更多 10 条</button></div>';
  return html;
}

function renderBreakdown(items, fillColor, trackColor) {
  if (!items || items.length === 0) return '<p class="empty-text">暂无数据。</p>';
  var maxCost = Math.max.apply(null, items.map(function(i) { return i.totalCost; }).concat([0.01]));
  var html = '';
  items.slice(0, 8).forEach(function(item) {
    var pct = (item.totalCost / maxCost) * 100;
    var cpm = item.totalTokens > 0 ? (item.totalCost / item.totalTokens) * 1000000 : 0;
    html += '<div class="breakdown-item"><div class="breakdown-header"><span class="breakdown-label">' + esc(item.label) + '</span><span class="breakdown-cost">' + usd(item.totalCost) + '</span></div>';
    html += '<div class="breakdown-sub">' + fmt(item.totalTokens) + ' Token \u00b7 每百万 Token $' + cpm.toFixed(2) + '</div>';
    html += '<div class="progress-track" style="background:' + trackColor + '"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + fillColor + '"></div></div></div>';
  });
  return html;
}

function renderSessions() {
  var filtered = getFilteredSessions();
  if (filtered.length === 0) return '<p class="empty-text">暂无会话记录。</p>';
  return renderSessionTable(filtered, sessionLimit);
}

function renderInsights(insights) {
  if (insights.length === 0) return '<p class="empty-text">暂未发现明显趋势。</p>';
  var html = '';
  insights.forEach(function(i) {
    html += '<div class="insight ' + i.type + '">' + esc(i.text) + '</div>';
  });
  return html;
}

function getViewData() {
  var filtered = getFilteredDaily();
  if (currentView === 'daily') return filtered;
  if (currentView === 'weekly') return computeWeekly(filtered);
  if (currentView === 'monthly') return computeMonthly(filtered);
  if (currentView === 'session') return getFilteredSessions();
  if (currentView === 'blocks') return getFilteredBlocks();
  return filtered;
}

function getChartData(data, view) {
  if (view === 'session') return data.slice().sort(function(a, b) { return (a.firstActivity || '').localeCompare(b.firstActivity || ''); }).slice(-20);
  if (view === 'blocks') return data.slice(-20);
  return data;
}

function getViewTotals(viewData) {
  if (currentView === 'session') {
    var t = { totalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, messageCount: 0, days: viewData.length, averageCost: 0 };
    viewData.forEach(function(s) {
      t.totalTokens += s.inputTokens + s.outputTokens + s.cacheCreationTokens + s.cacheReadTokens + (s.extraTotalTokens || 0);
      t.totalCost += s.totalCost;
      t.inputTokens += s.inputTokens;
      t.outputTokens += s.outputTokens;
      t.cacheCreationTokens += s.cacheCreationTokens;
      t.cacheReadTokens += s.cacheReadTokens;
      t.messageCount += s.messageCount || 0;
    });
    t.averageCost = t.days > 0 ? t.totalCost / t.days : 0;
    return t;
  }
  if (currentView === 'blocks') {
    var t2 = { totalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, messageCount: 0, days: viewData.length, averageCost: 0 };
    viewData.forEach(function(b) {
      t2.totalTokens += b.totalTokens;
      t2.totalCost += b.costUSD;
    });
    t2.cacheReadTokens = 0;
    t2.averageCost = t2.days > 0 ? t2.totalCost / t2.days : 0;
    return t2;
  }
  return computeTotals(viewData);
}

function renderAll() {
  var viewData = getViewData();
  var filteredDaily = getFilteredDaily();
  var totals = getViewTotals(viewData);
  var cacheHitRate = totals.totalTokens > 0 ? (totals.cacheReadTokens / totals.totalTokens) * 100 : 0;

  document.getElementById('kpi-row').innerHTML = renderKPI(totals, viewData, currentView);

  var chartTitle = currentView === 'daily' ? '每日成本趋势' : currentView === 'weekly' ? '每周成本趋势' : currentView === 'monthly' ? '每月成本趋势' : currentView === 'session' ? '最近 20 个会话成本' : '最近 20 个 5 小时窗口成本';
  document.getElementById('chart-title').textContent = chartTitle;
  document.getElementById('chart').innerHTML = renderChart(getChartData(viewData, currentView), currentView);

  document.getElementById('donut').innerHTML = renderDonut(totals);

  var tableTitle = currentView === 'daily' ? '每日明细' : currentView === 'weekly' ? '每周明细' : currentView === 'monthly' ? '每月明细' : currentView === 'session' ? '会话明细' : '5 小时窗口';
  document.getElementById('table-title').innerHTML = esc(tableTitle) + ' <span class="session-count" id="table-count"></span>';
  document.getElementById('table').innerHTML = renderTable(viewData, currentView);
  document.getElementById('table-count').textContent = currentView === 'daily' || currentView === 'weekly' || currentView === 'monthly' ? '显示 ' + Math.min(periodLimit, viewData.length) + ' / ' + viewData.length + ' 条' : '';
  document.getElementById('breakdown-card').style.display = currentView === 'session' ? 'none' : '';
  document.getElementById('sessions').closest('.session-card').style.display = currentView === 'session' ? '' : 'none';
  var blockContainer = document.getElementById('block-list');
  if (blockContainer && !blockContainer.dataset.bound) { blockContainer.dataset.bound = '1'; blockContainer.addEventListener('scroll', function() { if (blockContainer.scrollTop + blockContainer.clientHeight >= blockContainer.scrollHeight - 60 && blockLimit < getFilteredBlocks().length) loadMoreBlocks(); }); }
  var periodContainer = document.getElementById('period-list');
  if (periodContainer && !periodContainer.dataset.bound) { periodContainer.dataset.bound = '1'; periodContainer.addEventListener('scroll', function() { if (periodContainer.scrollTop + periodContainer.clientHeight >= periodContainer.scrollHeight - 60 && periodLimit < getViewData().length) loadMorePeriods(); }); }

  var models = aggregateModels(filteredDaily);
  var projects = aggregateProjects(filteredDaily);
  document.getElementById('models').innerHTML = renderBreakdown(models, 'var(--blue)', 'var(--blue-light)');
  document.getElementById('projects').innerHTML = renderBreakdown(projects, 'var(--green)', 'var(--green-light)');

  document.getElementById('sessions').innerHTML = renderSessions();
  var sessionTotal = getFilteredSessions().length;
  document.getElementById('session-count').textContent = '显示 ' + Math.min(sessionLimit, sessionTotal) + ' / ' + sessionTotal + ' 条';
  document.getElementById('load-more').style.display = sessionLimit < sessionTotal ? '' : 'none';
  var sessionContainer = document.getElementById('sessions');
  if (!sessionContainer.dataset.bound) { sessionContainer.dataset.bound = '1'; sessionContainer.addEventListener('scroll', function() { if (sessionContainer.scrollTop + sessionContainer.clientHeight >= sessionContainer.scrollHeight - 60 && sessionLimit < getFilteredSessions().length) loadMoreSessions(); }); }

  var insights = computeInsights(filteredDaily, totals, models, cacheHitRate);
  if (meta.sessionCount > 0) {
    insights.push({ type: 'info', text: '当前范围内包含 ' + getFilteredSessions().length + ' 个会话，覆盖 ' + filteredDaily.length + ' 天' });
  }
  document.getElementById('insights').innerHTML = renderInsights(insights);

  document.getElementById('footer').innerHTML = '由 usagetoken 生成 \u00b7 ' + meta.recordCount + ' 条记录 \u00b7 ' + meta.sessionCount + ' 个会话 \u00b7 ' + dailyData.length + ' 天数据 \u00b7 <a href="https://github.com/jiaming89/usage-token" target="_blank" rel="noopener noreferrer">GitHub</a> \u00b7 <a href="https://gitee.com/mujiaming/usage-token" target="_blank" rel="noopener noreferrer">Gitee</a>';
}

function switchView(view) {
  currentView = view;
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view);
  }
  renderAll();
}
function onDateChange() { sessionLimit = 50; blockLimit = 10; periodLimit = 10; renderAll(); }
function onSourceChange() { sessionLimit = 50; blockLimit = 10; periodLimit = 10; renderAll(); }
function loadMoreSessions() { sessionLimit += 50; renderAll(); }
function loadMoreBlocks() { blockLimit += 10; renderAll(); }
function loadMorePeriods() { periodLimit += 10; renderAll(); }
function recentThirtyDays() { var d = new Date(); d.setDate(d.getDate() - 29); document.getElementById('date-from').value = d.toISOString().slice(0,10); document.getElementById('date-to').value = ''; onDateChange(); }
function refreshCache() { fetch('/api/dashboard/refresh', {method:'POST'}).then(function(){ var b=document.getElementById('refresh-cache'); if(b){b.textContent='正在刷新…';b.disabled=true;} }); }
function clearDates() {
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value = '';
  onDateChange();
}

renderAll();
</script>
</body>
</html>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export async function writeDashboardFile(storeDir: string, warehouse: LocalWarehouse, htmlFile?: string): Promise<string> {
  const target = htmlFile ?? join(storeDir, "dashboard.html");
  await writeFile(target, renderDashboardHtml(warehouse), "utf8");
  return target;
}

export function renderTeamDashboardHtml(mode: "local" | "team" | "org", payload: { teamDaily: TeamDailySummary[]; orgDaily: OrgDailySummary[] }): string {
  const latestTeams = payload.teamDaily.slice(-7).reverse();
  const latestOrgs = payload.orgDaily.slice(-7).reverse();
  const teamTotalCost = payload.teamDaily.reduce((s, t) => s + t.totalCost, 0);
  const teamTotalTokens = payload.teamDaily.reduce((s, t) => s + t.totalTokens, 0);
  const teamTotalMessages = payload.teamDaily.reduce((s, t) => s + t.messageCount, 0);
  const teamCount = new Set(payload.teamDaily.map((t) => t.teamId)).size;
  const userCount = new Set(payload.teamDaily.flatMap((t) => t.users.map((u) => u.userId))).size;
  const maxTeamCost = Math.max(...latestTeams.map((t) => t.totalCost), 0.01);

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>usagetoken ${escapeHtml(mode)} server</title>
<style>
  :root { --bg:#f7f8fa; --card:#fff; --border:#e8eaed; --text:#1a1a2e; --muted:#6b7280; --blue:#3b82f6; --blue-light:#dbeafe; --green:#10b981; --green-light:#d1fae5; --amber:#f59e0b; --amber-light:#fef3c7; --radius:12px; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
  .container { max-width:1100px; margin:0 auto; padding:24px 20px 48px; }
  .header { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:20px; flex-wrap:wrap; gap:8px; }
  .header h1 { font-size:22px; font-weight:600; letter-spacing:-0.02em; }
  .header-sub { font-size:13px; color:var(--muted); margin-top:2px; }
  .badge { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px; background:var(--blue-light); color:#1e40af; font-size:12px; font-weight:500; }
  .kpi-row { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
  .kpi-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
  .kpi-label { display:block; font-size:12px; color:var(--muted); margin-bottom:6px; }
  .kpi-value { font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; }
  .kpi-sub { font-size:11px; color:var(--muted); margin-top:4px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px 20px; margin-bottom:16px; }
  .card h2 { font-size:14px; font-weight:600; margin-bottom:14px; }
  .data-table { width:100%; border-collapse:collapse; font-size:13px; }
  .data-table th { text-align:right; padding:6px 10px; font-weight:500; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid var(--border); }
  .data-table th:first-child { text-align:left; }
  .data-table td { text-align:right; padding:8px 10px; border-bottom:1px solid #f3f4f6; font-variant-numeric:tabular-nums; }
  .data-table td:first-child { text-align:left; font-weight:500; }
  .data-table tr:last-child td { border-bottom:none; }
  .data-table tr:hover td { background:#f9fafb; }
  .progress-track { height:6px; background:#f3f4f6; border-radius:3px; overflow:hidden; margin-top:4px; }
  .progress-fill { height:100%; border-radius:3px; background:var(--blue); }
  .empty-text { color:var(--muted); font-size:13px; }
  .footer { text-align:center; font-size:12px; color:var(--muted); padding:16px 0 8px; }
  @media (max-width:768px) { .kpi-row { grid-template-columns:repeat(2,1fr); } .data-table { font-size:12px; } }
</style></head>
<body><div class="container">
  <header class="header">
    <div>
      <h1>${escapeHtml(mode.toUpperCase())} Usage Server</h1>
      <div class="header-sub">Company and team rollups with daily batch ingestion</div>
    </div>
    <span class="badge">${escapeHtml(mode)}</span>
  </header>

  <div class="kpi-row">
    <div class="kpi-card"><span class="kpi-label">Total cost</span><span class="kpi-value">${usd(teamTotalCost)}</span><span class="kpi-sub">${payload.teamDaily.length} day${payload.teamDaily.length !== 1 ? "s" : ""} of data</span></div>
    <div class="kpi-card"><span class="kpi-label">Total tokens</span><span class="kpi-value">${formatNumber(teamTotalTokens)}</span><span class="kpi-sub">${teamTotalMessages} messages</span></div>
    <div class="kpi-card"><span class="kpi-label">Teams</span><span class="kpi-value">${teamCount}</span><span class="kpi-sub">${userCount} user${userCount !== 1 ? "s" : ""}</span></div>
    <div class="kpi-card"><span class="kpi-label">Batches</span><span class="kpi-value">${payload.orgDaily.length}</span><span class="kpi-sub">org rollup${payload.orgDaily.length !== 1 ? "s" : ""}</span></div>
  </div>

  <div class="card">
    <h2>Latest team summaries</h2>
    ${latestTeams.length === 0 ? '<p class="empty-text">No uploaded batches yet.</p>' : `<table class="data-table"><thead><tr><th>Date / Team / User</th><th>Tokens</th><th>Messages</th><th>Cost</th></tr></thead><tbody>
      ${latestTeams.flatMap((item) => item.users.map((user) => {
        const pct = (item.totalCost / maxTeamCost) * 100;
        return `<tr><td>${escapeHtml(item.date)} \u00b7 ${escapeHtml(item.teamName)} \u00b7 ${escapeHtml(user.displayName)}<div class="progress-track"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div></td><td>${formatNumber(user.totalTokens)}</td><td>${user.messageCount}</td><td>${usd(user.totalCost)}</td></tr>`;
      })).join("")}
    </tbody></table>`}
  </div>

  <div class="card">
    <h2>Latest org summaries</h2>
    ${latestOrgs.length === 0 ? '<p class="empty-text">No organization rollups yet.</p>' : `<table class="data-table"><thead><tr><th>Date / Org / Team</th><th>Tokens</th><th>Messages</th><th>Cost</th></tr></thead><tbody>
      ${latestOrgs.flatMap((item) => item.teams.map((team) => `<tr><td>${escapeHtml(item.date)} \u00b7 ${escapeHtml(item.orgName)} \u00b7 ${escapeHtml(team.teamName)}</td><td>${formatNumber(team.totalTokens)}</td><td>${team.messageCount}</td><td>${usd(team.totalCost)}</td></tr>`)).join("")}
    </tbody></table>`}
  </div>

  <footer class="footer">usagetoken ${escapeHtml(mode)} server \u00b7 ${payload.teamDaily.length} team day${payload.teamDaily.length !== 1 ? "s" : ""} \u00b7 ${payload.orgDaily.length} org day${payload.orgDaily.length !== 1 ? "s" : ""}</footer>
</div></body></html>`;
}

function renderEmptyDashboard(friendlyDate: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Usage Dashboard</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #1a1a2e; margin: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 80px 20px; text-align: center; }
    h1 { font-size: 22px; font-weight: 600; }
    p { color: #6b7280; font-size: 14px; margin-top: 8px; }
    code { background: #e8eaed; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>No usage data yet</h1>
    <p>Generated ${escapeHtml(friendlyDate)}</p>
    <p>Run <code>usagetoken sync</code> or <code>cc</code> to collect your token usage.</p>
  </div>
</body>
</html>`;
}

function formatFriendlyDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function usd(value: number): string {
  return `$${round2(value).toFixed(2)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
