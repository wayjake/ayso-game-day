import { redirect } from "react-router";
import { db, guardians, players, teams, teamMembers, users } from "~/db";
import { and, eq, inArray } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";

// Parent-side access. A user is a parent of a player when a guardians row links
// them; that's the only thing that grants it. Coach access lives in
// team-access.server.ts and is separate on purpose.

export type Kid = {
  playerId: string;
  name: string;
  jerseyNumber: number | null;
  profilePicture: string | null;
  teamId: string;
  teamCode: string; // The team's URL code (staff links)
  teamName: string;
  teamFormat: string;
};

export async function getKids(userId: string): Promise<Kid[]> {
  return db
    .select({
      playerId: players.id,
      name: players.name,
      jerseyNumber: players.jerseyNumber,
      profilePicture: players.profilePicture,
      teamId: teams.id,
      teamCode: teams.code,
      teamName: teams.name,
      teamFormat: teams.format,
    })
    .from(guardians)
    .innerJoin(players, eq(guardians.playerId, players.id))
    .innerJoin(teams, eq(players.teamId, teams.id))
    .where(eq(guardians.userId, userId))
    .orderBy(teams.name, players.name);
}

export async function isParent(userId: string) {
  const [row] = await db.select({ id: guardians.id }).from(guardians).where(eq(guardians.userId, userId)).limit(1);
  return Boolean(row);
}

// For parent routes: signed in and linked to at least one player. Anyone else
// goes to the coach dashboard.
export async function requireParent(request: Request) {
  const user = await getUser(request);
  const kids = await getKids(user.id);
  if (kids.length === 0) throw redirect("/dashboard");
  const teamIds = [...new Set(kids.map((k) => k.teamId))];
  return { user, kids, teamIds };
}

// The parent's kids on one team, or a 404 when they have none there
export async function requireParentOnTeam(request: Request, teamId: string) {
  const ctx = await requireParent(request);
  const kidsOnTeam = ctx.kids.filter((k) => k.teamId === teamId);
  if (kidsOnTeam.length === 0) throw new Response("Team not found", { status: 404 });
  return { ...ctx, kidsOnTeam };
}

// Owner plus active assistant coaches
export async function getCoachUserIds(teamId: string) {
  const [team] = await db.select({ coachId: teams.coachId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return [];
  const members = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, "active")));
  return [...new Set([team.coachId, ...members.map((m) => m.userId)])];
}

export async function getParentUserIds(teamId: string) {
  const rows = await db
    .selectDistinct({ userId: guardians.userId })
    .from(guardians)
    .where(eq(guardians.teamId, teamId));
  return rows.map((r) => r.userId);
}

// Parent user ids for specific players (e.g. to notify just those families)
export async function getParentUserIdsForPlayers(playerIds: string[]) {
  if (playerIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: guardians.userId })
    .from(guardians)
    .where(inArray(guardians.playerId, playerIds));
  return rows.map((r) => r.userId);
}

export async function getUserNames(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.name || r.email.split("@")[0]]));
}
