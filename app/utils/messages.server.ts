import crypto from "node:crypto";
import {
  db,
  announcementRecipients,
  announcements,
  contacts,
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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getTeamForUser } from "~/utils/team-access.server";
import { getCoachUserIds, getParentUserIds } from "~/utils/family.server";
import { getStaffRoles } from "~/utils/team-access.server";
import type { StaffRole } from "~/utils/team-roles";
import { sendPush } from "~/utils/push.server";
import { isReaction } from "~/utils/reactions";
import { publishConversation } from "~/utils/realtime.server";
import { coachFromAddress, familyDeliveryAddress, sendEmail, textToHtml, escapeHtml } from "~/utils/email.server";

// Two kinds of conversation per team:
//   team   - every coach and every linked parent
//   direct - one family and the team's coaching staff (all coaches see it)
//
// A direct thread belongs to a parent account (parentUserId), a family email
// (familyEmail), or both. Families who aren't on the app yet have an email-only
// thread: announcements and coach replies reach them by email, and their email
// replies land here. When they join with a proven email the thread becomes
// their account's (claimFamilyConversation).

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

export async function getOrCreateDirectConversation(teamId: number, parentUserId: number) {
  const where = and(
    eq(conversations.teamId, teamId),
    eq(conversations.kind, "direct"),
    eq(conversations.parentUserId, parentUserId)
  );
  const [existing] = await db.select().from(conversations).where(where).limit(1);
  if (existing) return existing;
  await db.insert(conversations).values({ teamId, kind: "direct", parentUserId }).onConflictDoNothing();
  const [created] = await db.select().from(conversations).where(where).limit(1);
  return created;
}

async function findFamilyEmailConversation(teamId: number, familyEmail: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.familyEmail, familyEmail)))
    .limit(1);
  return row ?? null;
}

// Moves everything from one direct thread into another and deletes the first
async function mergeConversation(from: typeof conversations.$inferSelect, into: typeof conversations.$inferSelect) {
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

// The direct thread for a family on a team, by email and (if they're on the
// app) account. Creates it if needed and keeps the two keys in step.
export async function getOrCreateFamilyConversation(teamId: number, rawEmail: string, parentUserId?: number | null) {
  const familyEmail = lower(rawEmail);
  const byEmail = await findFamilyEmailConversation(teamId, familyEmail);

  if (parentUserId) {
    if (byEmail?.parentUserId === parentUserId) return byEmail;
    const byUser = await getOrCreateDirectConversation(teamId, parentUserId);
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
  await db.insert(conversations).values({ teamId, kind: "direct", familyEmail }).onConflictDoNothing();
  return (await findFamilyEmailConversation(teamId, familyEmail))!;
}

// After a parent proves an email (invite or magic link), the email-only thread
// for it becomes theirs. Never called on a bare users.email match.
export async function claimFamilyConversation(teamId: number, rawEmail: string, userId: number) {
  const familyEmail = lower(rawEmail);
  const byEmail = await findFamilyEmailConversation(teamId, familyEmail);
  if (!byEmail || byEmail.parentUserId) return;
  const [byUser] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.parentUserId, userId)))
    .limit(1);
  if (byUser) {
    await mergeConversation(byEmail, byUser);
  } else {
    await db.update(conversations).set({ parentUserId: userId }).where(eq(conversations.id, byEmail.id));
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

// Who may read and post here, and as what. Coaches see every conversation on
// their team; parents see the team chat and their own direct thread. An
// email-only thread (no parentUserId) is visible to coaches only.
export async function getConversationAccess(conversationId: number, userId: number) {
  if (!Number.isInteger(conversationId)) return null;
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return null;

  if (await getTeamForUser(conversation.teamId, userId)) {
    return { conversation, viewer: "coach" as const };
  }
  const parentAllowed =
    (conversation.kind === "team" || conversation.parentUserId === userId) &&
    (await isGuardianOnTeam(userId, conversation.teamId));
  return parentAllowed ? { conversation, viewer: "parent" as const } : null;
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

// Conversation ids a coach can see on a team
export async function coachConversationIds(teamId: number) {
  const rows = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.teamId, teamId));
  return rows.map((r) => r.id);
}

// Conversation ids a parent can see across their teams
export async function parentConversationIds(userId: number, teamIds: number[]) {
  if (teamIds.length === 0) return [];
  const rows = await db
    .select({ id: conversations.id, kind: conversations.kind, parentUserId: conversations.parentUserId })
    .from(conversations)
    .where(inArray(conversations.teamId, teamIds));
  return rows.filter((r) => r.kind === "team" || r.parentUserId === userId).map((r) => r.id);
}

export type ConversationSummary = {
  id: number;
  teamId: number;
  teamName: string;
  kind: "team" | "direct";
  title: string;
  subtitle: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  needsReply: boolean;
  emailOnly: boolean; // Family isn't on the app; replies go out by email
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
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct")))
    .orderBy(desc(conversations.lastMessageAt));

  const kids = await kidsByParent(teamId, directs.flatMap((d) => (d.parentUserId ? [d.parentUserId] : [])));
  const labels = await familyLabels(teamId, directs.flatMap((d) => (d.familyEmail ? [d.familyEmail] : [])));
  const linked = new Set(
    (await db.selectDistinct({ userId: guardians.userId }).from(guardians).where(eq(guardians.teamId, teamId))).map((r) => r.userId)
  );
  const unread = await unreadCounts([team.id, ...directs.map((d) => d.id)], userId);
  const teamName = teamRow?.name ?? "Team";

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
  ];
}

