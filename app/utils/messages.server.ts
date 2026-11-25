import crypto from "node:crypto";
import {
  db,
  announcementRecipients,
  announcements,
  contacts,
  conversationMembers,
  conversations,
  conversationReads,
  guardians,
  inboundEmails,
  messageReactions,
  messages,
  players,
  pushSubscriptions,
  teams,
  users,
} from "~/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canAccessTeam, getTeamForUser } from "~/utils/team-access.server";
import { getCoachUserIds, getParentUserIds } from "~/utils/family.server";
import { getStaffRoles, getTeamStaff } from "~/utils/team-access.server";
import type { StaffRole } from "~/utils/team-roles";
import type { GroupMember } from "~/utils/groups";
import { sendPush } from "~/utils/push.server";
import { isReaction } from "~/utils/reactions";
import { publishConversation } from "~/utils/realtime.server";
import { coachFromAddress, familyDeliveryAddress, sendEmail, textToHtml, escapeHtml } from "~/utils/email.server";

// Three kinds of conversation per team:
//   team   - every staff member and every linked parent
//   direct - one-to-one: one staff member (staffUserId) and one family. Only
//            those two can read it. Other staff, the team owner included, can't.
//   group  - only its members (conversationMembers), staff or families, started
//            by anyone on the team. Nobody else can read it, the owner included.
//            Never emailed; families not on the app see it once they join.
//            Starting, naming and membership live in groups.server.ts.
//
// The family side of a direct thread is a parent account (parentUserId), a
// family email (familyEmail), or both. Families who aren't on the app yet have
// email-only threads: announcements and staff replies reach them by email, and
// their email replies land here. When they join with a proven email those
// threads become their account's (claimFamilyConversation).

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_EMAIL_MESSAGE_LENGTH = 10000;

const lower = (email: string) => email.trim().toLowerCase();

export async function getOrCreateTeamConversation(teamId: number) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "team")))
    .limit(1);
  if (existing) return existing;
  // The partial unique index makes a racing second insert a no-op
  await db.insert(conversations).values({ teamId, kind: "team" }).onConflictDoNothing();
  const [created] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "team")))
    .limit(1);
  return created;
}

// Every lookup and insert of a direct thread names its staff member. Without
// that, the insert-or-reselect below would land one coach in another's thread.
export async function getOrCreateDirectConversation(teamId: number, parentUserId: number, staffUserId: number) {
  const where = and(
    eq(conversations.teamId, teamId),
    eq(conversations.kind, "direct"),
    eq(conversations.staffUserId, staffUserId),
    eq(conversations.parentUserId, parentUserId)
  );
  const [existing] = await db.select().from(conversations).where(where).limit(1);
  if (existing) return existing;
  await db.insert(conversations).values({ teamId, kind: "direct", staffUserId, parentUserId }).onConflictDoNothing();
  const [created] = await db.select().from(conversations).where(where).limit(1);
  if (!created) throw new Error(`Couldn't create the direct thread for team ${teamId}`);
  return created;
}

async function findFamilyEmailConversation(teamId: number, familyEmail: string, staffUserId: number) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.teamId, teamId),
        eq(conversations.kind, "direct"),
        eq(conversations.staffUserId, staffUserId),
        eq(conversations.familyEmail, familyEmail)
      )
    )
    .limit(1);
  return row ?? null;
}

// Moves everything from one direct thread into another and deletes the first.
// Both must be with the same staff member.
async function mergeConversation(from: typeof conversations.$inferSelect, into: typeof conversations.$inferSelect) {
  if (from.staffUserId !== into.staffUserId) throw new Error("Can't merge threads with different staff members");
  await db.update(messages).set({ conversationId: into.id }).where(eq(messages.conversationId, from.id));
  await db.update(announcementRecipients).set({ conversationId: into.id }).where(eq(announcementRecipients.conversationId, from.id));
  await db.update(inboundEmails).set({ conversationId: into.id }).where(eq(inboundEmails.conversationId, from.id));
  await db.delete(conversationReads).where(eq(conversationReads.conversationId, from.id));
  await db.delete(conversations).where(eq(conversations.id, from.id));

  const [last] = await db
    .select({ createdAt: messages.createdAt, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, into.id))
    .orderBy(desc(messages.id))
    .limit(1);
  await db
    .update(conversations)
    .set({
      familyEmail: into.familyEmail ?? from.familyEmail,
      needsReply: into.needsReply || from.needsReply,
      lastMessageAt: last?.createdAt ?? into.lastMessageAt,
      lastMessagePreview: last ? preview(last.body) : into.lastMessagePreview,
    })
    .where(eq(conversations.id, into.id));
}

// A staff member's direct thread with a family on a team, by email and (if
// they're on the app) account. Creates it if needed and keeps the two keys in step.
export async function getOrCreateFamilyConversation(
  teamId: number,
  rawEmail: string,
  parentUserId: number | null | undefined,
  staffUserId: number
) {
  const familyEmail = lower(rawEmail);
  const byEmail = await findFamilyEmailConversation(teamId, familyEmail, staffUserId);

  if (parentUserId) {
    if (byEmail?.parentUserId === parentUserId) return byEmail;
    const byUser = await getOrCreateDirectConversation(teamId, parentUserId, staffUserId);
    if (byEmail && byEmail.id !== byUser.id) {
      if (byEmail.parentUserId) return byEmail; // Another account already holds this email's thread
      await mergeConversation(byEmail, byUser);
    }
    if (!byUser.familyEmail) {
      await db.update(conversations).set({ familyEmail }).where(eq(conversations.id, byUser.id));
    }
    const [fresh] = await db.select().from(conversations).where(eq(conversations.id, byUser.id)).limit(1);
    return fresh;
  }

  if (byEmail) return byEmail;
  await db.insert(conversations).values({ teamId, kind: "direct", staffUserId, familyEmail }).onConflictDoNothing();
  const created = await findFamilyEmailConversation(teamId, familyEmail, staffUserId);
  if (!created) throw new Error(`Couldn't create the direct thread for team ${teamId}`);
  return created;
}

