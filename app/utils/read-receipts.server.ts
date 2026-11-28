import { db, conversationMembers, conversationReadMarks, conversationReads, type Conversation } from "~/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getCoachUserIds, getParentUserIds, getUserNames } from "~/utils/family.server";
import type { ReadReceipts } from "~/utils/read-receipts";
import { conversationReaderIds, latestMessageId, markRead } from "~/utils/messages.server";
import { publishConversation } from "~/utils/realtime.server";

// Who has read how far in a conversation, for read receipts. Sent once per
// conversation; the browser works out each message's readers from it
// (utils/read-receipts.ts), so a poll doesn't carry a list per message.
//
// Only people in the conversation now count. Read rows can outlive access (a
// coach who opened a direct thread before threads became one-to-one, a group
// member who left), and they must not show up as readers.

async function participants(conversation: Conversation) {
  if (conversation.kind === "direct") {
    return [conversation.staffUserId, conversation.parentUserId].filter((id): id is string => id != null);
  }
  if (conversation.kind === "group") {
    const rows = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversation.id), isNotNull(conversationMembers.userId)));
    return rows.map((r) => r.userId!);
  }
  // Whoever can read it now, by its audience
  if (conversation.kind === "channel") return conversationReaderIds(conversation);
  const [staff, parents] = await Promise.all([getCoachUserIds(conversation.teamId), getParentUserIds(conversation.teamId)]);
  return [...new Set([...staff, ...parents])];
}

// Everything in the conversation counts as read once its page loads. When
// that moves this person's marker in a direct thread, group or private
// channel, the others' open pages reload to show the read receipt. Not in the
// team chat or other channels: everyone reloading on every read would be too
// much, and their polling covers it.
const livesReceipts = (c: Conversation) => c.kind === "direct" || c.kind === "group" || (c.kind === "channel" && c.audience === "private");

export async function markConversationRead(conversation: Conversation, userId: string) {
  const moved = await markRead(conversation.id, userId, await latestMessageId(conversation.id));
  if (moved && livesReceipts(conversation)) await publishConversation(conversation, { kind: "read" });
}

export async function getReadReceipts(conversation: Conversation): Promise<ReadReceipts> {
  const ids = await participants(conversation);
  if (ids.length === 0) return { kind: conversation.kind, participants: 0, readers: [] };

  const [reads, marks, names] = await Promise.all([
    db
      .select({ userId: conversationReads.userId, upTo: conversationReads.lastReadMessageId })
      .from(conversationReads)
      .where(and(eq(conversationReads.conversationId, conversation.id), inArray(conversationReads.userId, ids))),
    db
      .select({ userId: conversationReadMarks.userId, upTo: conversationReadMarks.upToMessageId, at: conversationReadMarks.readAt })
      .from(conversationReadMarks)
      .where(and(eq(conversationReadMarks.conversationId, conversation.id), inArray(conversationReadMarks.userId, ids)))
      .orderBy(asc(conversationReadMarks.upToMessageId), asc(conversationReadMarks.readAt)),
    getUserNames(ids),
  ]);

  return {
    kind: conversation.kind,
    participants: ids.length,
    readers: reads
      .flatMap((r) => (r.upTo ? [{ ...r, upTo: r.upTo }] : [])) // No marker: read nothing yet
      .map((r) => ({
        userId: r.userId,
        name: names.get(r.userId) ?? "Someone",
        upTo: r.upTo,
        marks: marks.filter((m) => m.userId === r.userId).map((m) => [m.upTo, m.at] as [string, string]),
      })),
  };
}
