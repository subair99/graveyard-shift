/**
 * Time of death (requirement 6). Pure: no clock, env or random access.
 * The analysis date is always passed in by the caller.
 */

export type TimeOfDeathResult =
  | { timeOfDeath: string; daysSince: number }
  | { unavailable: true; reason: string };

export const NO_PUBLISH_DATE_REASON = "no release publish date was found";

const MS_PER_DAY = 86_400_000;

const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses an ISO 8601 timestamp with an explicit offset to epoch ms; NaN if invalid. */
function parseTimestamp(value: string): number {
  const m = ISO_8601.exec(value);
  if (m === null) return Number.NaN;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12) return Number.NaN;
  if (day < 1 || day > daysInMonth(year, month)) return Number.NaN;
  if (hour > 23 || minute > 59 || second > 59) return Number.NaN;

  let offsetMinutes = 0;
  if (zone !== undefined && zone !== "Z") {
    const oh = Number(zone.slice(1, 3));
    const om = Number(zone.slice(4, 6));
    if (oh > 23 || om > 59) return Number.NaN;
    offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (oh * 60 + om);
  }
  const millis = frac === undefined ? 0 : Math.floor(Number(`0.${frac}`) * 1000);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  return date.getTime() - offsetMinutes * 60_000;
}

/** Formats epoch ms as `YYYY-MM-DDTHH:mm:ssZ` (milliseconds truncated). */
function formatSecondPrecision(ms: number): string {
  const secondFloor = Math.floor(ms / 1000) * 1000;
  return new Date(secondFloor).toISOString().replace(".000Z", "Z");
}

export function timeOfDeath(time: Record<string, string>, analysisDate: Date): TimeOfDeathResult {
  let latest = Number.NaN;
  for (const key of Object.keys(time).sort()) {
    if (key === "created" || key === "modified") continue;
    const value = time[key];
    if (value === undefined) continue;
    const ms = parseTimestamp(value);
    if (Number.isNaN(ms)) continue;
    if (Number.isNaN(latest) || ms > latest) latest = ms;
  }
  if (Number.isNaN(latest)) {
    return { unavailable: true, reason: NO_PUBLISH_DATE_REASON };
  }
  const elapsed = analysisDate.getTime() - latest;
  return {
    timeOfDeath: formatSecondPrecision(latest),
    daysSince: Math.max(0, Math.floor(elapsed / MS_PER_DAY)),
  };
}