// After a parent proves an email (invite or magic link), the email-only threads
// for it (one per staff member who wrote to it) become theirs. Never called on
// a bare users.email match.
export async function claimFamilyConversation(teamId: number, rawEmail: string, userId: number) {
  const familyEmail = lower(rawEmail);
  const unclaimed = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.teamId, teamId),
        eq(conversations.kind, "direct"),
        eq(conversations.familyEmail, familyEmail),
        isNull(conversations.parentUserId)
      )
    );
  for (const byEmail of unclaimed) {
    if (!byEmail.staffUserId) continue;
    const [byUser] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.teamId, teamId),
          eq(conversations.kind, "direct"),
          eq(conversations.staffUserId, byEmail.staffUserId),
          eq(conversations.parentUserId, userId)
        )
      )
      .limit(1);
    if (byUser) {
      await mergeConversation(byEmail, byUser);
    } else {
      await db.update(conversations).set({ parentUserId: userId }).where(eq(conversations.id, byEmail.id));
    }
  }
  await claimGroupMemberships(teamId, familyEmail, userId);
}

// Groups this family was added to before they were on the app become theirs.
// Where the account is already a member, the email-only row just goes.
async function claimGroupMemberships(teamId: number, familyEmail: string, userId: number) {
  const pending = await db
    .select({ id: conversationMembers.id, conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversations.teamId, teamId), eq(conversationMembers.familyEmail, familyEmail), isNull(conversationMembers.userId)));
  for (const row of pending) {
    const [already] = await db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, row.conversationId), eq(conversationMembers.userId, userId)))
      .limit(1);
    if (already) await db.delete(conversationMembers).where(eq(conversationMembers.id, row.id));
    else await db.update(conversationMembers).set({ userId }).where(eq(conversationMembers.id, row.id));
  }
}

async function isGuardianOnTeam(userId: number, teamId: number) {
  const [row] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(and(eq(guardians.userId, userId), eq(guardians.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

// Which side of the team someone is on right now: staff wins over parent
async function teamSide(teamId: number, userId: number) {
  if (await getTeamForUser(teamId, userId)) return "coach" as const;
  if (await isGuardianOnTeam(userId, teamId)) return "parent" as const;
  return null;
}

/** A group's member accounts who are still on its team: the people who can read it */
export async function activeGroupMemberIds(conversation: { id: number; teamId: number }) {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversation.id), sql`${conversationMembers.userId} is not null`))
    .orderBy(conversationMembers.id);
  if (rows.length === 0) return [];
  const [staff, parents] = await Promise.all([getCoachUserIds(conversation.teamId), getParentUserIds(conversation.teamId)]);
  const onTeam = new Set([...staff, ...parents]);
  return rows.map((r) => r.userId!).filter((id) => onTeam.has(id));
}

/** Group ids on these teams that list this account as a member (callers pass teams they're on) */
export async function groupIdsFor(userId: number, teamIds: number[]) {
  if (teamIds.length === 0) return [];
  const rows = await db
    .select({ id: conversations.id })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversationMembers.userId, userId), eq(conversations.kind, "group"), inArray(conversations.teamId, teamIds)));
  return rows.map((r) => r.id);
}

// Everyone who can read this conversation right now. Pushes go only to them,
// so a removed member or a family that left the team hears nothing more.
export async function conversationReaderIds(conversation: typeof conversations.$inferSelect) {
  if (conversation.kind === "group") return activeGroupMemberIds(conversation);
  const [staff, parents] = await Promise.all([getCoachUserIds(conversation.teamId), getParentUserIds(conversation.teamId)]);
  if (conversation.kind === "team") return [...new Set([...staff, ...parents])];
  return [
    ...(conversation.staffUserId != null && staff.includes(conversation.staffUserId) ? [conversation.staffUserId] : []),
    ...(conversation.parentUserId != null && parents.includes(conversation.parentUserId) ? [conversation.parentUserId] : []),
  ];
}

// Who may read and post here, and as what. The team chat: all staff and the
// team's parents. A group: its members while they're on the team (staff see it
// in the dashboard, parents in the family app). A direct thread: its staff member, while they're still on
// the team staff, and its parent. Nobody else, other staff and the owner
// included. An email-only thread (no parentUserId) is its staff member's only.
// `canPost` is false for a parent whose staff member has left the team: they
// keep the history but can't write into a thread nobody reads.
export async function getConversationAccess(conversationId: number, userId: number) {
  if (!Number.isInteger(conversationId)) return null;
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return null;
  const onStaff = (id: number | null) => (id == null ? Promise.resolve(false) : getTeamForUser(conversation.teamId, id).then(Boolean));

  if (conversation.kind === "group") {
    const [member] = await db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, userId)))
      .limit(1);
    if (!member) return null;
    const side = await teamSide(conversation.teamId, userId);
    return side ? { conversation, viewer: side, canPost: true } : null;
  }

  if (conversation.kind === "team") {
    if (await onStaff(userId)) return { conversation, viewer: "coach" as const, canPost: true };
    return (await isGuardianOnTeam(userId, conversation.teamId))
      ? { conversation, viewer: "parent" as const, canPost: true }
      : null;
  }

  if (conversation.staffUserId === userId && (await onStaff(userId))) {
    return { conversation, viewer: "coach" as const, canPost: true };
  }
  if (conversation.parentUserId === userId && (await isGuardianOnTeam(userId, conversation.teamId))) {
    return { conversation, viewer: "parent" as const, canPost: await onStaff(conversation.staffUserId) };
  }
  return null;
}

/** Direct threads a staff member is in, on one team */
function staffDirects(teamId: number, staffUserId: number) {
  return and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.staffUserId, staffUserId));
}

