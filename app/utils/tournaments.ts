// Tournaments: several games over one or more days, as one event. The form
// rules and words, shared by the server and the pages. Pure, unit tested.

import { addDays, formatGameDate } from "./dates.ts";

export const NAME_MAX = 100;
export const NOTES_MAX = 1000;
export const MAX_DAYS = 14;

export type TournamentFields = { name: string; startDate: string; endDate: string; location: string | null; notes: string | null };

type FormLike = { get(name: string): unknown };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function readTournamentForm(form: FormLike): { error: string } | { values: TournamentFields } {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const name = text("name").replace(/\s+/g, " ");
  const startDate = text("startDate");
  const endDate = text("endDate") || startDate;
  if (!name) return { error: "Give the tournament a name." };
  if (name.length > NAME_MAX) return { error: `Keep the name under ${NAME_MAX} characters.` };
  if (!isDate(startDate)) return { error: "Pick the first day." };
  if (!isDate(endDate)) return { error: "Pick the last day." };
  if (endDate < startDate) return { error: "The last day can't be before the first." };
  if (endDate > addDays(startDate, MAX_DAYS - 1)) return { error: `A tournament can run up to ${MAX_DAYS} days.` };
  return {
    values: {
      name,
      startDate,
      endDate,
      location: text("location").replace(/\s+/g, " ").slice(0, 200) || null,
      notes: text("notes").replace(/\r\n?/g, "\n").slice(0, NOTES_MAX) || null,
    },
  };
}

// "Sat, Dec 5" or "Sat, Dec 5 – Sun, Dec 6"
export function tournamentDates(t: { startDate: string; endDate: string }) {
  const day = (iso: string) => formatGameDate(iso, { weekday: "short", month: "short", day: "numeric" });
  return t.endDate > t.startDate ? `${day(t.startDate)} – ${day(t.endDate)}` : day(t.startDate);
}

export const isDuring = (t: { startDate: string; endDate: string }, date: string) => date >= t.startDate && date <= t.endDate;
