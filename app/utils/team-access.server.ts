import { db, teams, teamMembers } from "~/db";
import { and, eq, inArray, or } from "drizzle-orm";

export type TeamRole = "owner" | "coach";

// Teams a user can open: ones they created, plus ones they've joined as a coach.
// Use in place of `eq(teams.coachId, userId)` in any query against `teams`.
export function canAccessTeam(userId: number) {
  return or(
    eq(teams.coachId, userId),
    inArray(
      teams.id,
      db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, "active")))
    )
  );
}

export async function getTeamForUser(teamId: number, userId: number) {
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(userId)))
    .limit(1);

  if (!team) return null;

  const role: TeamRole = team.coachId === userId ? "owner" : "coach";
  return { team, role };
}

export async function requireTeamAccess(teamId: number, userId: number) {
  const access = await getTeamForUser(teamId, userId);
  if (!access) {
    throw new Response("Team not found", { status: 404 });
  }
  return access;
}

export async function requireTeamOwner(teamId: number, userId: number) {
  const access = await requireTeamAccess(teamId, userId);
  if (access.role !== "owner") {
    throw new Response("Only the team owner can do that", { status: 403 });
  }
  return access;
}
