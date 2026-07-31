import type { UsageBlock } from "../core/blocks.js";
import type { ReportKind, UsageSummary } from "../types.js";

export function renderTable(kind: ReportKind, rows: UsageSummary[]): string {
  if (rows.length === 0) {
    return "No usage data found.";
  }
  const first = firstColumn(kind);
  const headers = [first, "Models", "Input", "Output", "Cache Create", "Cache Read", "Total Tokens", "Cost (USD)"];
  const data = rows.map((row) => [
    row.period,
    row.modelsUsed.join(", ") || "-",
    formatNumber(row.inputTokens),
    formatNumber(row.outputTokens),
    formatNumber(row.cacheCreationTokens),
    formatNumber(row.cacheReadTokens),
    formatNumber(totalTokens(row)),
    formatCurrency(row.totalCost)
  ]);
  const totals = rows.reduce(
    (acc, row) => {
      acc.input += row.inputTokens;
      acc.output += row.outputTokens;
      acc.cacheCreate += row.cacheCreationTokens;
      acc.cacheRead += row.cacheReadTokens;
      acc.total += totalTokens(row);
      acc.cost += row.totalCost;
      return acc;
    },
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0, cost: 0 }
  );
  data.push(["Total", "", formatNumber(totals.input), formatNumber(totals.output), formatNumber(totals.cacheCreate), formatNumber(totals.cacheRead), formatNumber(totals.total), formatCurrency(totals.cost)]);
  const widths = headers.map((header, index) => Math.max(header.length, ...data.map((row) => row[index]?.length ?? 0)));
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [line(headers), line(headers.map((_, index) => "-".repeat(widths[index] ?? 0))), ...data.map(line)].join("\n");
}

export function renderBlocksTable(blocks: UsageBlock[]): string {
  if (blocks.length === 0) {
    return "No usage data found.";
  }
  const headers = ["Block Start", "Models", "Entries", "Total Tokens", "Cost (USD)", "Status"];
  const data = blocks.map((block) => [
    block.startTime,
    block.models.join(", ") || "-",
    formatNumber(block.entries),
    formatNumber(block.totalTokens),
    formatCurrency(block.costUSD),
    block.isGap ? "gap" : block.isActive ? "active" : "complete"
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...data.map((row) => row[index]?.length ?? 0)));
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [line(headers), line(headers.map((_, index) => "-".repeat(widths[index] ?? 0))), ...data.map(line)].join("\n");
}

function firstColumn(kind: ReportKind): string {
  if (kind === "monthly") return "Month";
  if (kind === "weekly") return "Week";
  if (kind === "session") return "Session";
  return "Date";
}

function totalTokens(row: UsageSummary): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens + row.extraTotalTokens;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}
