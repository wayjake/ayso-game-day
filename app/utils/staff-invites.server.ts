import { db, teams, type User } from "~/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createInvites, inviteUrl, normalizeEmail, sendInviteEmail } from "~/utils/invites.server";
import type { StaffRole } from "~/utils/team-roles";

// Team-owner actions shared by a team's Settings page (that team only) and the
// Account page (any of the teams you own, in one go).

export type StaffInviteResult = {
  email: string;
  url: string;
  role: StaffRole;
  teamNames: string[];
  skippedTeams: string[];
  emailed: boolean;
  emailError?: string;
};

// Invites someone to the staff of the given teams. Only teams this user owns
// count; the rest are ignored. One link accepts every team in the batch.
export async function inviteStaff({
  request,
  user,
  email: rawEmail,
  role,
  teamIds,
}: {
  request: Request;
  user: Pick<User, "id" | "email" | "name">;
  email: string;
  role: StaffRole;
  teamIds: string[];
}): Promise<{ error: string } | { invite: StaffInviteResult }> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address" };
  if (email === normalizeEmail(user.email)) return { error: "That's your own email address" };

  const owned = teamIds.length
    ? await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(and(inArray(teams.id, teamIds), eq(teams.coachId, user.id)))
    : [];
  if (owned.length === 0) return { error: "Pick at least one team" };

  const { created, skippedTeamIds } = await createInvites({ email, teamIds: owned.map((t) => t.id), invitedBy: user.id, role });
  const nameFor = (id: string) => owned.find((t) => t.id === id)?.name ?? "";
  const skippedTeams = skippedTeamIds.map(nameFor);
  if (created.length === 0) {
    return { error: `${email} is already on the staff of ${skippedTeams.join(", ")}. Change their role in that team's Settings.` };
  }

  const shareCode = created[0].shareCode;
  const teamNames = created.map((c) => nameFor(c.teamId));
  const sent = await sendInviteEmail({
    request,
    to: email,
    shareCode,
    inviterName: user.name || user.email,
    inviterEmail: user.email,
    teamNames,
    role,
  });
  return {
    invite: { email, url: inviteUrl(request, shareCode), role, teamNames, skippedTeams, emailed: sent.sent, emailError: sent.error },
  };
}

// Archive or bring back a team. Archiving hides it from everyone's switcher
// and team list, so only the owner may. Returns false when they aren't.
export async function setTeamArchived(teamId: string, userId: string, archive: boolean) {
  const rows = await db
    .update(teams)
    .set({ archivedAt: archive ? new Date().toISOString() : null, archivedBy: archive ? userId : null, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(teams.id, teamId), eq(teams.coachId, userId)))
    .returning({ id: teams.id });
  return rows.length > 0;
}