async function unreadCounts(conversationIds: number[], userId: number) {
  if (conversationIds.length === 0) return new Map<number, number>();
  const rows = await db
    .select({ conversationId: messages.conversationId, count: sql<number>`count(*)` })
    .from(messages)
    .leftJoin(
      conversationReads,
      and(eq(conversationReads.conversationId, messages.conversationId), eq(conversationReads.userId, userId))
    )
    .where(and(
      inArray(messages.conversationId, conversationIds),
      // Email replies have no sender account; they still count as unread
      sql`coalesce(${messages.senderId}, 0) <> ${userId}`,
      sql`${messages.id} > coalesce(${conversationReads.lastReadMessageId}, 0)`,
      // A reply only counts in a thread you started or replied to
      sql`(${messages.parentId} is null or exists (
        select 1 from messages m2
        where (m2.id = ${messages.parentId} or m2.parent_id = ${messages.parentId}) and m2.sender_id = ${userId}
      ))`
    ))
    .groupBy(messages.conversationId);
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}

export async function totalUnread(conversationIds: number[], userId: number) {
  let total = 0;
  for (const n of (await unreadCounts(conversationIds, userId)).values()) total += n;
  return total;
}

// Conversation ids a staff member can see on a team: the team chat, their own
// direct threads and the groups they're in.
// Separate queries on purpose: Turso's planner fails ("internal query planner
// error") on an OR of them over this table's partial indexes.
export async function coachConversationIds(teamId: number, userId: number) {
  const [team, directs, groups] = await Promise.all([
    db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "team"))),
    db.select({ id: conversations.id }).from(conversations).where(staffDirects(teamId, userId)),
    groupIdsFor(userId, [teamId]),
  ]);
  return [...team.map((r) => r.id), ...directs.map((r) => r.id), ...groups];
}

// Teams this account coaches, among these. Their groups there open in the
// dashboard, so the family app leaves them out (and doesn't count them twice).
async function coachedAmong(userId: number, teamIds: number[]) {
  if (teamIds.length === 0) return new Set<number>();
  const rows = await db.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, teamIds), canAccessTeam(userId)));
  return new Set(rows.map((r) => r.id));
}

// Conversation ids a parent can see across their teams
export async function parentConversationIds(userId: number, teamIds: number[]) {
  if (teamIds.length === 0) return [];
  const coached = await coachedAmong(userId, teamIds);
  // Separate queries, not an OR (see coachConversationIds)
  const [team, directs, groups] = await Promise.all([
    db.select({ id: conversations.id }).from(conversations).where(and(inArray(conversations.teamId, teamIds), eq(conversations.kind, "team"))),
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(inArray(conversations.teamId, teamIds), eq(conversations.kind, "direct"), eq(conversations.parentUserId, userId))),
    groupIdsFor(userId, teamIds.filter((id) => !coached.has(id))),
  ]);
  return [...team.map((r) => r.id), ...directs.map((r) => r.id), ...groups];
}

export type ConversationSummary = {
  id: number;
  teamId: number;
  teamName: string;
  kind: "team" | "direct" | "group";
  title: string;
  subtitle: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  needsReply: boolean;
  emailOnly: boolean; // Family isn't on the app; replies go out by email
  /** Family app: the staff member's role, shown as a badge on their thread */
  staffRole?: StaffRole | null;
  /** Family app: where the row opens, when that isn't the thread itself (no thread with them yet) */
  href?: string;
  /** Sort key when it differs from lastMessageAt (an empty group sorts by when it was made) */
  sortAt?: string | null;
};

// Kids' first names per parent on a team: "Ricardo & Christian"
async function kidsByParent(teamId: number, parentUserIds: number[]) {
  if (parentUserIds.length === 0) return new Map<number, string>();
  const rows = await db
    .select({ userId: guardians.userId, name: players.name })
    .from(guardians)
    .innerJoin(players, eq(guardians.playerId, players.id))
    .where(and(eq(guardians.teamId, teamId), inArray(guardians.userId, parentUserIds)))
    .orderBy(players.name);
  const map = new Map<number, string[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.name.split(" ")[0]]);
  return new Map([...map].map(([k, v]) => [k, v.join(" & ")]));
}

// Contact names and kids' first names per family email on a team
export async function familyLabels(teamId: number, emails: string[]) {
  const result = new Map<string, { names: string[]; kids: string[] }>();
  if (emails.length === 0) return result;
  const rows = await db
    .select({ email: contacts.email, name: contacts.name, kid: players.name })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(eq(contacts.teamId, teamId), inArray(sql`lower(trim(${contacts.email}))`, emails.map(lower))))
    .orderBy(players.name);
  for (const r of rows) {
    const key = lower(r.email);
    const entry = result.get(key) ?? { names: [], kids: [] };
    if (r.name && lower(r.name) !== key && !entry.names.includes(r.name)) entry.names.push(r.name);
    const kid = r.kid.split(" ")[0];
    if (!entry.kids.includes(kid)) entry.kids.push(kid);
    result.set(key, entry);
  }
  return result;
}

