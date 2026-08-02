import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeBlocks } from "../core/blocks.js";
import type { DailyUserSummary, LocalWarehouse, OrgDailySummary, SessionSummaryRecord, TeamDailySummary } from "../types.js";

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

  const dailyJson = safeJson(daily.map((d) => ({
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
  })));

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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Usage Dashboard</title>
  <style>
    :root {
      --bg: #f7f8fa; --card: #ffffff; --border: #e8eaed; --text: #1a1a2e; --muted: #6b7280;
      --blue: #3b82f6; --blue-light: #dbeafe; --green: #10b981; --green-light: #d1fae5;
      --amber: #f59e0b; --amber-light: #fef3c7; --red: #ef4444; --red-light: #fee2e2;
      --purple: #8b5cf6; --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px 20px 48px; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
    .header h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
    .header-sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: var(--blue-light); color: #1e40af; font-size: 12px; font-weight: 500; }
    .tab-bar { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
    .tab { padding: 8px 16px; border: none; background: none; font-size: 13px; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; border-radius: 6px 6px 0 0; }
    .tab:hover { color: var(--text); background: #f0f4f8; }
    .tab.active { color: var(--blue); border-bottom-color: var(--blue); }
    .date-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .date-filter input[type="date"] { padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; color: var(--text); background: var(--card); }
    .date-filter label { font-size: 12px; color: var(--muted); }
    .date-btn { padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; color: var(--muted); background: var(--card); cursor: pointer; }
    .date-btn:hover { color: var(--blue); border-color: var(--blue); }
    .kpi-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    .kpi-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .kpi-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; display: block; }
    .kpi-delta { display: inline-block; font-size: 11px; font-weight: 500; margin-top: 4px; }
    .kpi-delta.up { color: var(--red); }
    .kpi-delta.down { color: var(--green); }
    .kpi-delta.neutral { color: var(--muted); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 16px; }
    .card h2 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
    .chart-row { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-bottom: 16px; }
    .trend-chart { width: 100%; height: auto; display: block; }
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
    @media (max-width: 768px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .chart-row, .two-col { grid-template-columns: 1fr; }
      .donut-wrap { flex-direction: column; }
      .data-table { font-size: 12px; }
      .data-table th, .data-table td { padding: 6px 6px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div>
        <h1>AI Usage Dashboard</h1>
        <div class="header-sub" id="header-sub"></div>
      </div>
      <span class="badge" id="user-badge"></span>
    </header>

    <div class="tab-bar" id="tab-bar">
      <button class="tab active" data-view="daily" onclick="switchView('daily')">Daily</button>
      <button class="tab" data-view="weekly" onclick="switchView('weekly')">Weekly</button>
      <button class="tab" data-view="monthly" onclick="switchView('monthly')">Monthly</button>
      <button class="tab" data-view="session" onclick="switchView('session')">Session</button>
      <button class="tab" data-view="blocks" onclick="switchView('blocks')">Blocks</button>
    </div>

    <div class="date-filter">
      <label>From</label>
      <input type="date" id="date-from" onchange="onDateChange()" />
      <label>to</label>
      <input type="date" id="date-to" onchange="onDateChange()" />
      <button class="date-btn" onclick="clearDates()">All time</button>
    </div>

    <div class="kpi-row" id="kpi-row"></div>

    <div class="chart-row">
      <div class="card">
        <h2 id="chart-title">Cost trend</h2>
        <div id="chart"></div>
      </div>
      <div class="card">
        <h2>Token composition</h2>
        <div id="donut"></div>
      </div>
    </div>

    <div class="card">
      <h2 id="table-title">Breakdown</h2>
      <div id="table" style="overflow-x:auto"></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Top models</h2>
        <div id="models"></div>
      </div>
      <div class="card">
        <h2>Top projects</h2>
        <div id="projects"></div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Recent sessions</h2>
        <div id="sessions" style="overflow-x:auto"></div>
      </div>
      <div class="card">
        <h2>Insights</h2>
        <div id="insights"></div>
      </div>
    </div>

    <footer class="footer" id="footer"></footer>
  </div>

<script>
var dailyData = ${dailyJson};
var sessionData = ${sessionJson};
var blocksData = ${blocksJson};
var meta = ${metaJson};
var currentView = 'daily';

document.getElementById('header-sub').textContent = meta.friendlyDate + ' \u00b7 ' + meta.sourceCount + ' source' + (meta.sourceCount > 1 ? 's' : '') + ' \u00b7 ' + meta.recordCount + ' records \u00b7 ' + meta.sessionCount + ' sessions';
document.getElementById('user-badge').textContent = meta.displayName;

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
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm';
  return '<1m';
}
function dateStr(iso) { return iso ? iso.slice(0, 10) : ''; }

function getFilteredDaily() {
  var from = document.getElementById('date-from').value;
  var to = document.getElementById('date-to').value;
  return dailyData.filter(function(d) {
    if (from && d.date < from) return false;
    if (to && d.date > to) return false;
    return true;
  });
}
function getFilteredSessions() {
  var from = document.getElementById('date-from').value;
  var to = document.getElementById('date-to').value;
  return sessionData.filter(function(s) {
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
    insights.push({ type: 'warning', text: 'Latest period cost (' + usd(today.totalCost) + ') is ' + ratio.toFixed(1) + 'x the average (' + usd(totals.averageCost) + ')' });
  }
  if (cacheHitRate > 0) {
    insights.push({ type: 'success', text: 'Cache hit rate ' + cacheHitRate.toFixed(1) + '% \u2014 ' + fmt(totals.cacheReadTokens) + ' tokens served from cache' });
  }
  if (models.length >= 2) {
    var wr = models.filter(function(m) { return m.totalTokens > 0; });
    if (wr.length >= 2) {
      var sorted = wr.slice().sort(function(a, b) { return (a.totalCost / a.totalTokens) - (b.totalCost / b.totalTokens); });
      var ch = sorted[0], ex = sorted[sorted.length - 1];
      var r2 = (ex.totalCost / ex.totalTokens) / (ch.totalCost / ch.totalTokens);
      if (r2 > 1.2) insights.push({ type: 'info', text: ch.label + ' costs ' + r2.toFixed(1) + 'x less per token than ' + ex.label });
    }
  }
  if (daily.length > 0) {
    var busiest = daily.slice().sort(function(a, b) { return b.totalTokens - a.totalTokens; })[0];
    insights.push({ type: 'info', text: 'Busiest period: ' + busiest.date + ' with ' + fmt(busiest.totalTokens) + ' tokens (' + usd(busiest.totalCost) + ')' });
  }
  return insights.slice(0, 5);
}

function renderKPI(totals, viewData, view) {
  var cacheHitRate = totals.totalTokens > 0 ? (totals.cacheReadTokens / totals.totalTokens) * 100 : 0;
  var latest = viewData[viewData.length - 1];
  var latestCost = latest ? (latest.totalCost !== undefined ? latest.totalCost : (latest.costUSD !== undefined ? latest.costUSD : 0)) : 0;
  var latestTokens = latest ? (latest.totalTokens !== undefined ? latest.totalTokens : 0) : 0;
  var periodLabel = view === 'daily' ? 'day' : view === 'weekly' ? 'week' : view === 'monthly' ? 'month' : view === 'session' ? 'session' : 'block';

  var html = '';
  html += '<div class="kpi-card"><span class="kpi-label">Total cost</span><span class="kpi-value">' + usd(totals.totalCost) + '</span>';
  html += '<span class="kpi-delta neutral">avg ' + usd(totals.averageCost) + '/' + periodLabel + '</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">Total tokens</span><span class="kpi-value">' + fmt(totals.totalTokens) + '</span>';
  html += '<span class="kpi-delta neutral">' + viewData.length + ' ' + periodLabel + (viewData.length !== 1 ? 's' : '') + ' tracked</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">Cache hit rate</span><span class="kpi-value" style="color:' + (cacheHitRate > 50 ? 'var(--green)' : 'var(--text)') + '">' + cacheHitRate.toFixed(1) + '%</span>';
  html += '<span class="kpi-delta neutral">' + fmt(totals.cacheReadTokens) + ' from cache</span></div>';
  html += '<div class="kpi-card"><span class="kpi-label">Latest ' + periodLabel + '</span><span class="kpi-value">' + (latest ? usd(latestCost) : '\u2014') + '</span>';
  html += '<span class="kpi-delta neutral">' + (latest ? fmt(latestTokens) + ' tokens' : 'no data') + '</span></div>';
  return html;
}

function renderChart(data, view) {
  if (!data || data.length === 0) return '<p class="empty-text">No trend data yet.</p>';
  var costs = data.map(function(d) { return d.totalCost !== undefined ? d.totalCost : (d.costUSD || 0); });
  var maxCost = Math.max.apply(null, costs.concat([0.01]));
  var chartW = 480, chartH = 150, padL = 38, padR = 12, padT = 10, padB = 28;
  var plotW = chartW - padL - padR, plotH = chartH - padT - padB;
  var barSlot = plotW / data.length, barW = Math.min(barSlot * 0.6, 36);
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
    svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (chartH - 8) + '" font-size="9" fill="#9ca3af" text-anchor="middle" font-family="sans-serif">' + esc(shortLabel) + '</text>';
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
    { label: 'Input', value: totals.inputTokens, color: '#3b82f6' },
    { label: 'Output', value: totals.outputTokens, color: '#f59e0b' },
    { label: 'Cache read', value: totals.cacheReadTokens, color: '#10b981' },
    { label: 'Cache write', value: totals.cacheCreationTokens, color: '#8b5cf6' }
  ].filter(function(s) { return s.value > 0; });
  if (segs.length === 0 || totals.totalTokens === 0) return '<p class="empty-text">No token data.</p>';
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
  return '<div class="donut-wrap"><svg width="104" height="104" viewBox="0 0 104 104" xmlns="http://www.w3.org/2000/svg"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#f3f4f6" stroke-width="14"/>' + arcs + '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="13" font-weight="600" fill="#1a1a2e" text-anchor="middle" font-family="sans-serif">' + fmt(totals.totalTokens) + '</text><text x="' + cx + '" y="' + (cy + 14) + '" font-size="9" fill="#6b7280" text-anchor="middle" font-family="sans-serif">total tokens</text></svg><div class="legend">' + legend + '</div></div>';
}

function renderTable(data, view) {
  if (!data || data.length === 0) return '<p class="empty-text">No data found.</p>';
  if (view === 'session') return renderSessionTable(data);
  if (view === 'blocks') return renderBlocksTable(data);
  return renderPeriodTable(data, view);
}
function renderPeriodTable(data, view) {
  var firstCol = view === 'weekly' ? 'Week' : view === 'monthly' ? 'Month' : 'Date';
  var html = '<table class="data-table"><thead><tr><th>' + firstCol + '</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total</th><th>Cost</th></tr></thead><tbody>';
  data.slice().reverse().forEach(function(d) {
    html += '<tr><td>' + esc(d.period || d.date || '') + '</td>';
    html += '<td>' + fmt(d.inputTokens) + '</td>';
    html += '<td>' + fmt(d.outputTokens) + '</td>';
    html += '<td class="cache-cell">' + fmt(d.cacheReadTokens) + '</td>';
    html += '<td>' + fmt(d.cacheCreationTokens) + '</td>';
    html += '<td>' + fmt(d.totalTokens) + '</td>';
    html += '<td>' + usd(d.totalCost) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}
function renderSessionTable(data) {
  var html = '<table class="data-table"><thead><tr><th>Session</th><th>Source</th><th>Tokens</th><th>Cost</th><th>Messages</th><th>Duration</th></tr></thead><tbody>';
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
function renderBlocksTable(data) {
  if (data.length === 0) return '<p class="empty-text">No blocks data. Blocks are computed from 5-hour usage windows (all sources).</p>';
  var html = '<table class="data-table"><thead><tr><th>Start</th><th>End</th><th>Entries</th><th>Models</th><th>Total tokens</th><th>Cost</th><th>Status</th></tr></thead><tbody>';
  data.forEach(function(b) {
    html += '<tr><td>' + esc((b.startTime || '').slice(0, 16)) + '</td>';
    html += '<td>' + esc((b.endTime || '').slice(0, 16)) + '</td>';
    html += '<td>' + b.entries + '</td>';
    html += '<td style="text-align:left">' + esc((b.models || []).join(', ') || '-') + '</td>';
    html += '<td>' + fmt(b.totalTokens) + '</td>';
    html += '<td>' + usd(b.costUSD) + '</td>';
    html += '<td>' + (b.isActive ? 'active' : 'complete') + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderBreakdown(items, fillColor, trackColor) {
  if (!items || items.length === 0) return '<p class="empty-text">No data yet.</p>';
  var maxCost = Math.max.apply(null, items.map(function(i) { return i.totalCost; }).concat([0.01]));
  var html = '';
  items.slice(0, 8).forEach(function(item) {
    var pct = (item.totalCost / maxCost) * 100;
    var cpm = item.totalTokens > 0 ? (item.totalCost / item.totalTokens) * 1000000 : 0;
    html += '<div class="breakdown-item"><div class="breakdown-header"><span class="breakdown-label">' + esc(item.label) + '</span><span class="breakdown-cost">' + usd(item.totalCost) + '</span></div>';
    html += '<div class="breakdown-sub">' + fmt(item.totalTokens) + ' tokens \u00b7 $' + cpm.toFixed(2) + '/M tok</div>';
    html += '<div class="progress-track" style="background:' + trackColor + '"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + fillColor + '"></div></div></div>';
  });
  return html;
}

function renderSessions() {
  var filtered = getFilteredSessions();
  if (filtered.length === 0) return '<p class="empty-text">No sessions recorded.</p>';
  return renderSessionTable(filtered);
}

function renderInsights(insights) {
  if (insights.length === 0) return '<p class="empty-text">No notable patterns detected yet.</p>';
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

  var chartTitle = currentView === 'daily' ? 'Cost trend (daily)' : currentView === 'weekly' ? 'Cost trend (weekly)' : currentView === 'monthly' ? 'Cost trend (monthly)' : currentView === 'session' ? 'Cost per session' : 'Cost per block';
  document.getElementById('chart-title').textContent = chartTitle;
  document.getElementById('chart').innerHTML = renderChart(viewData, currentView);

  document.getElementById('donut').innerHTML = renderDonut(totals);

  var tableTitle = currentView === 'daily' ? 'Daily breakdown' : currentView === 'weekly' ? 'Weekly breakdown' : currentView === 'monthly' ? 'Monthly breakdown' : currentView === 'session' ? 'Session list' : 'Blocks (5h windows)';
  document.getElementById('table-title').textContent = tableTitle;
  document.getElementById('table').innerHTML = renderTable(viewData, currentView);

  var models = aggregateModels(filteredDaily);
  var projects = aggregateProjects(filteredDaily);
  document.getElementById('models').innerHTML = renderBreakdown(models, 'var(--blue)', 'var(--blue-light)');
  document.getElementById('projects').innerHTML = renderBreakdown(projects, 'var(--green)', 'var(--green-light)');

  document.getElementById('sessions').innerHTML = renderSessions();

  var insights = computeInsights(filteredDaily, totals, models, cacheHitRate);
  if (meta.sessionCount > 0) {
    insights.push({ type: 'info', text: meta.sessionCount + ' session' + (meta.sessionCount > 1 ? 's' : '') + ' tracked across ' + filteredDaily.length + ' day' + (filteredDaily.length !== 1 ? 's' : '') });
  }
  document.getElementById('insights').innerHTML = renderInsights(insights);

  document.getElementById('footer').textContent = 'Generated by usagetoken \u00b7 ' + meta.recordCount + ' records \u00b7 ' + meta.sessionCount + ' sessions \u00b7 ' + dailyData.length + ' days';
}

function switchView(view) {
  currentView = view;
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view);
  }
  renderAll();
}
function onDateChange() { renderAll(); }
function clearDates() {
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value = '';
  renderAll();
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
