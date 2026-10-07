// Game dates are stored as "YYYY-MM-DD" and times as "HH:MM" (24h), with no
// time zone. `new Date("2026-10-10")` reads that as midnight UTC, which is
// still the 9th anywhere in the US, so never parse them with Date directly.
// Everything here formats in UTC on purpose: the server (UTC) and the browser
// then render the same text, so there's no shift and no hydration mismatch.

// The teams using this are in California. "Today" has to be pinned to a zone
// because the server runs in UTC, where today ends at 5 PM Pacific.
export const APP_TIME_ZONE = "America/Los_Angeles";

export function parseISODate(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function toISODate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoToUTCDate(iso: string) {
  const parts = parseISODate(iso);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null;
}

// "2026-10-10" -> "Sat, Oct 10, 2026"
export function formatGameDate(
  iso: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }
) {
  const date = isoToUTCDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
}

// "09:20" -> "9:20 AM"
export function formatGameTime(time: string | null | undefined) {
  if (!time) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

// "Sat, Oct 10, 2026 at 9:20 AM", or just the date when there's no time
export function formatGameDateTime(iso: string, time?: string | null) {
  const date = formatGameDate(iso);
  return time ? `${date} at ${formatGameTime(time)}` : date;
}

// Today's date in the app's time zone, as "YYYY-MM-DD"
export function todayISO(timeZone = APP_TIME_ZONE) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Adds days to a "YYYY-MM-DD" date
export function addDays(iso: string, days: number) {
  const date = isoToUTCDate(iso)!;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek(iso: string) {
  return isoToUTCDate(iso)!.getUTCDay();
}
