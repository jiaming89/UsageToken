const DATE_RE = /^(\d{4})-?(\d{2})-?(\d{2})$/;

export function normalizeDateBound(value: string): string {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid date '${value}', expected YYYY-MM-DD or YYYYMMDD`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

export function formatDate(timestamp: string, timezone?: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const timeZone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dateKey(timestamp: string, timezone?: string): string {
  return formatDate(timestamp, timezone).replaceAll("-", "");
}

export function withinDateRange(timestamp: string, timezone: string | undefined, since?: string, until?: string): boolean {
  const key = dateKey(timestamp, timezone);
  return (!since || key >= since) && (!until || key <= until);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function weekStartMonday(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  const day = parsed.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  parsed.setUTCDate(parsed.getUTCDate() - mondayOffset);
  return parsed.toISOString().slice(0, 10);
}
