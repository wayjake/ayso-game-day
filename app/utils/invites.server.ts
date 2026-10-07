import crypto from "node:crypto";
import { db, teams, teamInvites, teamMembers, users } from "~/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { escapeHtml, sendEmail } from "~/utils/email.server";

const INVITE_TTL_DAYS = 14;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function inviteUrl(request: Request, shareCode: string) {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${origin}/invite/${shareCode}`;
}

function isExpired(invite: { expiresAt: string }) {
  return new Date(invite.expiresAt).getTime() < Date.now();
}

// Creates one pending invite per team. Any earlier pending invite for the same
// email and team is revoked so only the newest link works. Teams the person
// already coaches are skipped.
export async function createInvites({
  email,
  teamIds,
  invitedBy,
}: {
  email: string;
  teamIds: number[];
  invitedBy: number;
}) {
  const normalized = normalizeEmail(email);
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);

  const created: { teamId: number; shareCode: string }[] = [];
  const skippedTeamIds: number[] = [];
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const teamId of teamIds) {
    if (existingUser) {
      const [team] = await db
        .select({ coachId: teams.coachId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      const [membership] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, existingUser.id),
          eq(teamMembers.status, "active")
        ))
        .limit(1);

      if (team?.coachId === existingUser.id || membership) {
        skippedTeamIds.push(teamId);
        continue;
      }
    }

    await db
      .update(teamInvites)
      .set({ status: "revoked" })
      .where(and(
        eq(teamInvites.teamId, teamId),
        eq(teamInvites.email, normalized),
        eq(teamInvites.status, "pending")
      ));

    const shareCode = crypto.randomBytes(24).toString("base64url");
    await db.insert(teamInvites).values({
      teamId,
      email: normalized,
      shareCode,
      role: "coach",
      invitedBy,
      expiresAt,
    });
    created.push({ teamId, shareCode });
  }

  return { created, skippedTeamIds };
}

export async function sendInviteEmail({
  request,
  to,
  shareCode,
  inviterName,
  inviterEmail,
  teamNames,
}: {
  request: Request;
  to: string;
  shareCode: string;
  inviterName: string;
  inviterEmail: string;
  teamNames: string[];
}) {
  const url = inviteUrl(request, shareCode);
  const teamList = teamNames.join(", ");
  const subject = `${inviterName} invited you to coach ${teamNames.length === 1 ? teamNames[0] : "their teams"} on AYSO Game Day`;

  const text = [
    `${inviterName} invited you to help coach on AYSO Game Day.`,
    ``,
    `Team${teamNames.length === 1 ? "" : "s"}: ${teamList}`,
    ``,
    `You'll be able to plan lineups, manage the roster, and edit games.`,
    ``,
    `Accept the invite: ${url}`,
    ``,
    `This link expires in ${INVITE_TTL_DAYS} days.`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; color: #0f172a;">
      <p>${escapeHtml(inviterName)} invited you to help coach on AYSO Game Day.</p>
      <p><strong>Team${teamNames.length === 1 ? "" : "s"}:</strong> ${escapeHtml(teamList)}</p>
      <p>You'll be able to plan lineups, manage the roster, and edit games.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Accept invite</a>
      </p>
      <p style="color: #64748b; font-size: 13px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
      <p style="color: #64748b; font-size: 13px;">This link expires in ${INVITE_TTL_DAYS} days.</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text, replyTo: inviterEmail });
}

export type InviteState = "pending" | "accepted" | "revoked" | "expired";

// Looks up an invite plus every other team invited under the same email, since
// one link accepts all of them.
export async function getInviteByCode(shareCode: string) {
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.shareCode, shareCode))
    .limit(1);

  if (!invite || !invite.email) return null;

  const state: InviteState =
    invite.status === "pending" && isExpired(invite) ? "expired" : invite.status;

  const pendingForEmail = await db
    .select({ id: teamInvites.id, teamId: teamInvites.teamId, teamName: teams.name, expiresAt: teamInvites.expiresAt })
    .from(teamInvites)
    .innerJoin(teams, eq(teamInvites.teamId, teams.id))
    .where(and(eq(teamInvites.email, invite.email), eq(teamInvites.status, "pending")));

  const [inviter] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, invite.invitedBy))
    .limit(1);

  return {
    invite,
    state,
    inviterName: inviter?.name || inviter?.email || "A coach",
    teams: pendingForEmail.filter((row) => !isExpired(row)),
  };
}

// Accepts the invite behind this code and every other pending, unexpired invite
// sent to the same email address. Returns the team ids joined.
export async function acceptInvites(shareCode: string, userId: number) {
  const found = await getInviteByCode(shareCode);
  if (!found || found.state !== "pending") return [];

  const teamIds = [...new Set(found.teams.map((row) => row.teamId))];
  const now = new Date().toISOString();

  for (const teamId of teamIds) {
    const [team] = await db
      .select({ coachId: teams.coachId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team || team.coachId === userId) continue;

    const [existing] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .limit(1);

    if (existing) {
      await db
        .update(teamMembers)
        .set({ status: "active", role: "coach", joinedAt: now, updatedAt: now })
        .where(eq(teamMembers.id, existing.id));
    } else {
      await db.insert(teamMembers).values({
        teamId,
        userId,
        role: "coach",
        invitedBy: found.invite.invitedBy,
        joinedAt: now,
      });
    }
  }

  await db
    .update(teamInvites)
    .set({ status: "accepted" })
    .where(inArray(teamInvites.id, found.teams.map((row) => row.id)));

  return teamIds;
}
