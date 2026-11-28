// Shared schedule types and helpers, safe for components (no server imports)

import { formatGameDate, formatTimeRange, relativeGameDay } from "~/utils/dates";

export type RsvpStatus = "yes" | "no" | "maybe";

export type ScheduleEvent = {
  key: string; // "game-<id>", "practice-<id>"
  type: "game" | "practice";
  id: string;
  teamId: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  endTime: string | null;
  title: string; // "vs Galaxy" or "Practice"
  location: string | null;
  homeAway: "home" | "away" | null;
  notes: string | null;
  cancelled: boolean;
  seriesId: string | null;
  /** Games only: the tournament it's part of */
  tournament: { id: string; name: string } | null;
};

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  yes: "Going",
  maybe: "Maybe",
  no: "Can't go",
};

export type RsvpCounts = { yes: number; no: number; maybe: number; none: number };

export function countRsvps(
  playerIds: string[],
  answers: { playerId: string; status: RsvpStatus }[]
): RsvpCounts {
  const byPlayer = new Map(answers.map((a) => [a.playerId, a.status]));
  const counts: RsvpCounts = { yes: 0, no: 0, maybe: 0, none: 0 };
  for (const id of playerIds) counts[byPlayer.get(id) ?? "none"]++;
  return counts;
}

export function isRsvpStatus(value: unknown): value is RsvpStatus {
  return value === "yes" || value === "no" || value === "maybe";
}

// "Tue, Nov 25 · 5:30 – 7:00 PM · Hart Park"
export function describePractice(p: { practiceDate: string; startTime: string | null; endTime: string | null; location: string | null }) {
  return [
    formatGameDate(p.practiceDate, { weekday: "short", month: "short", day: "numeric" }),
    formatTimeRange(p.startTime, p.endTime),
    p.location,
  ]
    .filter(Boolean)
    .join(" · ");
}

// "today", "tomorrow", or "on Tue, Nov 25", for notification text
export function eventDayPhrase(date: string) {
  const soon = relativeGameDay(date);
  if (soon === "Today" || soon === "Tomorrow") return soon.toLowerCase();
  return `on ${formatGameDate(date, { weekday: "short", month: "short", day: "numeric" })}`;
}

// "the game vs Galaxy" or "practice"
export function eventPhrase(event: { type: "game" | "practice"; title: string }) {
  return event.type === "game" ? `the game ${event.title}` : "practice";
}
