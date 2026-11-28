// A small iCalendar (RFC 5545) writer for the subscribed calendar feed. Pure,
// no dependencies. Dates and times come in the way the app stores them
// ("YYYY-MM-DD" and "HH:MM", wall-clock time in APP_TIME_ZONE) and go out with
// that zone's TZID, so calendar apps handle daylight saving themselves.

import { addDays, APP_TIME_ZONE } from "./dates.ts";

export type IcalEvent = {
  uid: string;
  summary: string;
  date: string; // YYYY-MM-DD
  /** HH:MM start; without one the event is all day */
  start: string | null;
  /** HH:MM end; required when start is given */
  end: string | null;
  /** All-day events only: the last day, for one that runs several days */
  endDate?: string | null;
  /** Shown as busy or free. Defaults: timed events busy, all-day ones free */
  busy?: boolean;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
};

export type IcalCalendar = {
  name: string;
  description?: string;
  events: IcalEvent[];
  /** Defaults to the current time; pass one to make the output repeatable in tests */
  now?: Date;
};

// The definition of APP_TIME_ZONE that goes in the file. Calendar apps know
// the zone by name anyway, but the spec wants it spelled out.
const VTIMEZONES: Record<string, string[]> = {
  "America/Los_Angeles": [
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "X-LIC-LOCATION:America/Los_Angeles",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ],
};

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds a content line at 75 bytes (not characters), never inside a multi-byte character */
export function foldLine(line: string) {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const compactTime = (hhmm: string) => `${hhmm.slice(0, 2)}${hhmm.slice(3, 5)}00`;

function utcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "09:30" + 90 -> { date, time } on the right day */
export function addMinutes(date: string, time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  return {
    date: dayShift ? addDays(date, dayShift) : date,
    time: `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`,
  };
}

export function buildCalendar({ name, description, events, now = new Date() }: IcalCalendar) {
  const tz = APP_TIME_ZONE;
  const stamp = utcStamp(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BenchTalk//Team schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    ...(description ? [`X-WR-CALDESC:${escapeText(description)}`] : []),
    `X-WR-TIMEZONE:${tz}`,
    // Hints only: Apple mostly follows them, Google refreshes on its own clock
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...(VTIMEZONES[tz] ?? []),
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp}`);
    if (event.start && event.end) {
      // An end at or before the start (a typo, or past midnight) rolls to the next day
      const endDate = event.end > event.start ? event.date : addDays(event.date, 1);
      lines.push(
        `DTSTART;TZID=${tz}:${compactDate(event.date)}T${compactTime(event.start)}`,
        `DTEND;TZID=${tz}:${compactDate(endDate)}T${compactTime(event.end)}`,
        // Said outright, since a game should block its time even next to a free all-day tournament
        event.busy === false ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE",
      );
    } else {
      // DTEND is the day after the last one (exclusive)
      const last = event.endDate && event.endDate > event.date ? event.endDate : event.date;
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
        `DTEND;VALUE=DATE:${compactDate(addDays(last, 1))}`,
        // All-day events (a tournament weekend, a game with no time yet) shouldn't block the day as busy
        event.busy === true ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT",
      );
    }
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL;VALUE=URI:${event.url}`);
    lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