export async function listCoachConversations(teamId: number, userId: number): Promise<ConversationSummary[]> {
  const team = await getOrCreateTeamConversation(teamId);
  const [teamRow] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);

  const directs = await db
    .select({
      id: conversations.id,
      parentUserId: conversations.parentUserId,
      familyEmail: conversations.familyEmail,
      needsReply: conversations.needsReply,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: conversations.lastMessagePreview,
      parentName: users.name,
      parentEmail: users.email,
    })
    .from(conversations)
    .leftJoin(users, eq(conversations.parentUserId, users.id))
    .where(staffDirects(teamId, userId))
    .orderBy(desc(conversations.lastMessageAt));

  const kids = await kidsByParent(teamId, directs.flatMap((d) => (d.parentUserId ? [d.parentUserId] : [])));
  const labels = await familyLabels(teamId, directs.flatMap((d) => (d.familyEmail ? [d.familyEmail] : [])));
  const linked = new Set(
    (await db.selectDistinct({ userId: guardians.userId }).from(guardians).where(eq(guardians.teamId, teamId))).map((r) => r.userId)
  );
  const groups = await groupSummaries(teamId, await groupIdsFor(userId, [teamId]), userId);
  const unread = await unreadCounts([team.id, ...directs.map((d) => d.id), ...groups.map((g) => g.id)], userId);
  const teamName = teamRow?.name ?? "Team";

  const rest: ConversationSummary[] = [
    // Threads with no messages yet are noise for coaches
    ...directs
      .filter((d) => d.lastMessageAt)
      .map((d): ConversationSummary => {
        const label = d.familyEmail ? labels.get(d.familyEmail) : undefined;
        const kidNames = (d.parentUserId && kids.get(d.parentUserId)) || label?.kids.join(" & ");
        return {
          id: d.id,
          teamId,
          teamName,
          kind: "direct",
          title: d.parentName || label?.names[0] || d.parentEmail || d.familyEmail || "Family",
          subtitle: kidNames ? `${kidNames}'s family` : "Family",
          lastMessageAt: d.lastMessageAt,
          lastMessagePreview: d.lastMessagePreview,
          unread: unread.get(d.id) ?? 0,
          needsReply: d.needsReply,
          emailOnly: !d.parentUserId || !linked.has(d.parentUserId),
        };
      }),
    // Groups show from the start: everyone in one was added on purpose
    ...groups.map((g): ConversationSummary => ({
      id: g.id,
      teamId,
      teamName,
      kind: "group",
      title: g.title,
      subtitle: g.subtitle,
      lastMessageAt: g.lastMessageAt,
      lastMessagePreview: g.lastMessagePreview,
      unread: unread.get(g.id) ?? 0,
      needsReply: false,
      emailOnly: false,
      sortAt: g.lastMessageAt ?? g.createdAt,
    })),
  ];
  rest.sort((a, b) => (b.sortAt ?? b.lastMessageAt ?? "").localeCompare(a.sortAt ?? a.lastMessageAt ?? ""));

  return [
    {
      id: team.id,
      teamId,
      teamName,
      kind: "team",
      title: "Team chat",
      subtitle: "Coaches and all families on the app",
      lastMessageAt: team.lastMessageAt,
      lastMessagePreview: team.lastMessagePreview,
      unread: unread.get(team.id) ?? 0,
      needsReply: false,
      emailOnly: false,
    },
    ...rest,
  ];
}

// The family's Messages list: per team, the team chat, then a private thread
// with each staff member (their role shown as a badge). Threads are made on
// first open, so a staff member they've never written to links to
// /family/messages/with/:teamId/:staffId. A thread with someone who has left
// the staff stays listed while it has history. A parent who is on the staff
// of the same team still gets their family threads with the other staff here
// (never one with themselves), so the list shows everything the unread badge counts.
export async function listParentConversations(
  userId: number,
  teamList: { teamId: number; teamName: string }[]
): Promise<ConversationSummary[]> {
  const teamChats: ConversationSummary[] = [];
  const directs: ConversationSummary[] = [];
  const unstarted: ConversationSummary[] = [];
  const ids: number[] = [];
  const coached = await coachedAmong(userId, teamList.map((t) => t.teamId));

  for (const { teamId, teamName } of teamList) {
    const chat = await getOrCreateTeamConversation(teamId);
    ids.push(chat.id);
    teamChats.push({
      id: chat.id,
      teamId,
      teamName,
      kind: "team",
      title: "Team chat",
      subtitle: `${teamName} · everyone`,
      lastMessageAt: chat.lastMessageAt,
      lastMessagePreview: chat.lastMessagePreview,
      unread: 0,
      needsReply: false,
      emailOnly: false,
    });
    const staff = (await getTeamStaff(teamId)).filter((m) => m.userId !== userId);
    const threads = await db
      .select({ convo: conversations, name: users.name, email: users.email })
      .from(conversations)
      .innerJoin(users, eq(conversations.staffUserId, users.id))
      .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.parentUserId, userId)));
    const byStaff = new Map(threads.map((t) => [t.convo.staffUserId, t]));

    for (const member of staff) {
      const thread = byStaff.get(member.userId);
      const name = member.name || member.email.split("@")[0];
      if (thread) ids.push(thread.convo.id);
      (thread?.convo.lastMessageAt ? directs : unstarted).push({
        id: thread?.convo.id ?? 0,
        teamId,
        teamName,
        kind: "direct",
        title: name,
        subtitle: `${teamName} · private`,
        lastMessageAt: thread?.convo.lastMessageAt ?? null,
        lastMessagePreview: thread?.convo.lastMessagePreview ?? null,
        unread: 0,
        needsReply: false,
        emailOnly: false,
        staffRole: member.role,
        href: thread ? undefined : `/family/messages/with/${teamId}/${member.userId}`,
      });
    }
    // Someone who has left the staff: keep the history readable
    const current = new Set(staff.map((m) => m.userId));
    for (const t of threads) {
      if (current.has(t.convo.staffUserId!) || !t.convo.lastMessageAt || t.convo.staffUserId === userId) continue;
      ids.push(t.convo.id);
      directs.push({
        id: t.convo.id,
        teamId,
        teamName,
        kind: "direct",
        title: t.name || t.email.split("@")[0],
        subtitle: `${teamName} · no longer on the team staff`,
        lastMessageAt: t.convo.lastMessageAt,
        lastMessagePreview: t.convo.lastMessagePreview,
        unread: 0,
        needsReply: false,
        emailOnly: false,
        staffRole: null,
      });
    }
    // Groups they're in. On a team they also coach, groups open in the dashboard instead.
    if (!coached.has(teamId)) {
      for (const g of await groupSummaries(teamId, await groupIdsFor(userId, [teamId]), userId)) {
        ids.push(g.id);
        directs.push({
          id: g.id,
          teamId,
          teamName,
          kind: "group",
          title: g.title,
          subtitle: `${teamName} · ${g.subtitle.toLowerCase()}`,
          lastMessageAt: g.lastMessageAt,
          lastMessagePreview: g.lastMessagePreview,
          unread: 0,
          needsReply: false,
          emailOnly: false,
          sortAt: g.lastMessageAt ?? g.createdAt,
        });
      }
    }
  }

  const unread = await unreadCounts(ids, userId);
  directs.sort((a, b) => (b.sortAt ?? b.lastMessageAt ?? "").localeCompare(a.sortAt ?? a.lastMessageAt ?? ""));
  return [...teamChats, ...directs, ...unstarted].map((c) => (c.id ? { ...c, unread: unread.get(c.id) ?? 0 } : c));
}

