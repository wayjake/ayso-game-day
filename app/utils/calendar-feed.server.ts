import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { calendarFeeds, db, teams } from "~/db";
import { getKids } from "~/utils/family.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { getEvents } from "~/utils/schedule.server";
import { addDays, todayISO } from "~/utils/dates";
import { addMinutes, buildCalendar, type IcalEvent } from "~/utils/ical";
import { teamPath } from "~/utils/team-path";

// A person's subscribed calendar: one private link covering every team they
// coach and every team they have kids on. Teams are worked out on each fetch,
// so someone taken off a team stops getting its events without a new link.
// Events come only from getEvents, which leaves out coach-only game notes.

// Games have no end time. Roughly an AYSO game plus halftime at each format.
const GAME_MINUTES: Record<string, number> = { "7v7": 60, "9v9": 75, "11v11": 90 };
const PRACTICE_MINUTES = 60;
// How far back the feed goes, so last weekend's game is still there
const PAST_DAYS = 60;

function newToken() {
  return randomBytes(24).toString("base64url");
}

export async function getOrCreateCalendarToken(userId: string) {
  const [row] = await db.select({ token: calendarFeeds.token }).from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).limit(1);
  if (row) return row.token;
  const token = newToken();
  // Two tabs at once: keep whichever got there first
  await db.insert(calendarFeeds).values({ userId, token }).onConflictDoNothing({ target: calendarFeeds.userId });
  const [saved] = await db.select({ token: calendarFeeds.token }).from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).limit(1);
  return saved.token;
}

/** New link; calendars subscribed to the old one stop updating */
export async function resetCalendarToken(userId: string) {
  const token = newToken();
  await db
    .insert(calendarFeeds)
    .values({ userId, token })
    .onConflictDoUpdate({ target: calendarFeeds.userId, set: { token, createdAt: sql`CURRENT_TIMESTAMP` } });
  return token;
}

function appOrigin(request: Request) {
  return process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export type CalendarLinks = { https: string; apple: string; google: string };

export function calendarLinks(request: Request, token: string): CalendarLinks {
  const https = `${appOrigin(request)}/cal/${token}.ics`;
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  return {
    https,
    // Opens the Subscribe sheet in Apple Calendar (iPhone, iPad, Mac)
    apple: webcal,
    // Google's "add by URL" page; the Android app can't subscribe by itself
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

/** The .ics text for a token, or null when the token isn't (or is no longer) valid */
export async function buildCalendarFeed(token: string, request: Request) {
  const [feed] = await db.select({ userId: calendarFeeds.userId }).from(calendarFeeds).where(eq(calendarFeeds.token, token)).limit(1);
  if (!feed) return null;

  const coachTeams = await db
    .select({ id: teams.id, code: teams.code, name: teams.name, format: teams.format })
    .from(teams)
    .where(canAccessTeam(feed.userId));
  const kids = await getKids(feed.userId);

  // Coach teams link to the RSVP page; family-only teams to the family app
  const byId = new Map<string, { name: string; format: string; code: string | null }>();
  for (const t of coachTeams) byId.set(t.id, { name: t.name, format: t.format, code: t.code });
  for (const k of kids) if (!byId.has(k.teamId)) byId.set(k.teamId, { name: k.teamName, format: k.teamFormat, code: null });

  const teamIds = [...byId.keys()];
  const events = await getEvents(teamIds, { from: addDays(todayISO(), -PAST_DAYS) });
  const origin = appOrigin(request);
  const manyTeams = teamIds.length > 1;

  const icalEvents: IcalEvent[] = events.map((event) => {
    const team = byId.get(event.teamId)!;
    const what = event.type === "game" ? (event.title === "Game" ? "Game" : `Game ${event.title}`) : "Practice";
    const summary = [event.cancelled ? "Cancelled: " : "", manyTeams ? `${team.name}: ` : "", what].join("");

    let end: string | null = null;
    if (event.time) {
      const minutes = event.type === "game" ? (GAME_MINUTES[team.format] ?? 60) : PRACTICE_MINUTES;
      end = event.endTime && event.endTime > event.time ? event.endTime : addMinutes(event.date, event.time, minutes).time;
    }

    const url = team.code ? `${origin}${teamPath(team.code, `rsvps/${event.type}/${event.id}`)}` : `${origin}/family`;
    const description = [
      event.cancelled ? "This was cancelled." : null,
      event.homeAway ? (event.homeAway === "home" ? "Home game" : "Away game") : null,
      event.time ? null : "Time to be confirmed.",
      event.notes,
      `RSVP and details: ${url}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      // Fixed domain, so moving the app never duplicates everyone's events.
      // (Ids became UUIDs in migration 0020, which re-added every event once.)
      uid: `${event.type}-${event.id}@benchtalk.app`,
      summary,
      date: event.date,
      start: event.time,
      end,
      location: event.location,
      description,
      url,
      cancelled: event.cancelled,
    };
  });

  const only = manyTeams ? null : byId.get(teamIds[0]);
  return buildCalendar({
    name: only ? `${only.name} (BenchTalk)` : "BenchTalk",
    description: "Games and practices from BenchTalk. Changes show up here on their own.",
    events: icalEvents,
  });
}
