import crypto from "node:crypto";
import { db, contacts, guardians, parentInvites, players, teams, users } from "~/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { escapeHtml, sendEmail } from "~/utils/email.server";
import { normalizeEmail } from "~/utils/invites.server";

// Parent invites go out per family: one email address per team, covering every
// player on the team whose contacts list that address (so siblings come along).

const INVITE_TTL_DAYS = 30;

export function parentInviteUrl(request: Request, shareCode: string) {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${origin}/join/${shareCode}`;
}

const isExpired = (invite: { expiresAt: string }) => new Date(invite.expiresAt).getTime() < Date.now();

// Players on the team with a contact at this email
async function playersForEmail(teamId: number, email: string) {
  return db
    .selectDistinct({ id: players.id, name: players.name })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(eq(contacts.teamId, teamId), eq(players.teamId, teamId), sql`lower(trim(${contacts.email})) = ${email}`))
    .orderBy(players.name);
}

export type FamilyStatus = "joined" | "invited" | "expired" | "not-invited";

export type Family = {
  email: string;
  parentNames: string[];
  kids: { id: number; name: string; linked: boolean }[];
  status: FamilyStatus;
  invitedAt: string | null;
  inviteUrl: string | null;
};

// Every family on the team (grouped by contact email) with where they are in
// the invite flow. A family is "joined" once an account with that email, or
// the account that accepted their invite, is linked to one of their kids.
export async function listFamilies(request: Request, teamId: number): Promise<Family[]> {
  const rows = await db
    .select({
      email: contacts.email,
      contactName: contacts.name,
      playerId: players.id,
      playerName: players.name,
    })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(eq(contacts.teamId, teamId), eq(players.teamId, teamId)))
    .orderBy(players.name);

  const links = await db
    .select({ playerId: guardians.playerId, userId: guardians.userId, email: users.email })
    .from(guardians)
    .innerJoin(users, eq(guardians.userId, users.id))
    .where(eq(guardians.teamId, teamId));

  const invites = await db
    .select()
    .from(parentInvites)
    .where(eq(parentInvites.teamId, teamId))
    .orderBy(desc(parentInvites.createdAt), desc(parentInvites.id));

  const families = new Map<string, Family>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    let family = families.get(email);
    if (!family) {
      family = { email, parentNames: [], kids: [], status: "not-invited", invitedAt: null, inviteUrl: null };
      families.set(email, family);
    }
    if (!family.parentNames.includes(row.contactName)) family.parentNames.push(row.contactName);
    if (!family.kids.some((k) => k.id === row.playerId)) {
      family.kids.push({ id: row.playerId, name: row.playerName, linked: false });
    }
  }

  for (const family of families.values()) {
    const latest = invites.find((i) => i.email === family.email);
    const familyUserIds = new Set(
      links.filter((l) => normalizeEmail(l.email) === family.email).map((l) => l.userId)
    );
    if (latest?.status === "accepted" && latest.acceptedBy) familyUserIds.add(latest.acceptedBy);

    for (const kid of family.kids) {
      kid.linked = links.some((l) => l.playerId === kid.id && familyUserIds.has(l.userId));
    }

    if (family.kids.some((k) => k.linked)) {
      family.status = "joined";
    } else if (latest?.status === "pending") {
      family.status = isExpired(latest) ? "expired" : "invited";
      family.invitedAt = latest.createdAt;
      family.inviteUrl = isExpired(latest) ? null : parentInviteUrl(request, latest.shareCode);
    }
  }

  return [...families.values()].sort((a, b) => a.kids[0].name.localeCompare(b.kids[0].name));
}

// Links an account to every player on the team that lists this email. Returns
// the player ids newly linked.
export async function linkFamily(teamId: number, email: string, userId: number) {
  const kids = await playersForEmail(teamId, normalizeEmail(email));
  if (kids.length === 0) return [];
  const existing = await db
    .select({ playerId: guardians.playerId })
    .from(guardians)
    .where(and(eq(guardians.userId, userId), inArray(guardians.playerId, kids.map((k) => k.id))));
  const already = new Set(existing.map((e) => e.playerId));
  const toLink = kids.filter((k) => !already.has(k.id));
  if (toLink.length > 0) {
    await db
      .insert(guardians)
      .values(toLink.map((k) => ({ userId, playerId: k.id, teamId })))
      .onConflictDoNothing();
  }
  return toLink.map((k) => k.id);
}

// Invites one family. If they already have an account linked on this team,
// any kids added since are linked straight away and no email goes out.
export async function inviteFamily({
  request,
  teamId,
  email,
  invitedBy,
}: {
  request: Request;
  teamId: number;
  email: string;
  invitedBy: { id: number; name: string | null; email: string };
}): Promise<
  | { result: "linked"; linkedCount: number }
  | { result: "sent"; url: string }
  | { result: "link-only"; url: string; error?: string }
  | { result: "no-players" }
> {
  const normalized = normalizeEmail(email);
  const kids = await playersForEmail(teamId, normalized);
  if (kids.length === 0) return { result: "no-players" };

  // Already joined: link any new kids directly
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (account) {
    const [linkedHere] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(and(eq(guardians.userId, account.id), eq(guardians.teamId, teamId)))
      .limit(1);
    if (linkedHere) {
      const linked = await linkFamily(teamId, normalized, account.id);
      return { result: "linked", linkedCount: linked.length };
    }
  }

  // Only the newest link works
  await db
    .update(parentInvites)
    .set({ status: "revoked" })
    .where(and(eq(parentInvites.teamId, teamId), eq(parentInvites.email, normalized), eq(parentInvites.status, "pending")));

  const shareCode = crypto.randomBytes(24).toString("base64url");
  await db.insert(parentInvites).values({
    teamId,
    email: normalized,
    shareCode,
    invitedBy: invitedBy.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });

  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const url = parentInviteUrl(request, shareCode);
  const sent = await sendParentInviteEmail({
    to: normalized,
    url,
    teamName: team?.name ?? "your team",
    kidNames: kids.map((k) => k.name.split(" ")[0]),
    coachName: invitedBy.name || invitedBy.email,
    coachEmail: invitedBy.email,
  });

  return sent.sent ? { result: "sent", url } : { result: "link-only", url, error: sent.error };
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

async function sendParentInviteEmail({
  to,
  url,
  teamName,
  kidNames,
  coachName,
  coachEmail,
}: {
  to: string;
  url: string;
  teamName: string;
  kidNames: string[];
  coachName: string;
  coachEmail: string;
}) {
  const kids = joinNames(kidNames);
  const subject = `${teamName}: RSVPs and team messages for ${kids}`;
  const text = [
    `${coachName} added you to ${teamName} on AYSO Game Day.`,
    ``,
    `Create your account to see the schedule, RSVP ${kids} to games and practices, and message the coaches.`,
    ``,
    `Join: ${url}`,
    ``,
    `This link expires in ${INVITE_TTL_DAYS} days.`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; color: #101B2D;">
      <p>${escapeHtml(coachName)} added you to <strong>${escapeHtml(teamName)}</strong> on AYSO Game Day.</p>
      <p>Create your account to see the schedule, RSVP ${escapeHtml(kids)} to games and practices, and message the coaches.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Join the team</a>
      </p>
      <p style="color: #536175; font-size: 13px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
      <p style="color: #536175; font-size: 13px;">This link expires in ${INVITE_TTL_DAYS} days.</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text, replyTo: coachEmail });
}

export type ParentInviteState = "pending" | "accepted" | "revoked" | "expired";

export async function getParentInviteByCode(shareCode: string) {
  const [invite] = await db.select().from(parentInvites).where(eq(parentInvites.shareCode, shareCode)).limit(1);
  if (!invite) return null;

  const state: ParentInviteState = invite.status === "pending" && isExpired(invite) ? "expired" : invite.status;
  const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, invite.teamId)).limit(1);
  const [inviter] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, invite.invitedBy))
    .limit(1);
  const kids = await playersForEmail(invite.teamId, invite.email);
  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.teamId, invite.teamId), sql`lower(trim(${contacts.email})) = ${invite.email}`))
    .limit(1);

  return {
    invite,
    state,
    teamName: team?.name ?? "Team",
    coachName: inviter?.name || inviter?.email || "Your coach",
    kids,
    suggestedName: contact?.name && contact.name !== invite.email ? contact.name : "",
  };
}

export async function acceptParentInvite(shareCode: string, userId: number) {
  const found = await getParentInviteByCode(shareCode);
  if (!found || found.state !== "pending") return null;

  const linked = await linkFamily(found.invite.teamId, found.invite.email, userId);
  await db
    .update(parentInvites)
    .set({ status: "accepted", acceptedBy: userId })
    .where(eq(parentInvites.id, found.invite.id));

  return { teamId: found.invite.teamId, linkedCount: linked.length };
}