// ---------------------------------------------------------------------------
// Groups: who's in them and what they're called


// Members of these groups who are still on the team, oldest first. People who
// have left the team (or a family whose contacts were removed) drop out.
export async function loadGroupMembers(teamId: number, conversationIds: number[]) {
  const result = new Map<number, GroupMember[]>();
  if (conversationIds.length === 0) return result;
  const rows = await db
    .select({
      id: conversationMembers.id,
      conversationId: conversationMembers.conversationId,
      userId: conversationMembers.userId,
      familyEmail: conversationMembers.familyEmail,
      name: users.name,
      email: users.email,
    })
    .from(conversationMembers)
    .leftJoin(users, eq(conversationMembers.userId, users.id))
    .where(inArray(conversationMembers.conversationId, conversationIds))
    .orderBy(conversationMembers.id);
  const userIds = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const [roles, parents, kids, labels] = await Promise.all([
    getStaffRoles(teamId),
    getParentUserIds(teamId).then((ids) => new Set(ids)),
    kidsByParent(teamId, userIds),
    familyLabels(teamId, rows.flatMap((r) => (!r.userId && r.familyEmail ? [r.familyEmail] : []))),
  ]);

  for (const r of rows) {
    let member: GroupMember | null = null;
    if (r.userId) {
      const role = roles.get(r.userId) ?? null;
      if (role || parents.has(r.userId)) {
        const kidNames = kids.get(r.userId);
        member = {
          id: r.id,
          userId: r.userId,
          name: r.name || r.email?.split("@")[0] || "Someone",
          detail: !role && kidNames ? `${kidNames}'s family` : "",
          role,
          pending: false,
        };
      }
    } else if (r.familyEmail) {
      const label = labels.get(r.familyEmail);
      if (label) {
        member = {
          id: r.id,
          userId: null,
          name: label.names[0] || `${label.kids.join(" & ")}'s family`,
          detail: `${label.kids.join(" & ")}'s family`,
          role: null,
          pending: true,
        };
      }
    }
    if (member) result.set(r.conversationId, [...(result.get(r.conversationId) ?? []), member]);
  }
  return result;
}

/** Who can rename the group and add or remove people: whoever started it, or if they've gone, the longest-standing member */
export function groupManagerId(conversation: { createdBy: number | null }, members: GroupMember[]) {
  const accounts = members.filter((m) => m.userId != null);
  if (conversation.createdBy != null && accounts.some((m) => m.userId === conversation.createdBy)) return conversation.createdBy;
  return accounts[0]?.userId ?? null;
}

