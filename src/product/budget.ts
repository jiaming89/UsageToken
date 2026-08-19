import type { BudgetAlert, BudgetSettings, BudgetStatus, DailyUserSummary } from "../types.js";

export function calculateBudgetStatus(rows: DailyUserSummary[], budget: BudgetSettings | undefined, now = new Date()): BudgetStatus {
  const month = now.toISOString().slice(0, 7);
  const monthRows = rows.filter((row) => row.date.startsWith(month));
  const previousDate = new Date(`${month}-01T00:00:00.000Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = previousDate.toISOString().slice(0, 7);
  const previousRows = rows.filter((row) => row.date.startsWith(previous));
  const cost = sum(monthRows, "totalCost");
  const tokens = sum(monthRows, "totalTokens");
  const elapsed = Math.max(1, now.getDate());
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const alerts: BudgetAlert[] = [];
  if (budget?.monthlyCostLimit) addLimitAlerts(alerts, "cost", cost, budget.monthlyCostLimit, budget.warningPercent, "$", 2);
  if (budget?.monthlyTokenLimit) addLimitAlerts(alerts, "token", tokens, budget.monthlyTokenLimit, budget.warningPercent, "", 0);
  const today = now.toISOString().slice(0, 10);
  const todayCost = monthRows.find((row) => row.date === today)?.totalCost ?? 0;
  const prior = monthRows.filter((row) => row.date < today).slice(-7);
  const average = prior.length ? sum(prior, "totalCost") / prior.length : 0;
  if (budget && prior.length > 0 && todayCost >= budget.dailyCostSpikeMinimum && todayCost >= average * budget.dailyCostSpikeMultiplier) {
    alerts.push({ key: `spike-${today}`, level: "warning", message: `今日费用 $${todayCost.toFixed(2)}，为近 7 日均值的 ${(todayCost / average).toFixed(1)} 倍。` });
  }
  return { month, cost, tokens, previousMonth: previous, previousCost: sum(previousRows, "totalCost"), previousTokens: sum(previousRows, "totalTokens"), monthlyCostLimit: budget?.monthlyCostLimit, monthlyTokenLimit: budget?.monthlyTokenLimit, projectedCost: cost / elapsed * days, projectedTokens: tokens / elapsed * days, alerts };
}

function sum(rows: DailyUserSummary[], key: "totalCost" | "totalTokens"): number { return rows.reduce((total, row) => total + row[key], 0); }
function addLimitAlerts(alerts: BudgetAlert[], name: string, value: number, limit: number, warning: number, prefix: string, digits: number): void {
  const percent = value / limit * 100;
  if (percent >= 100) alerts.push({ key: `${name}-100`, level: "error", message: `${name === "cost" ? "本月费用" : "本月 Token"} 已超预算：${prefix}${value.toFixed(digits)} / ${prefix}${limit.toFixed(digits)}。` });
  else if (percent >= warning) alerts.push({ key: `${name}-${warning}`, level: "warning", message: `${name === "cost" ? "本月费用" : "本月 Token"} 已达到 ${warning}%：${prefix}${value.toFixed(digits)} / ${prefix}${limit.toFixed(digits)}。` });
}