export async function listParentConversations(
  userId: number,
  teamList: { teamId: number; teamName: string }[],
  coachedTeamIds: Set<number> = new Set()
): Promise<ConversationSummary[]> {
  const result: ConversationSummary[] = [];
  const all: { convo: typeof conversations.$inferSelect; teamName: string; kind: "team" | "direct" }[] = [];

  for (const { teamId, teamName } of teamList) {
    all.push({ convo: await getOrCreateTeamConversation(teamId), teamName, kind: "team" });
    if (!coachedTeamIds.has(teamId)) {
      all.push({ convo: await getOrCreateDirectConversation(teamId, userId), teamName, kind: "direct" });
    }
  }

  const unread = await unreadCounts(all.map((a) => a.convo.id), userId);
  for (const { convo, teamName, kind } of all) {
    result.push({
      id: convo.id,
      teamId: convo.teamId,
      teamName,
      kind,
      title: kind === "team" ? "Team chat" : "Coaches",
      subtitle: kind === "team" ? `${teamName} · everyone` : `${teamName} · private`,
      lastMessageAt: convo.lastMessageAt,
      lastMessagePreview: convo.lastMessagePreview,
      unread: unread.get(convo.id) ?? 0,
      needsReply: false,
      emailOnly: false,
    });
  }
  return result;
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

export async function countNeedsReply(teamId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.needsReply, true)));
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

  const result = await sendEmail({
    from: from.header,
    to: deliverTo,
    subject: thread.subject ?? `Message from ${coach?.name || "your coach"} (${teamName})`,
    text: `${message.body}\n\n--\nReply to this email to answer the coaches of ${teamName}.`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${textToHtml(message.body)}<p style="margin:24px 0 0;font-size:12px;color:#64748b">Reply to this email to answer the coaches of ${escapeHtml(teamName)}.</p></div>`,
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

  const coachIds = await getCoachUserIds(conversation.teamId);
  const senderIsCoach = coachIds.includes(sender.id);
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
      // A family writing flags the thread; a coach answering clears it
      ...(conversation.kind === "direct" ? { needsReply: !senderIsCoach } : {}),
    })
    .where(eq(conversations.id, conversation.id));
  await markRead(conversation.id, sender.id, message.id);
  await publishConversation(conversation.teamId, conversation.id, { kind: "message", threadId: rootId });

  const emailed = emailTo ? await emailCoachMessage(conversation, message, sender, emailTo) : null;

  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);
  const senderName = sender.name || sender.email.split("@")[0];
  const teamName = team?.name ?? "Team";

  if (rootId) {
    // Replies go only to the people in the thread
    const people = await db
      .selectDistinct({ id: messages.senderId })
      .from(messages)
      .where(sql`(${messages.id} = ${rootId} or ${messages.parentId} = ${rootId}) and ${messages.senderId} is not null`);
    const ids = people.map((p) => p.id!).filter((id) => id !== sender.id);
    await pushToConversation(conversation, coachIds, ids, "replies", {
      title: `${senderName} replied${conversation.kind === "team" ? ` · ${teamName}` : ""}`,
      body: preview(text, 180),
      tag: `thread-${rootId}`,
      threadId: rootId,
    });
  } else {
    const parentIds =
      conversation.kind === "team"
        ? await getParentUserIds(conversation.teamId)
        : conversation.parentUserId
          ? [conversation.parentUserId]
          : [];
    const everyone = [...coachIds, ...parentIds].filter((id) => id !== sender.id);
    await pushToConversation(conversation, coachIds, everyone, "chat", {
      title: conversation.kind === "team" ? `${teamName} · ${senderName}` : `${senderName} (${teamName})`,
      parentTitle: conversation.kind === "team" ? `${teamName} · ${senderName}` : `${senderName} · Coaches`,
      body: preview(text, 180),
      tag: `conversation-${conversation.id}`,
    });
  }

  return { ...message, emailError: emailed && !emailed.sent ? emailed.error ?? "Email failed" : null };
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
    await publishConversation(conversation.teamId, conversation.id, { kind: "reaction", threadId: message.parentId });
    return true;
  }
  await db.insert(messageReactions).values({ messageId, userId: user.id, emoji }).onConflictDoNothing();
  await publishConversation(conversation.teamId, conversation.id, { kind: "reaction", threadId: message.parentId });

  if (message.senderId && message.senderId !== user.id) {
    const name = user.name || user.email.split("@")[0];
    await pushToConversation(conversation, await getCoachUserIds(conversation.teamId), [message.senderId], "reactions", {
      title: `${name} reacted ${emoji}`,
      body: `"${preview(message.body, 120)}"`,
      tag: `reaction-${messageId}`,
      threadId: message.parentId ?? undefined,
    });
  }
  return true;
}

// Coaches open a conversation in the dashboard, parents in the family app
async function pushToConversation(
  conversation: typeof conversations.$inferSelect,
  coachIds: number[],
  userIds: number[],
  kind: "chat" | "replies" | "reactions",
  p: { title: string; parentTitle?: string; body: string; tag: string; threadId?: number }
) {
  const query = p.threadId ? `?thread=${p.threadId}` : "";
  const coaches = userIds.filter((id) => coachIds.includes(id));
  const parents = userIds.filter((id) => !coachIds.includes(id));
  await Promise.all([
    sendPush(coaches, kind, {
      title: p.title,
      body: p.body,
      url: `/dashboard/team/${conversation.teamId}/messages/${conversation.id}${query}`,
      tag: p.tag,
    }),
    sendPush(parents, kind, {
      title: p.parentTitle ?? p.title,
      body: p.body,
      url: `/family/messages/${conversation.id}${query}`,
      tag: p.tag,
    }),
  ]);
}