/** "Maria, Chen & Priya", "Maria, Chen, Priya +2": everyone in it but the viewer */
export function groupTitle(name: string | null, members: GroupMember[], viewerId: number) {
  if (name) return name;
  const others = members.filter((m) => m.userId !== viewerId).map((m) => m.name.split(" ")[0]);
  if (others.length === 0) return "Just you";
  if (others.length <= 3) return others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} & ${others.at(-1)}`;
  return `${others.slice(0, 3).join(", ")} +${others.length - 3}`;
}

export function groupSubtitle(members: GroupMember[]) {
  return `Group · ${members.length} ${members.length === 1 ? "person" : "people"}`;
}

async function groupSummaries(teamId: number, ids: number[], viewerId: number) {
  if (ids.length === 0) return [];
  const [rows, members] = await Promise.all([
    db.select().from(conversations).where(inArray(conversations.id, ids)),
    loadGroupMembers(teamId, ids),
  ]);
  return rows.map((c) => {
    const list = members.get(c.id) ?? [];
    return {
      id: c.id,
      title: groupTitle(c.name, list, viewerId),
      subtitle: groupSubtitle(list),
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
      createdAt: c.createdAt,
    };
  });
}

export type ThreadMessage = {
  id: number;
  senderId: number | null;
  senderName: string;
  senderIsCoach: boolean; // On the team staff (any role)
  senderRole: StaffRole | null; // Their staff role, shown as a badge
  body: string;
  createdAt: string;
  viaEmail: boolean; // Came in as an email reply
  emailedTo: string | null; // A coach message that was also emailed
  fullEmail: string | null; // The whole email when the reply was trimmed
  announcement: { id: number; subject: string; ask: "none" | "ack" | "reply" } | null;
  parentId: number | null;
  reactions: ReactionSummary[];
  /** Roots only: the replies under it, if any */
  thread: ThreadSummary | null;
};

export type ReactionSummary = { emoji: string; count: number; mine: boolean; names: string[] };
export type ThreadSummary = { count: number; lastAt: string; names: string[] };

// The conversation's top-level messages (replies live in threads under them),
// each with its reactions and a summary of its thread.
export async function getThread(conversationId: number, viewerId: number, limit = 200): Promise<ThreadMessage[]> {
  return loadMessages(conversationId, viewerId, sql`${messages.parentId} is null`, limit);
}

// One thread: its root and every reply, oldest first. A reply's id finds its root.
export async function getReplies(conversationId: number, messageId: number, viewerId: number) {
  if (!Number.isInteger(messageId)) return null;
  const [hit] = await db
    .select({ id: messages.id, parentId: messages.parentId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .limit(1);
  if (!hit) return null;
  const rootId = hit.parentId ?? hit.id;
  const rows = await loadMessages(
    conversationId,
    viewerId,
    sql`(${messages.id} = ${rootId} or ${messages.parentId} = ${rootId})`,
    500
  );
  const root = rows.find((m) => m.id === rootId);
  return root ? { root, replies: rows.filter((m) => m.id !== rootId) } : null;
}

async function loadMessages(conversationId: number, viewerId: number, where: ReturnType<typeof sql>, limit: number): Promise<ThreadMessage[]> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return [];
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderEmail: messages.senderEmail,
      senderName: messages.senderName,
      source: messages.source,
      body: messages.body,
      createdAt: messages.createdAt,
      announcementId: messages.announcementId,
      inboundEmailId: messages.inboundEmailId,
      emailedTo: messages.emailedTo,
      parentId: messages.parentId,
      name: users.name,
      email: users.email,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderId, users.id))
    .where(and(eq(messages.conversationId, conversationId), where))
    .orderBy(desc(messages.id))
    .limit(limit);
  const ids = rows.map((r) => r.id);

  const announcementIds = [...new Set(rows.flatMap((r) => (r.announcementId ? [r.announcementId] : [])))];
  const announcementRows = announcementIds.length
    ? await db
        .select({ id: announcements.id, subject: announcements.subject, ask: announcements.ask })
        .from(announcements)
        .where(inArray(announcements.id, announcementIds))
    : [];
  const announcementById = new Map(announcementRows.map((a) => [a.id, a]));

  const inboundIds = rows.flatMap((r) => (r.inboundEmailId ? [r.inboundEmailId] : []));
  const inboundRows = inboundIds.length
    ? await db.select({ id: inboundEmails.id, text: inboundEmails.text }).from(inboundEmails).where(inArray(inboundEmails.id, inboundIds))
    : [];
  const fullById = new Map(inboundRows.map((r) => [r.id, r.text]));

  const reactions = await reactionsFor(ids, viewerId);
  const threads = await threadSummaries(rows.filter((r) => r.parentId == null).map((r) => r.id));

  const staffRoles = await getStaffRoles(conversation.teamId);
  return rows.reverse().map((r) => {
    const senderRole = r.senderId != null ? staffRoles.get(r.senderId) ?? null : null;
    const full = r.inboundEmailId ? fullById.get(r.inboundEmailId)?.trim() ?? null : null;
    return {
      id: r.id,
      senderId: r.senderId,
      senderName: displayName(r),
      senderIsCoach: senderRole != null,
      senderRole,
      body: r.body,
      createdAt: r.createdAt,
      viaEmail: r.source === "email",
      emailedTo: r.emailedTo,
      fullEmail: full && full !== r.body.trim() ? full : null,
      announcement: r.announcementId ? announcementById.get(r.announcementId) ?? null : null,
      parentId: r.parentId,
      reactions: reactions.get(r.id) ?? [],
      thread: threads.get(r.id) ?? null,
    };
  });
}

function displayName(r: { name: string | null; senderName: string | null; email: string | null; senderEmail: string | null }) {
  return r.name || r.senderName || r.email?.split("@")[0] || r.senderEmail || "Family";
}

async function reactionsFor(messageIds: number[], viewerId: number) {
  const result = new Map<number, ReactionSummary[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji, userId: messageReactions.userId, name: users.name, email: users.email })
    .from(messageReactions)
    .innerJoin(users, eq(messageReactions.userId, users.id))
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(messageReactions.id);
  for (const r of rows) {
    const list = result.get(r.messageId) ?? [];
    let entry = list.find((e) => e.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, mine: false, names: [] };
      list.push(entry);
    }
    entry.count += 1;
    entry.mine ||= r.userId === viewerId;
    entry.names.push(r.userId === viewerId ? "You" : r.name || r.email.split("@")[0]);
    result.set(r.messageId, list);
  }
  return result;
}

async function threadSummaries(rootIds: number[]) {
  const result = new Map<number, ThreadSummary>();
  if (rootIds.length === 0) return result;
  const rows = await db
    .select({
      parentId: messages.parentId,
      senderId: messages.senderId,
      senderName: messages.senderName,
      senderEmail: messages.senderEmail,
      createdAt: messages.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderId, users.id))
    .where(inArray(messages.parentId, rootIds))
    .orderBy(messages.id);
  for (const r of rows) {
    const summary = result.get(r.parentId!) ?? { count: 0, lastAt: r.createdAt, names: [] };
    summary.count += 1;
    summary.lastAt = r.createdAt;
    const name = displayName(r).split(" ")[0];
    if (!summary.names.includes(name)) summary.names.push(name);
    result.set(r.parentId!, summary);
  }
  return result;
}

/** Newest message id in a conversation, replies included: opening it marks all of it read */
export async function latestMessageId(conversationId: number) {
  const [row] = await db
    .select({ id: sql<number>`max(${messages.id})` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return Number(row?.id ?? 0);
}

export async function markRead(conversationId: number, userId: number, lastMessageId: number) {
  if (!lastMessageId) return;
  await db
    .insert(conversationReads)
    .values({ conversationId, userId, lastReadMessageId: lastMessageId })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.userId],
      // Never move the read marker backwards
      set: {
        lastReadMessageId: sql`max(${conversationReads.lastReadMessageId}, ${lastMessageId})`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

export function preview(body: string, length = 120) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

// Families waiting on this staff member (each has their own threads)
export async function countNeedsReply(teamId: number, userId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(conversations)
    .where(and(staffDirects(teamId, userId), eq(conversations.needsReply, true)));
  return Number(row?.n ?? 0);
}

export async function setNeedsReply(conversationId: number, needsReply: boolean) {
  await db.update(conversations).set({ needsReply }).where(eq(conversations.id, conversationId));
}

// ---------------------------------------------------------------------------
// Coach replies by email
//
// A coach's message in a direct thread is emailed to the family too, unless
// the coach unchecks "Also send by email". That's only allowed when the
// parent holding the thread gets push notifications on some device; without
// them the email is the only way they'd know there's a message.

type Sender = { id: number; name: string | null; email: string; sendingEmail?: string | null };

/** Which of these users have at least one device subscribed to push */
export async function usersWithPush(userIds: number[]) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set<number>();
  const rows = await db
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ids));
  return new Set(rows.map((r) => r.userId));
}

export type FamilyDelivery = {
  /** Where the email copy goes; null for the team chat or a thread with no address */
  email: string | null;
  /** On the app with notifications on: they'll see it without the email */
  pushReady: boolean;
};

// How a coach's message in this thread reaches the family. Only the parent
// holding the thread is notified of it (each parent has their own thread), so
// it's their push that counts.
export async function familyDelivery(conversation: typeof conversations.$inferSelect): Promise<FamilyDelivery> {
  if (conversation.kind !== "direct") return { email: null, pushReady: false };
  let email = conversation.familyEmail;
  if (!email && conversation.parentUserId) {
    const [parent] = await db.select({ email: users.email }).from(users).where(eq(users.id, conversation.parentUserId)).limit(1);
    email = parent ? lower(parent.email) : null;
  }
  const parentId = conversation.parentUserId;
  const pushReady = Boolean(
    parentId && (await isGuardianOnTeam(parentId, conversation.teamId)) && (await usersWithPush([parentId])).has(parentId)
  );
  return { email, pushReady };
}

// Message-IDs to thread a new email under: the family's latest email to us,
// and the latest we sent them
async function threadingHeaders(conversationId: number) {
  const [lastIn] = await db
    .select({ id: inboundEmails.emailMessageId, refs: inboundEmails.references, subject: inboundEmails.subject })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.conversationId, conversationId), eq(inboundEmails.status, "matched")))
    .orderBy(desc(inboundEmails.id))
    .limit(1);
  const [lastAnnouncement] = await db
    .select({ subject: announcements.subject, messageIds: announcementRecipients.emailMessageId })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .where(eq(announcementRecipients.conversationId, conversationId))
    .orderBy(desc(announcementRecipients.id))
    .limit(1);

  const inReplyTo = lastIn?.id ?? lastAnnouncement?.messageIds?.split(" ")[0] ?? null;
  const refs = [lastIn?.refs, lastIn?.id, lastAnnouncement?.messageIds].filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const references = [...new Set(refs)].slice(-10).join(" ");
  const baseSubject = (lastIn?.subject || lastAnnouncement?.subject || "").replace(/^(re|fwd?):\s*/i, "");
  return { inReplyTo, references, subject: baseSubject ? `Re: ${baseSubject}` : null };
}

async function emailCoachMessage(
  conversation: typeof conversations.$inferSelect,
  message: typeof messages.$inferSelect,
  sender: Sender,
  to: string
) {
  const [coach] = await db
    .select({ id: users.id, name: users.name, email: users.email, sendingEmail: users.sendingEmail })
    .from(users)
    .where(eq(users.id, sender.id))
    .limit(1);
  const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);
  const from = coachFromAddress(coach ?? { id: sender.id, name: sender.name, email: sender.email, sendingEmail: null }, team);
  const thread = await threadingHeaders(conversation.id);
  const deliverTo = familyDeliveryAddress(to, coach?.email ?? sender.email);
  const teamName = team?.name ?? "your team";
  const coachName = coach?.name || sender.name || "your coach";

  const result = await sendEmail({
    from: from.header,
    to: deliverTo,
    subject: thread.subject ?? `Message from ${coach?.name || "your coach"} (${teamName})`,
    text: `${message.body}\n\n--\nReply to this email to answer ${coachName} (${teamName}). Only ${coachName} sees it.`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${textToHtml(message.body)}<p style="margin:24px 0 0;font-size:12px;color:#64748b">Reply to this email to answer ${escapeHtml(coachName)} (${escapeHtml(teamName)}). Only ${escapeHtml(coachName)} sees it.</p></div>`,
    headers: {
      ...(thread.inReplyTo ? { "In-Reply-To": thread.inReplyTo } : {}),
      ...(thread.references ? { References: thread.references } : {}),
    },
    tags: [{ name: "message_id", value: String(message.id) }],
    idempotencyKey: `message-${message.id}-${crypto.createHash("sha1").update(deliverTo).digest("hex").slice(0, 8)}`,
  });
  if (result.sent) {
    await db.update(messages).set({ emailedTo: to, resendEmailId: result.id ?? null }).where(eq(messages.id, message.id));
  }
  return result;
}

