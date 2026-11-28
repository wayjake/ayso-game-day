import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, games, tournaments, type Tournament } from "~/db";
import { isDuring, tournamentDates, type TournamentFields } from "~/utils/tournaments";

// Tournaments group a team's games into one event. Rules and words in
// utils/tournaments.ts; games point at theirs with games.tournamentId.

export async function getTournaments(teamIds: string[], { from }: { from?: string } = {}) {
  if (teamIds.length === 0) return [];
  return db
    .select()
    .from(tournaments)
    .where(and(inArray(tournaments.teamId, teamIds), from ? gte(tournaments.endDate, from) : undefined))
    .orderBy(tournaments.startDate, tournaments.id);
}

export async function getTournament(teamId: string, id: string | null) {
  if (!id) return null;
  const [row] = await db.select().from(tournaments).where(and(eq(tournaments.id, id), eq(tournaments.teamId, teamId))).limit(1);
  return row ?? null;
}

export async function tournamentGames(tournamentId: string) {
  return db.select().from(games).where(eq(games.tournamentId, tournamentId)).orderBy(games.gameDate, games.gameTime);
}

export async function createTournament(teamId: string, values: TournamentFields, by: string) {
  const [row] = await db.insert(tournaments).values({ teamId, ...values, createdBy: by }).returning();
  return row;
}

// Games that no longer fall on its days leave it
export async function updateTournament(t: Tournament, values: TournamentFields) {
  await db.update(tournaments).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(tournaments.id, t.id));
  const outside = (await tournamentGames(t.id)).filter((g) => !isDuring(values, g.gameDate)).map((g) => g.id);
  if (outside.length > 0) await db.update(games).set({ tournamentId: null }).where(inArray(games.id, outside));
  return outside.length;
}

// Its games stay on the schedule, just not grouped
export async function deleteTournament(t: Tournament) {
  await db.batch([
    db.update(games).set({ tournamentId: null }).where(eq(games.tournamentId, t.id)),
    db.delete(tournaments).where(eq(tournaments.id, t.id)),
  ]);
}

// The tournament a game form picked, checked: the team's own, and on its days
export async function checkGameTournament(teamId: string, raw: FormDataEntryValue | null, gameDate: string): Promise<{ error: string } | { tournamentId: string | null }> {
  const id = typeof raw === "string" && raw ? raw : null;
  if (!id) return { tournamentId: null };
  const t = await getTournament(teamId, id);
  if (!t) return { error: "That tournament isn't on this team." };
  if (!isDuring(t, gameDate)) return { error: `${t.name} runs ${tournamentDates(t)}, so the game needs to be on one of those days.` };
  return { tournamentId: t.id };
}

// Tournaments a game form can offer: not over yet, plus the one it's already in
export async function tournamentChoices(teamId: string, today: string, current?: string | null) {
  const rows = await db
    .select({ id: tournaments.id, name: tournaments.name, startDate: tournaments.startDate, endDate: tournaments.endDate })
    .from(tournaments)
    .where(and(eq(tournaments.teamId, teamId), current ? sql`(${tournaments.endDate} >= ${today} or ${tournaments.id} = ${current})` : gte(tournaments.endDate, today)))
    .orderBy(tournaments.startDate);
  return rows;
}
