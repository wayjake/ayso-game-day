import { db, practices, rsvps } from "~/db";
import { and, eq, inArray } from "drizzle-orm";
import { addDays, dayOfWeek, formatGameDate, formatTimeRange } from "~/utils/dates";
export { describePractice } from "~/utils/schedule";

export const MAX_SERIES_PRACTICES = 80;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Every date from start to end (inclusive) that falls on one of the weekdays
export function seriesDates(startDate: string, endDate: string, weekdays: number[]) {
  const days = new Set(weekdays);
  const dates: string[] = [];
  for (let d = startDate; d <= endDate && dates.length <= MAX_SERIES_PRACTICES; d = addDays(d, 1)) {
    if (days.has(dayOfWeek(d))) dates.push(d);
  }
  return dates;
}

// "Tue & Thu 5:30 – 7:00 PM, Nov 24 – Dec 17"
export function describeSeries(weekdays: number[], dates: string[], startTime: string | null, endTime: string | null) {
  const days = [...weekdays].sort().map((d) => DAY_NAMES[d]).join(" & ");
  const time = formatTimeRange(startTime, endTime);
  const short = (iso: string) => formatGameDate(iso, { month: "short", day: "numeric" });
  const range = dates.length > 1 ? `${short(dates[0])} – ${short(dates[dates.length - 1])}` : short(dates[0]);
  return [days, time].filter(Boolean).join(" ") + `, ${range}`;
}

// Deletes practices and their RSVPs
export async function deletePractices(teamId: string, ids: string[]) {
  if (ids.length === 0) return;
  await db.delete(rsvps).where(and(eq(rsvps.eventType, "practice"), inArray(rsvps.eventId, ids)));
  await db.delete(practices).where(and(eq(practices.teamId, teamId), inArray(practices.id, ids)));
}