// Saves a message, marks it read for the sender, and pushes it to everyone else
// in the conversation (and emails the family when that's how they're reached).
// Callers check access first.
export async function postMessage(
  conversation: typeof conversations.$inferSelect,
  sender: Sender,
  body: string,
  options: {
    /** Coach messages to a family: also email it. Only when the coach ticks "Send by email"; never for thread replies. */
    email?: boolean;
    /** Reply in the thread under this message */
    replyTo?: number | null;
  } = {}
) {
  const text = body.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return null;

  // Threads are one level deep: replying to a reply joins the same thread
  let rootId: number | null = null;
  if (options.replyTo) {
    const [parent] = await db
      .select({ id: messages.id, parentId: messages.parentId })
      .from(messages)
      .where(and(eq(messages.id, options.replyTo), eq(messages.conversationId, conversation.id)))
      .limit(1);
    if (!parent) return null;
    rootId = parent.parentId ?? parent.id;
  }

  // Only a direct thread's staff member can email the family; groups are never emailed
  const senderIsCoach = conversation.kind === "direct" && sender.id === conversation.staffUserId;
  const delivery = senderIsCoach && options.email === true && !rootId ? await familyDelivery(conversation) : null;
  const emailTo = delivery?.email ?? null;

  const [message] = await db
    .insert(messages)
    .values({ conversationId: conversation.id, senderId: sender.id, body: text, parentId: rootId })
    .returning();
  await db
    .update(conversations)
    .set({
      lastMessageAt: message.createdAt,
      lastMessagePreview: preview(rootId ? `↳ ${text}` : text),
      // The family writing flags the thread; the staff member answering clears it
      ...(conversation.kind === "direct" ? { needsReply: !senderIsCoach } : {}),
    })
    .where(eq(conversations.id, conversation.id));
  await markRead(conversation.id, sender.id, message.id);
  await publishConversation(conversation, { kind: "message", threadId: rootId });

  const emailed = emailTo ? await emailCoachMessage(conversation, message, sender, emailTo) : null;

  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);
  const senderName = sender.name || sender.email.split("@")[0];
  const teamName = team?.name ?? "Team";

  if (rootId) {
    await notifyThreadReply(conversation, rootId, sender.id, senderName, text);
  } else {
    // Everyone who can read it but the sender: a direct thread's other person, a group's members
    const everyone = (await conversationReaderIds(conversation)).filter((id) => id !== sender.id);
    await pushToConversation(conversation, everyone, "chat", {
      title:
        conversation.kind === "team"
          ? `${teamName} · ${senderName}`
          : conversation.kind === "group"
            ? `${senderName} · ${conversation.name || `Group (${teamName})`}`
            : `${senderName} (${teamName})`,
      body: preview(text, 180),
      tag: `conversation-${conversation.id}`,
    });
  }

  return { ...message, emailError: emailed && !emailed.sent ? emailed.error ?? "Email failed" : null };
}

