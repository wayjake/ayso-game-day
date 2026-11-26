import crypto from "node:crypto";
import { db, contacts, guardians, parentInvites, players, teamInvites, teams, users } from "~/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { escapeHtml, familyDeliveryAddress, sendEmail } from "~/utils/email.server";
import { getTeamStaff } from "~/utils/team-access.server";
import { staffRoleLabel, type StaffRole } from "~/utils/team-roles";
import { inviteUrl as staffInviteUrl, normalizeEmail } from "~/utils/invites.server";
import { claimFamilyConversation } from "~/utils/messages.server";

// Parent invites go out per family: one email address per team, covering every
// player on the team whose contacts list that address (so siblings come along).

const INVITE_TTL_DAYS = 30;

export function parentInviteUrl(request: Request, shareCode: string) {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${origin}/join/${shareCode}`;
}

const isExpired = (invite: { expiresAt: string }) => new Date(invite.expiresAt).getTime() < Date.now();

// Players on the team with a contact at this email
async function playersForEmail(teamId: string, email: string) {
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
  kids: { id: string; name: string; linked: boolean }[];
  status: FamilyStatus;
  invitedAt: string | null;
  inviteUrl: string | null;
  // Set when the invite they're waiting on is a coach invite (a parent given a
  // staff role before joining). Accepting it links them to their kids too, so
  // it counts as their invite: inviting them again as a parent would send a
  // second email.
  staffInvite: StaffRole | null;
  userIds: string[]; // Parent accounts that belong to this family email
};

// Every family on the team (grouped by contact email) with where they are in
// the invite flow. A family is "joined" once an account with that email, or
// the account that accepted their invite, is linked to one of their kids.
export async function listFamilies(request: Request | null, teamId: string): Promise<Family[]> {
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

  const coachInvites = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.status, "pending")))
    .orderBy(desc(teamInvites.createdAt), desc(teamInvites.id));

  const families = new Map<string, Family>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    let family = families.get(email);
    if (!family) {
      family = { email, parentNames: [], kids: [], status: "not-invited", invitedAt: null, inviteUrl: null, staffInvite: null, userIds: [] };
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
    family.userIds = [...familyUserIds];

    for (const kid of family.kids) {
      kid.linked = links.some((l) => l.playerId === kid.id && familyUserIds.has(l.userId));
    }

    if (family.kids.some((k) => k.linked)) {
      family.status = "joined";
      continue;
    }
    // Whichever invite went out last is the one they're waiting on
    const parent = latest?.status === "pending" ? latest : null;
    const coach = coachInvites.find((i) => i.email === family.email && i.shareCode) ?? null;
    if (coach && (!parent || coach.createdAt >= parent.createdAt)) {
      family.status = isExpired(coach) ? "expired" : "invited";
      family.invitedAt = coach.createdAt;
      family.inviteUrl = isExpired(coach) || !request ? null : staffInviteUrl(request, coach.shareCode!);
      family.staffInvite = coach.role;
    } else if (parent) {
      family.status = isExpired(parent) ? "expired" : "invited";
      family.invitedAt = parent.createdAt;
      family.inviteUrl = isExpired(parent) || !request ? null : parentInviteUrl(request, parent.shareCode);
    }
  }

  return [...families.values()].sort((a, b) => a.kids[0].name.localeCompare(b.kids[0].name));
}

// Links an account to every player on the team that lists this email. Returns
// the player ids newly linked.
export async function linkFamily(teamId: string, email: string, userId: string) {
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
  // Callers have proven this email (invite link or magic link), so any thread
  // the coaches already had with it by email becomes this account's
  await claimFamilyConversation(teamId, normalizeEmail(email), userId);
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
  teamId: string;
  email: string;
  invitedBy: { id: string; name: string | null; email: string };
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

  const [team] = await db
    .select({ name: teams.name, ageGroup: teams.ageGroup, format: teams.format, season: teams.season, region: teams.region })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const url = parentInviteUrl(request, shareCode);
  const sent = await sendParentInviteEmail({
    // Outside production this goes to the coach instead, like all family mail
    to: familyDeliveryAddress(normalized, invitedBy.email),
    url,
    team: team ?? { name: "your team", ageGroup: null, format: null, season: null, region: null },
    staff: (await getTeamStaff(teamId)).map((s) => ({ name: s.name || s.email, role: s.role })),
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

type InviteTeam = { name: string; ageGroup: string | null; format: string | null; season: string | null; region: string | null };

// The invite is often a family's first contact with BenchTalk, so it says what
// the app is, which team and coaches it's for, and how to put it on a phone.
async function sendParentInviteEmail({ to, coachEmail, ...content }: Parameters<typeof parentInviteEmail>[0] & { to: string }) {
  const { subject, html, text } = parentInviteEmail({ coachEmail, ...content });
  return sendEmail({ to, subject, html, text, replyTo: coachEmail });
}

export function parentInviteEmail({
  url,
  team,
  staff,
  kidNames,
  coachName,
  coachEmail,
}: {
  url: string;
  team: InviteTeam;
  staff: { name: string; role: StaffRole }[];
  kidNames: string[];
  coachName: string;
  coachEmail: string;
}) {
  const kids = joinNames(kidNames);
  const headCoach = staff.find((s) => s.role === "coach")?.name ?? coachName;
  const otherStaff = staff.filter((s) => s.name !== headCoach);
  const details = [
    [team.ageGroup, team.format].filter(Boolean).join(", "),
    team.season,
    team.region ? `Region ${team.region.replace(/^region\s*/i, "")}` : null,
  ].filter(Boolean) as string[];
  const features = [
    "The game and practice schedule, with times and fields",
    `RSVP ${kids} to each game and practice in one tap`,
    "Team chat, announcements and a private thread with the coaches",
    "Team photos and videos",
  ];
  const iphone = ["Open the link in Safari", "Tap the Share button, then Add to Home Screen", "Open BenchTalk from your Home Screen and turn on notifications"];
  const android = ["Open the link in Chrome", "Tap the menu (three dots), then Install app or Add to Home screen", "Open BenchTalk from your home screen and allow notifications"];

  const subject = `${coachName} invited you to ${team.name} on BenchTalk`;
  const text = [
    `${coachName} invited you to join ${team.name} on BenchTalk as ${kids}'s family.`,
    ``,
    `THE TEAM`,
    team.name,
    ...details,
    `Head coach: ${headCoach}`,
    ...otherStaff.map((s) => `${staffRoleLabel(s.role)}: ${s.name}`),
    ``,
    `WHAT IS BENCHTALK?`,
    `BenchTalk is the app your team uses to stay organized. It's free, and there's nothing to download from an app store. In it you'll find:`,
    ...features.map((f) => `- ${f}`),
    ``,
    `Join the team: ${url}`,
    ``,
    `PUT IT ON YOUR PHONE`,
    `After you join, add BenchTalk to your home screen so it opens like an app and can send you notifications (like schedule changes).`,
    `iPhone:`,
    ...iphone.map((step, i) => `${i + 1}. ${step}`),
    `Android:`,
    ...android.map((step, i) => `${i + 1}. ${step}`),
    ``,
    `This link expires in ${INVITE_TTL_DAYS} days. Questions? Just reply to this email to reach ${coachName}.`,
  ].join("\n");

  const muted = "color: #536175;";
  const h2 = "margin: 28px 0 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #536175;";
  const list = (items: string[], ordered = false) =>
    `<${ordered ? "ol" : "ul"} style="margin: 0; padding-left: 20px;">${items.map((i) => `<li style="margin: 4px 0;">${escapeHtml(i)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; color: #101B2D; font-size: 15px; line-height: 1.5;">
      <p style="margin: 0 0 16px;">${escapeHtml(coachName)} invited you to join <strong>${escapeHtml(team.name)}</strong> on BenchTalk as ${escapeHtml(kids)}'s family.</p>

      <div style="border: 1px solid #E3E8EF; border-radius: 12px; padding: 16px 18px;">
        <div style="font-size: 18px; font-weight: 700;">${escapeHtml(team.name)}</div>
        ${details.length ? `<div style="${muted} font-size: 14px;">${details.map(escapeHtml).join(" &middot; ")}</div>` : ""}
        <div style="margin-top: 10px; font-size: 14px;">
          <div><span style="${muted}">Head coach:</span> <strong>${escapeHtml(headCoach)}</strong></div>
          ${otherStaff.map((s) => `<div><span style="${muted}">${escapeHtml(staffRoleLabel(s.role))}:</span> ${escapeHtml(s.name)}</div>`).join("")}
        </div>
      </div>

      <h2 style="${h2}">What is BenchTalk?</h2>
      <p style="margin: 0 0 8px;">BenchTalk is the app your team uses to stay organized. It's free, and there's nothing to download from an app store. In it you'll find:</p>
      ${list(features)}

      <p style="margin: 28px 0;">
        <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Join the team</a>
      </p>

      <h2 style="${h2}">Put it on your phone</h2>
      <p style="margin: 0 0 12px;">After you join, add BenchTalk to your home screen so it opens like an app and can send you notifications (like schedule changes).</p>
      <p style="margin: 0 0 4px; font-weight: 600;">iPhone</p>
      ${list(iphone, true)}
      <p style="margin: 12px 0 4px; font-weight: 600;">Android</p>
      ${list(android, true)}

      <p style="${muted} font-size: 13px; margin-top: 28px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
      <p style="${muted} font-size: 13px;">This link expires in ${INVITE_TTL_DAYS} days. Questions? Reply to this email to reach ${escapeHtml(coachName)}.</p>
    </div>
  `;

  return { subject, html, text };
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

export async function acceptParentInvite(shareCode: string, userId: string) {
  const found = await getParentInviteByCode(shareCode);
  if (!found || found.state !== "pending") return null;

  const linked = await linkFamily(found.invite.teamId, found.invite.email, userId);
  await db
    .update(parentInvites)
    .set({ status: "accepted", acceptedBy: userId })
    .where(eq(parentInvites.id, found.invite.id));

  return { teamId: found.invite.teamId, linkedCount: linked.length };
}
