import { db, games, practices, rsvps, players } from "~/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { RsvpStatus, ScheduleEvent } from "~/utils/schedule";
import { getParentUserIds } from "~/utils/family.server";
import { sendPush } from "~/utils/push.server";

// Games and practices as one list, plus RSVPs. Types and pure helpers that
// components need live in schedule.ts.

export async function getEvents(
  teamIds: string[],
  { from, to }: { from?: string; to?: string } = {}
): Promise<ScheduleEvent[]> {
  if (teamIds.length === 0) return [];

  const gameRows = await db
    .select()
    .from(games)
    .where(and(
      inArray(games.teamId, teamIds),
      from ? gte(games.gameDate, from) : undefined,
      to ? lte(games.gameDate, to) : undefined
    ));

  const practiceRows = await db
    .select()
    .from(practices)
    .where(and(
      inArray(practices.teamId, teamIds),
      from ? gte(practices.practiceDate, from) : undefined,
      to ? lte(practices.practiceDate, to) : undefined
    ));

  const events = [...gameRows.map(gameToEvent), ...practiceRows.map(practiceToEvent)];

  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
}

function gameToEvent(g: typeof games.$inferSelect): ScheduleEvent {
  return {
    key: `game-${g.id}`,
    type: "game",
    id: g.id,
    teamId: g.teamId,
    date: g.gameDate,
    time: g.gameTime,
    endTime: null,
    title: g.opponent ? `vs ${g.opponent}` : "Game",
    location: g.field,
    homeAway: g.homeAway,
    notes: null, // Game notes were written for coaches only, so families never see them
    cancelled: g.status === "cancelled",
    seriesId: null,
  };
}

function practiceToEvent(p: typeof practices.$inferSelect): ScheduleEvent {
  return {
    key: `practice-${p.id}`,
    type: "practice",
    id: p.id,
    teamId: p.teamId,
    date: p.practiceDate,
    time: p.startTime,
    endTime: p.endTime,
    title: "Practice",
    location: p.location,
    homeAway: null,
    notes: p.notes,
    cancelled: p.status === "cancelled",
    seriesId: p.seriesId,
  };
}

// The event, if it belongs to the team
export async function getTeamEvent(teamId: string, type: string, id: string | null): Promise<ScheduleEvent | null> {
  if (!id) return null;
  if (type === "game") {
    const [g] = await db.select().from(games).where(and(eq(games.id, id), eq(games.teamId, teamId))).limit(1);
    return g ? gameToEvent(g) : null;
  }
  if (type === "practice") {
    const [p] = await db.select().from(practices).where(and(eq(practices.id, id), eq(practices.teamId, teamId))).limit(1);
    return p ? practiceToEvent(p) : null;
  }
  return null;
}

export type RsvpRow = {
  playerId: string;
  eventType: "game" | "practice";
  eventId: string;
  status: RsvpStatus;
  note: string | null;
};

export async function getRsvps(teamIds: string[], playerIds?: string[]): Promise<RsvpRow[]> {
  if (teamIds.length === 0) return [];
  return db
    .select({
      playerId: rsvps.playerId,
      eventType: rsvps.eventType,
      eventId: rsvps.eventId,
      status: rsvps.status,
      note: rsvps.note,
    })
    .from(rsvps)
    .where(and(inArray(rsvps.teamId, teamIds), playerIds ? inArray(rsvps.playerId, playerIds) : undefined));
}

export async function getEventRsvps(eventType: "game" | "practice", eventId: string) {
  return db
    .select({
      playerId: rsvps.playerId,
      status: rsvps.status,
      note: rsvps.note,
      respondedBy: rsvps.respondedBy,
      updatedAt: rsvps.updatedAt,
    })
    .from(rsvps)
    .where(and(eq(rsvps.eventType, eventType), eq(rsvps.eventId, eventId)));
}

// Upsert one player's answer. Callers check that the responder may answer for
// this player and that the event belongs to the player's team. Returns the
// previous status so callers can tell a change from a repeat.
export async function setRsvp({
  teamId,
  playerId,
  eventType,
  eventId,
  status,
  note,
  respondedBy,
}: {
  teamId: string;
  playerId: string;
  eventType: "game" | "practice";
  eventId: string;
  status: RsvpStatus | null; // null clears the answer
  note?: string | null;
  respondedBy: string;
}) {
  const [previous] = await db
    .select({ status: rsvps.status })
    .from(rsvps)
    .where(and(eq(rsvps.eventType, eventType), eq(rsvps.eventId, eventId), eq(rsvps.playerId, playerId)))
    .limit(1);

  if (status === null) {
    await db
      .delete(rsvps)
      .where(and(eq(rsvps.eventType, eventType), eq(rsvps.eventId, eventId), eq(rsvps.playerId, playerId)));
    return previous?.status ?? null;
  }

  await db
    .insert(rsvps)
    .values({ teamId, playerId, eventType, eventId, status, note: note ?? null, respondedBy })
    .onConflictDoUpdate({
      target: [rsvps.eventType, rsvps.eventId, rsvps.playerId],
      set: { status, note: note ?? null, respondedBy, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
  return previous?.status ?? null;
}

export async function getTeamPlayers(teamId: string) {
  return db
    .select({ id: players.id, name: players.name, jerseyNumber: players.jerseyNumber, profilePicture: players.profilePicture })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);
}

// Push to every linked family on the team, e.g. when the schedule changes
export async function notifyFamilies(teamId: string, payload: { title: string; body: string; tag?: string }) {
  await sendPush(await getParentUserIds(teamId), "team", { ...payload, url: "/family" });
}