// A reply in a thread notifies only the people in it: whoever wrote the root
// and everyone who has replied, except the one replying (null for a family's
// email reply with no account)
export async function notifyThreadReply(
  conversation: typeof conversations.$inferSelect,
  rootId: number,
  senderId: number | null,
  senderName: string,
  text: string
) {
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);
  const people = await db
    .selectDistinct({ id: messages.senderId })
    .from(messages)
    .where(sql`(${messages.id} = ${rootId} or ${messages.parentId} = ${rootId}) and ${messages.senderId} is not null`);
  // Only people who can still read the conversation
  const readers = new Set(await conversationReaderIds(conversation));
  const ids = people.map((p) => p.id!).filter((id) => id !== senderId && readers.has(id));
  const where = conversation.kind === "team" ? team?.name ?? "Team" : conversation.kind === "group" ? conversation.name || "Group" : null;
  await pushToConversation(conversation, ids, "replies", {
    title: `${senderName} replied${where ? ` · ${where}` : ""}`,
    body: preview(text, 180),
    tag: `thread-${rootId}`,
    threadId: rootId,
  });
}

// Adds the reaction, or takes it back if they'd already reacted with it.
// The author hears about new reactions (not ones taken back).
export async function toggleReaction(
  conversation: typeof conversations.$inferSelect,
  user: Sender,
  messageId: number,
  emoji: string
) {
  if (!isReaction(emoji) || !Number.isInteger(messageId)) return false;
  const [message] = await db
    .select({ id: messages.id, senderId: messages.senderId, parentId: messages.parentId, body: messages.body })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversation.id)))
    .limit(1);
  if (!message) return false;

  const mine = and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, user.id), eq(messageReactions.emoji, emoji));
  const [existing] = await db.select({ id: messageReactions.id }).from(messageReactions).where(mine).limit(1);
  if (existing) {
    await db.delete(messageReactions).where(eq(messageReactions.id, existing.id));
    await publishConversation(conversation, { kind: "reaction", threadId: message.parentId });
    return true;
  }
  await db.insert(messageReactions).values({ messageId, userId: user.id, emoji }).onConflictDoNothing();
  await publishConversation(conversation, { kind: "reaction", threadId: message.parentId });

  if (message.senderId && message.senderId !== user.id && (await conversationReaderIds(conversation)).includes(message.senderId)) {
    const name = user.name || user.email.split("@")[0];
    await pushToConversation(conversation, [message.senderId], "reactions", {
      title: `${name} reacted ${emoji}`,
      body: `"${preview(message.body, 120)}"`,
      tag: `reaction-${messageId}`,
      threadId: message.parentId ?? undefined,
    });
  }
  return true;
}

// Staff open a conversation in the dashboard, parents in the family app. Who
// is which comes from the conversation: in a direct thread, its staff member is
// staff and its parent is a parent (even a parent who coaches another team). In
// the team chat and groups, anyone on the team staff is staff.
async function pushToConversation(
  conversation: typeof conversations.$inferSelect,
  userIds: number[],
  kind: "chat" | "replies" | "reactions",
  p: { title: string; body: string; tag: string; threadId?: number }
) {
  const query = p.threadId ? `?thread=${p.threadId}` : "";
  const staffIds = conversation.kind === "direct" ? [conversation.staffUserId] : await getCoachUserIds(conversation.teamId);
  const coaches = userIds.filter((id) => staffIds.includes(id));
  const parents = userIds.filter((id) => !staffIds.includes(id));
  await Promise.all([
    sendPush(coaches, kind, {
      title: p.title,
      body: p.body,
      url: `/dashboard/team/${conversation.teamId}/messages/${conversation.id}${query}`,
      tag: p.tag,
    }),
    sendPush(parents, kind, {
      title: p.title,
      body: p.body,
      url: `/family/messages/${conversation.id}${query}`,
      tag: p.tag,
    }),
  ]);
}
