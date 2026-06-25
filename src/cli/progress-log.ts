import type { ProgressEvent, ProgressFieldValue } from "../lib/progress";

export function printCliProgress(event: ProgressEvent): void {
  const fields = formatFields(event.fields);
  console.error(`[post-foundry] ${new Date().toISOString()} ${event.event}${fields ? " " + fields : ""}`);
}

function formatFields(fields: Record<string, ProgressFieldValue | undefined> | undefined): string {
  if (!fields) {
    return "";
  }
  return Object.entries(fields)
    .filter((entry): entry is [string, ProgressFieldValue] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
}

function formatValue(value: ProgressFieldValue): string {
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}
