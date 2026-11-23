import { db, conversations, conversationReads, guardians, messages, players, teams, users } from "~/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getTeamForUser } from "~/utils/team-access.server";
import { getCoachUserIds, getParentUserIds } from "~/utils/family.server";
import { sendPush } from "~/utils/push.server";

// Two kinds of conversation per team:
//   team   - every coach and every linked parent
//   direct - one parent and the team's coaching staff (all coaches see it)

export const MAX_MESSAGE_LENGTH = 2000;

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

async function isGuardianOnTeam(userId: number, teamId: number) {
  const [row] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(and(eq(guardians.userId, userId), eq(guardians.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

// Who may read and post here, and as what. Coaches see every conversation on
// their team; parents see the team chat and their own direct thread.
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
      ne(messages.senderId, userId),
      sql`${messages.id} > coalesce(${conversationReads.lastReadMessageId}, 0)`
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

export async function listCoachConversations(teamId: number, userId: number): Promise<ConversationSummary[]> {
  const team = await getOrCreateTeamConversation(teamId);
  const [teamRow] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);

  const directs = await db
    .select({
      id: conversations.id,
      parentUserId: conversations.parentUserId,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: conversations.lastMessagePreview,
      parentName: users.name,
      parentEmail: users.email,
    })
    .from(conversations)
    .innerJoin(users, eq(conversations.parentUserId, users.id))
    .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct")))
    .orderBy(desc(conversations.lastMessageAt));

  const kids = await kidsByParent(teamId, directs.map((d) => d.parentUserId!));
  const unread = await unreadCounts([team.id, ...directs.map((d) => d.id)], userId);
  const teamName = teamRow?.name ?? "Team";

  return [
    {
      id: team.id,
      teamId,
      teamName,
      kind: "team",
      title: "Team chat",
      subtitle: "Coaches and all families",
      lastMessageAt: team.lastMessageAt,
      lastMessagePreview: team.lastMessagePreview,
      unread: unread.get(team.id) ?? 0,
    },
    // Threads with no messages yet are noise for coaches
    ...directs
      .filter((d) => d.lastMessageAt)
      .map((d): ConversationSummary => ({
        id: d.id,
        teamId,
        teamName,
        kind: "direct",
        title: d.parentName || d.parentEmail,
        subtitle: kids.get(d.parentUserId!) ? `${kids.get(d.parentUserId!)}'s family` : "Family",
        lastMessageAt: d.lastMessageAt,
        lastMessagePreview: d.lastMessagePreview,
        unread: unread.get(d.id) ?? 0,
      })),
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
    });
  }
  return result;
}

export type ThreadMessage = {
  id: number;
  senderId: number;
  senderName: string;
  senderIsCoach: boolean;
  body: string;
  createdAt: string;
};

export async function getThread(conversationId: number, limit = 200): Promise<ThreadMessage[]> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return [];
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(limit);

  const coachIds = new Set(await getCoachUserIds(conversation.teamId));
  return rows.reverse().map((r) => ({
    id: r.id,
    senderId: r.senderId,
    senderName: r.name || r.email.split("@")[0],
    senderIsCoach: coachIds.has(r.senderId),
    body: r.body,
    createdAt: r.createdAt,
  }));
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

function preview(body: string, length = 120) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

// Saves a message, marks it read for the sender, and pushes it to everyone else
// in the conversation. Callers check access first.
export async function postMessage(
  conversation: typeof conversations.$inferSelect,
  sender: { id: number; name: string | null; email: string },
  body: string
) {
  const text = body.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return null;

  const [message] = await db
    .insert(messages)
    .values({ conversationId: conversation.id, senderId: sender.id, body: text })
    .returning();
  await db
    .update(conversations)
    .set({ lastMessageAt: message.createdAt, lastMessagePreview: preview(text) })
    .where(eq(conversations.id, conversation.id));
  await markRead(conversation.id, sender.id, message.id);

  const coachIds = await getCoachUserIds(conversation.teamId);
  const parentIds =
    conversation.kind === "team"
      ? await getParentUserIds(conversation.teamId)
      : conversation.parentUserId
        ? [conversation.parentUserId]
        : [];
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);
  const senderName = sender.name || sender.email.split("@")[0];
  const teamName = team?.name ?? "Team";
  const tag = `conversation-${conversation.id}`;

  // Coaches open it in the dashboard, parents in the family app
  const coachRecipients = coachIds.filter((id) => id !== sender.id);
  const parentRecipients = parentIds.filter((id) => id !== sender.id && !coachIds.includes(id));

  await Promise.all([
    sendPush(coachRecipients, {
      title: conversation.kind === "team" ? `${teamName} · ${senderName}` : `${senderName} (${teamName})`,
      body: preview(text, 180),
      url: `/dashboard/team/${conversation.teamId}/messages/${conversation.id}`,
      tag,
    }),
    sendPush(parentRecipients, {
      title: conversation.kind === "team" ? `${teamName} · ${senderName}` : `${senderName} · Coaches`,
      body: preview(text, 180),
      url: `/family/messages/${conversation.id}`,
      tag,
    }),
  ]);

  return message;
}
