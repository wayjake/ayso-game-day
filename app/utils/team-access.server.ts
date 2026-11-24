import { db, teams, teamMembers, users } from "~/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { toStaffRole, type StaffRole } from "~/utils/team-roles";

// Permission level: the owner can manage staff, everyone else on staff can't.
// The staff role (coach, assistant coach, team manager) is a separate label;
// see team-roles.ts.
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

// ---------------------------------------------------------------------------
// Team staff: the owner plus active members, each with a staff role

export type StaffMember = {
  userId: number;
  memberId: number | null; // team_members row; null for an owner without one
  name: string | null;
  email: string;
  role: StaffRole;
  isOwner: boolean;
  joinedAt: string | null;
};

// Owner first, then members in the order they joined
export async function getTeamStaff(teamId: number): Promise<StaffMember[]> {
  const [team] = await db.select({ coachId: teams.coachId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return [];

  const rows = await db
    .select({
      memberId: teamMembers.id,
      userId: teamMembers.userId,
      role: teamMembers.role,
      status: teamMembers.status,
      joinedAt: teamMembers.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(teamMembers.joinedAt, teamMembers.id);

  const [owner] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, team.coachId))
    .limit(1);

  // The owner's own row only carries their role; they have access either way
  const ownerRow = rows.find((r) => r.userId === team.coachId);
  const staff: StaffMember[] = owner
    ? [{
        userId: team.coachId,
        memberId: ownerRow?.memberId ?? null,
        name: owner.name,
        email: owner.email,
        role: toStaffRole(ownerRow?.role),
        isOwner: true,
        joinedAt: null,
      }]
    : [];

  for (const r of rows) {
    if (r.userId === team.coachId || r.status !== "active") continue;
    staff.push({ userId: r.userId, memberId: r.memberId, name: r.name, email: r.email, role: toStaffRole(r.role), isOwner: false, joinedAt: r.joinedAt });
  }
  return staff;
}

export async function getStaffRoles(teamId: number) {
  return new Map((await getTeamStaff(teamId)).map((s) => [s.userId, s.role]));
}

// Gives a user a staff role on the team, which grants coach access. Also used
// to change the role of someone already on staff, the owner included.
export async function setStaffRole(teamId: number, userId: number, role: StaffRole, invitedBy?: number) {
  const now = new Date().toISOString();
  const [existing] = await db
    .select({ id: teamMembers.id, status: teamMembers.status, joinedAt: teamMembers.joinedAt })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  if (existing) {
    const rejoining = existing.status !== "active";
    await db
      .update(teamMembers)
      .set({ role, status: "active", ...(rejoining || !existing.joinedAt ? { joinedAt: now } : {}), updatedAt: now })
      .where(eq(teamMembers.id, existing.id));
  } else {
    await db.insert(teamMembers).values({ teamId, userId, role, invitedBy, joinedAt: now });
  }
}

// Takes coach access away. Parents keep their family access, which comes
// from guardians rows. The owner can't be removed.
export async function removeFromStaff(teamId: number, userId: number) {
  const [team] = await db.select({ coachId: teams.coachId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.coachId === userId) return false;
  await db
    .update(teamMembers)
    .set({ status: "removed", updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return true;
}
