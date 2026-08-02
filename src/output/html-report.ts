import { writeFile } from "node:fs/promises";
import type { UsageBlock } from "../core/blocks.js";
import type { ReportKind, UsageSummary } from "../types.js";

export function renderReportHtml(command: string, data: UsageSummary[] | UsageBlock[]): string {
  if (command === "blocks") {
    return renderBlocksReportHtml(data as UsageBlock[]);
  }
  return renderSummaryReportHtml(command as ReportKind, data as UsageSummary[]);
}

export async function writeReportHtml(command: string, htmlFile: string | undefined, data: UsageSummary[] | UsageBlock[]): Promise<string> {
  const html = renderReportHtml(command, data);
  const target = htmlFile ?? `${command}-report.html`;
  await writeFile(target, html, "utf8");
  return target;
}

function renderSummaryReportHtml(kind: ReportKind, rows: UsageSummary[]): string {
  const title = kind.charAt(0).toUpperCase() + kind.slice(1) + " usage report";
  const firstCol = kind === "monthly" ? "Month" : kind === "weekly" ? "Week" : kind === "session" ? "Session" : "Date";
  const totals = rows.reduce(
    (acc, r) => {
      acc.input += r.inputTokens;
      acc.output += r.outputTokens;
      acc.cacheCreate += r.cacheCreationTokens;
      acc.cacheRead += r.cacheReadTokens;
      acc.total += r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.extraTotalTokens;
      acc.cost += r.totalCost;
      acc.messages += r.messageCount;
      return acc;
    },
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0, cost: 0, messages: 0 }
  );
  const maxCost = Math.max(...rows.map((r) => r.totalCost), 0.01);
  const now = new Date();
  const genDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#f7f8fa; --card:#fff; --border:#e8eaed; --text:#1a1a2e; --muted:#6b7280; --blue:#3b82f6; --blue-light:#dbeafe; --green:#10b981; --radius:12px; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
    .container { max-width:1000px; margin:0 auto; padding:24px 20px 48px; }
    .header { margin-bottom:20px; }
    .header h1 { font-size:22px; font-weight:600; letter-spacing:-0.02em; }
    .header-sub { font-size:13px; color:var(--muted); margin-top:2px; }
    .kpi-row { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
    .kpi-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
    .kpi-label { display:block; font-size:12px; color:var(--muted); margin-bottom:6px; }
    .kpi-value { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; }
    .kpi-sub { font-size:11px; color:var(--muted); margin-top:4px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px 20px; margin-bottom:16px; }
    .card h2 { font-size:14px; font-weight:600; margin-bottom:14px; }
    .data-table { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:right; padding:6px 10px; font-weight:500; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid var(--border); white-space:nowrap; }
    .data-table th:first-child { text-align:left; }
    .data-table td { text-align:right; padding:8px 10px; border-bottom:1px solid #f3f4f6; font-variant-numeric:tabular-nums; }
    .data-table td:first-child { text-align:left; font-weight:500; }
    .data-table tr:last-child td { border-bottom:none; }
    .data-table tr:hover td { background:#f9fafb; }
    .data-table tr.total-row td { font-weight:600; border-top:2px solid var(--border); }
    .cache-cell { color:var(--green); font-weight:500; }
    .bar-cell { position:relative; min-width:80px; }
    .bar-track { height:5px; background:#f3f4f6; border-radius:3px; overflow:hidden; margin-top:3px; }
    .bar-fill { height:100%; border-radius:3px; background:var(--blue); }
    .footer { text-align:center; font-size:12px; color:var(--muted); padding:16px 0 8px; }
    @media (max-width:768px) { .kpi-row { grid-template-columns:repeat(2,1fr); } .data-table { font-size:12px; } }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>${escapeHtml(title)}</h1>
      <div class="header-sub">Generated ${escapeHtml(genDate)} \u00b7 ${rows.length} ${kind === "session" ? "session" : kind === "monthly" ? "month" : kind === "weekly" ? "week" : "day"}${rows.length !== 1 ? "s" : ""}</div>
    </header>

    <div class="kpi-row">
      <div class="kpi-card"><span class="kpi-label">Total cost</span><span class="kpi-value">$${totals.cost.toFixed(2)}</span><span class="kpi-sub">${totals.messages} messages</span></div>
      <div class="kpi-card"><span class="kpi-label">Total tokens</span><span class="kpi-value">${formatCompact(totals.total)}</span><span class="kpi-sub">${rows.length} ${kind === "session" ? "sessions" : "periods"}</span></div>
      <div class="kpi-card"><span class="kpi-label">Input tokens</span><span class="kpi-value">${formatCompact(totals.input)}</span><span class="kpi-sub">${((totals.input / totals.total) * 100).toFixed(1)}% of total</span></div>
      <div class="kpi-card"><span class="kpi-label">Cache read</span><span class="kpi-value" style="color:var(--green)">${formatCompact(totals.cacheRead)}</span><span class="kpi-sub">${((totals.cacheRead / totals.total) * 100).toFixed(1)}% of total</span></div>
    </div>

    <div class="card">
      <h2>Breakdown</h2>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHtml(firstCol)}</th>
              <th>Models</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cache Create</th>
              <th>Cache Read</th>
              <th>Total</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const tt = r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.extraTotalTokens;
              const pct = (r.totalCost / maxCost) * 100;
              return `<tr>
                <td>${escapeHtml(r.period)}</td>
                <td style="text-align:left;font-size:11px">${escapeHtml(r.modelsUsed.join(", ") || "-")}</td>
                <td>${formatNumber(r.inputTokens)}</td>
                <td>${formatNumber(r.outputTokens)}</td>
                <td>${formatNumber(r.cacheCreationTokens)}</td>
                <td class="cache-cell">${formatNumber(r.cacheReadTokens)}</td>
                <td>${formatNumber(tt)}</td>
                <td class="bar-cell">$${r.totalCost.toFixed(2)}<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div></td>
              </tr>`;
            }).join("")}
            <tr class="total-row">
              <td>Total</td>
              <td></td>
              <td>${formatNumber(totals.input)}</td>
              <td>${formatNumber(totals.output)}</td>
              <td>${formatNumber(totals.cacheCreate)}</td>
              <td class="cache-cell">${formatNumber(totals.cacheRead)}</td>
              <td>${formatNumber(totals.total)}</td>
              <td>$${totals.cost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <footer class="footer">Generated by usagetoken \u00b7 ${escapeHtml(kind)} report \u00b7 ${rows.length} rows</footer>
  </div>
</body>
</html>`;
}

function renderBlocksReportHtml(blocks: UsageBlock[]): string {
  const title = "Blocks usage report";
  const totals = blocks.reduce(
    (acc, b) => {
      acc.tokens += b.totalTokens;
      acc.cost += b.costUSD;
      acc.entries += b.entries;
      return acc;
    },
    { tokens: 0, cost: 0, entries: 0 }
  );
  const maxCost = Math.max(...blocks.map((b) => b.costUSD), 0.01);
  const now = new Date();
  const genDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#f7f8fa; --card:#fff; --border:#e8eaed; --text:#1a1a2e; --muted:#6b7280; --blue:#3b82f6; --green:#10b981; --amber:#f59e0b; --radius:12px; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
    .container { max-width:1000px; margin:0 auto; padding:24px 20px 48px; }
    .header { margin-bottom:20px; }
    .header h1 { font-size:22px; font-weight:600; letter-spacing:-0.02em; }
    .header-sub { font-size:13px; color:var(--muted); margin-top:2px; }
    .kpi-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
    .kpi-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
    .kpi-label { display:block; font-size:12px; color:var(--muted); margin-bottom:6px; }
    .kpi-value { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; }
    .kpi-sub { font-size:11px; color:var(--muted); margin-top:4px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px 20px; margin-bottom:16px; }
    .card h2 { font-size:14px; font-weight:600; margin-bottom:14px; }
    .data-table { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:right; padding:6px 10px; font-weight:500; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid var(--border); white-space:nowrap; }
    .data-table th:first-child { text-align:left; }
    .data-table td { text-align:right; padding:8px 10px; border-bottom:1px solid #f3f4f6; font-variant-numeric:tabular-nums; }
    .data-table td:first-child { text-align:left; font-weight:500; }
    .data-table tr:last-child td { border-bottom:none; }
    .data-table tr:hover td { background:#f9fafb; }
    .status-active { color:var(--green); font-weight:500; }
    .status-gap { color:var(--muted); }
    .bar-track { height:5px; background:#f3f4f6; border-radius:3px; overflow:hidden; margin-top:3px; }
    .bar-fill { height:100%; border-radius:3px; background:var(--blue); }
    .footer { text-align:center; font-size:12px; color:var(--muted); padding:16px 0 8px; }
    @media (max-width:768px) { .kpi-row { grid-template-columns:1fr; } .data-table { font-size:12px; } }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>${escapeHtml(title)}</h1>
      <div class="header-sub">Generated ${escapeHtml(genDate)} \u00b7 ${blocks.length} block${blocks.length !== 1 ? "s" : ""} \u00b7 5-hour windows</div>
    </header>

    <div class="kpi-row">
      <div class="kpi-card"><span class="kpi-label">Total cost</span><span class="kpi-value">$${totals.cost.toFixed(2)}</span><span class="kpi-sub">${totals.entries} entries</span></div>
      <div class="kpi-card"><span class="kpi-label">Total tokens</span><span class="kpi-value">${formatCompact(totals.tokens)}</span><span class="kpi-sub">${blocks.length} blocks</span></div>
      <div class="kpi-card"><span class="kpi-label">Active blocks</span><span class="kpi-value" style="color:var(--green)">${blocks.filter((b) => b.isActive).length}</span><span class="kpi-sub">${blocks.filter((b) => b.isGap).length} gaps</span></div>
    </div>

    <div class="card">
      <h2>Block breakdown</h2>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Block start</th>
              <th>Models</th>
              <th>Entries</th>
              <th>Total tokens</th>
              <th>Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${blocks.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No blocks data found.</td></tr>' : blocks.map((b) => {
              const pct = (b.costUSD / maxCost) * 100;
              const statusClass = b.isActive ? "status-active" : b.isGap ? "status-gap" : "";
              return `<tr>
                <td>${escapeHtml(b.startTime)}</td>
                <td style="text-align:left;font-size:11px">${escapeHtml(b.models.join(", ") || "-")}</td>
                <td>${b.entries}</td>
                <td>${formatNumber(b.totalTokens)}</td>
                <td>$${b.costUSD.toFixed(2)}<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div></td>
                <td class="${statusClass}">${b.isGap ? "gap" : b.isActive ? "active" : "complete"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <footer class="footer">Generated by usagetoken \u00b7 blocks report \u00b7 ${blocks.length} blocks</footer>
  </div>
</body>
</html>`;
}

function formatCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return trimZero((n / 1000).toFixed(1)) + "K";
  if (n < 1_000_000_000) return trimZero((n / 1_000_000).toFixed(2)) + "M";
  return trimZero((n / 1_000_000_000).toFixed(2)) + "B";
}
function trimZero(s: string): string { return s.replace(/\.?0+$/, ""); }
function formatNumber(value: number): string { return Math.round(value).toLocaleString("en-US"); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
