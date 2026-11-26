import crypto from "node:crypto";
import {
  db,
  announcementRecipients,
  announcements,
  conversationReads,
  conversations,
  familyNotes,
  messages,
  teams,
  users,
  type User,
} from "~/db";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getCoachUserIds } from "~/utils/family.server";
import { listFamilies, type Family } from "~/utils/parent-invites.server";
import { familyLabels, getOrCreateFamilyConversation, getOrCreateTeamConversation, markRead, preview, usersWithPush } from "~/utils/messages.server";
import { sendPush } from "~/utils/push.server";
import { publishConversation } from "~/utils/realtime.server";
import { coachFromAddress, escapeHtml, familyDeliveryAddress, sendEmail, textToHtml } from "~/utils/email.server";

// Announcements: one email per family, so opens and replies are tracked per
// family, plus a copy in the app:
//   - Sent to every family on the team: one message in the team chat. Replies,
//     by email too, go in the public thread under it (replies can be seen by
//     every family and coach on the app). Auto-replies stay private.
//   - Sent to some families: a copy in each one's private thread with the
//     sender, and their replies stay there.
// Either way recipients[].conversationId and messageId point at the copy.

import { ASKS, MAX_BODY, MAX_SUBJECT, type Ask } from "./announcements";
import { compareIds, isId, parseId } from "~/utils/ids";
export { ASKS, MAX_BODY, MAX_SUBJECT, type Ask };

function appOrigin(request: Request) {
  return process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export function familyLabel(family: Pick<Family, "parentNames" | "kids" | "email">) {
  const lastName = family.parentNames[0]?.trim().split(/\s+/).slice(-1)[0];
  const kids = family.kids.map((k) => k.name.split(" ")[0]).join(", ");
  return `${lastName || family.email} (${kids})`;
}

// ---------------------------------------------------------------------------
// Email

function announcementEmail({
  teamName,
  coachName,
  subject,
  body,
  ask,
  ackUrl,
  reminder,
  shared,
}: {
  teamName: string;
  coachName: string;
  subject: string;
  body: string;
  ask: Ask;
  ackUrl: string;
  reminder: boolean;
  /** Posted in the team chat: replies are seen by the team, so say so */
  shared: boolean;
}) {
  const whoSees = shared
    ? `Your reply is posted under this announcement in the ${teamName} team chat, where the coaches and families on BenchTalk can see it.`
    : `Only ${coachName} sees your reply.`;
  const askText =
    ask === "ack"
      ? `Tap to let ${coachName} know you've seen this: ${ackUrl}`
      : ask === "reply"
        ? `Please reply to this email. ${whoSees}`
        : "";
  const footer = shared ? `Replies are shared in the team chat.` : `Replies go only to ${coachName}.`;
  const text = [
    reminder ? "Reminder:" : null,
    body.trim(),
    askText ? `\n${askText}` : null,
    `\n--\n${teamName} · ${footer}`,
  ]
    .filter(Boolean)
    .join("\n");

  const button =
    ask === "ack"
      ? `<p style="margin:24px 0"><a href="${escapeHtml(ackUrl)}" style="display:inline-block;background:#2251c4;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Got it ✓</a></p>`
      : ask === "reply"
        ? `<p style="margin:24px 0;padding:12px 14px;background:#e9eefb;border-radius:10px;color:#1a3e9c">Please reply to this email. ${escapeHtml(whoSees)}</p>`
        : "";

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">
  <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#64748b">${escapeHtml(teamName)}${reminder ? " · Reminder" : ""}</p>
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3">${escapeHtml(subject)}</h1>
  ${textToHtml(body)}
  ${button}
  <p style="margin:28px 0 0;font-size:12px;color:#64748b">Sent by ${escapeHtml(coachName)} with BenchTalk. ${escapeHtml(footer)}</p>
</div>`;
  return { text, html };
}

async function deliver({
  request,
  recipient,
  announcement,
  teamName,
  teamCode,
  coach,
  reminder,
  shared,
}: {
  request: Request;
  recipient: typeof announcementRecipients.$inferSelect;
  announcement: typeof announcements.$inferSelect;
  teamName: string;
  teamCode: string;
  coach: Pick<User, "id" | "name" | "email" | "sendingEmail">;
  reminder: boolean;
  shared: boolean;
}) {
  const from = coachFromAddress(coach, { code: teamCode, name: teamName });
  const coachName = coach.name?.trim() || "Your coach";
  const { text, html } = announcementEmail({
    teamName,
    coachName,
    subject: announcement.subject,
    body: announcement.body,
    ask: announcement.ask,
    ackUrl: `${appOrigin(request)}/ack/${recipient.ackToken}`,
    reminder,
    shared,
  });

  return sendEmail({
    from: from.header,
    to: recipient.sentToEmail,
    subject: reminder ? `Reminder: ${announcement.subject}` : announcement.subject,
    text,
    html,
    tags: [{ name: "recipient_id", value: String(recipient.id) }],
    idempotencyKey: `announcement-recipient-${recipient.id}${reminder ? `-reminder-${Date.now()}` : ""}`,
  });
}

// Small pool so 25 families don't take 25 round trips in a row, while staying
// under Resend's 10 requests/second
async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

// ---------------------------------------------------------------------------
// Sending

export async function sendAnnouncement({
  request,
  teamId,
  coach,
  subject,
  body,
  ask,
  familyEmails,
}: {
  request: Request;
  teamId: string;
  coach: User;
  subject: string;
  body: string;
  ask: Ask;
  familyEmails: string[];
}) {
  const [team] = await db.select({ name: teams.name, code: teams.code }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const teamName = team?.name ?? "Team";
  const teamCode = team?.code ?? "";
  const wanted = new Set(familyEmails.map((e) => e.trim().toLowerCase()));
  const everyone = await listFamilies(null, teamId);
  const families = everyone.filter((f) => wanted.has(f.email));
  if (families.length === 0) return null;
  const shared = families.length === everyone.length;

  const from = coachFromAddress(coach, { code: teamCode, name: teamName });
  const [announcement] = await db
    .insert(announcements)
    .values({ teamId, sentBy: coach.id, subject, body, ask, fromEmail: from.address })
    .returning();

  // The copy in the app: once in the team chat when it went to everyone
  const postCopy = async (conversation: typeof conversations.$inferSelect) => {
    const [message] = await db
      .insert(messages)
      .values({ conversationId: conversation.id, senderId: coach.id, body: `${subject}\n\n${body}`, announcementId: announcement.id })
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: message.createdAt, lastMessagePreview: preview(subject) })
      .where(eq(conversations.id, conversation.id));
    await publishConversation(conversation, { kind: "message" });
    await markRead(conversation.id, coach.id, message.id);
    return message;
  };
  const teamChat = shared ? await getOrCreateTeamConversation(teamId) : null;
  const teamCopy = teamChat ? await postCopy(teamChat) : null;

  // Rows first, so a crash mid-send leaves a record of who was and wasn't sent
  const prepared: { recipient: typeof announcementRecipients.$inferSelect; userIds: string[]; conversationId: string }[] = [];
  for (const family of families) {
    // Otherwise each family's copy goes in the sender's private thread with them, and so do their replies
    const conversation = teamChat ?? (await getOrCreateFamilyConversation(teamId, family.email, family.userIds[0], coach.id));
    const message = teamCopy ?? (await postCopy(conversation));

    const [recipient] = await db
      .insert(announcementRecipients)
      .values({
        announcementId: announcement.id,
        teamId,
        familyEmail: family.email,
        familyLabel: familyLabel(family),
        sentToEmail: familyDeliveryAddress(family.email, coach.email),
        parentUserId: family.userIds[0] ?? null,
        conversationId: conversation.id,
        messageId: message.id,
        ackToken: crypto.randomBytes(18).toString("base64url"),
      })
      .returning();
    prepared.push({ recipient, userIds: family.userIds, conversationId: conversation.id });
  }

  await inPool(prepared, 4, async ({ recipient }) => {
    const result = await deliver({ request, recipient, announcement, teamName, teamCode, coach, reminder: false, shared });
    await db
      .update(announcementRecipients)
      .set(
        result.sent
          ? { status: "sent", resendEmailId: result.id ?? null, sentAt: new Date().toISOString(), error: null }
          : { status: "failed", error: result.error ?? "Email failed" }
      )
      .where(eq(announcementRecipients.id, recipient.id));
  });

  // Each parent once, even with kids in two families on the team
  const pushed = new Set<string>();
  await Promise.all(
    prepared.map((p) => {
      const userIds = p.userIds.filter((id) => !pushed.has(id) && id !== coach.id);
      userIds.forEach((id) => pushed.add(id));
      return userIds.length
        ? sendPush(userIds, "team", {
            title: `${teamName} · ${subject}`,
            body: preview(body, 180),
            url: `/family/messages/${p.conversationId}`,
            tag: `announcement-${announcement.id}`,
          })
        : Promise.resolve();
    })
  );

  return announcement;
}

// A preview to the coach's own inbox. Nothing is recorded; the Got it button
// points nowhere real.
export async function sendTestAnnouncement({
  request,
  teamId,
  coach,
  subject,
  body,
  ask,
  familyEmails,
}: {
  request: Request;
  teamId: string;
  coach: User;
  subject: string;
  body: string;
  ask: Ask;
  /** Who it's going to, so the preview says where replies will go */
  familyEmails: string[];
}) {
  const [team] = await db.select({ name: teams.name, code: teams.code }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const everyone = await listFamilies(null, teamId);
  const wanted = new Set(familyEmails.map((e) => e.trim().toLowerCase()));
  const shared = everyone.length > 0 && everyone.every((f) => wanted.has(f.email));
  const { text, html } = announcementEmail({
    teamName: team?.name ?? "Team",
    coachName: coach.name?.trim() || "Your coach",
    subject,
    body,
    ask,
    ackUrl: `${appOrigin(request)}/ack/test-preview`,
    reminder: false,
    shared,
  });
  return sendEmail({ from: coachFromAddress(coach, { code: team?.code ?? "", name: team?.name ?? "Team" }).header, to: coach.email, subject: `[Test] ${subject}`, text, html });
}

// Families who haven't done what the announcement asked for
export function awaitingResponse(r: RecipientView, ask: Ask) {
  if (r.state === "bounced" || r.state === "failed") return false;
  if (ask === "ack") return !r.acknowledgedAt && !r.repliedAt;
  if (ask === "reply") return !r.repliedAt;
  return !r.openedAt && !r.seenInApp && !r.repliedAt;
}

// Only the sender reminds: replies to a reminder land in the sender's private
// threads, so one from anyone else would have families answering the wrong person
export async function remindAnnouncement(request: Request, announcementId: string | null, teamId: string, coach: User) {
  const tracker = await getAnnouncementTracker(announcementId, teamId, coach.id);
  if (!tracker || tracker.announcement.sentBy !== coach.id) return { reminded: 0 };
  const targets = tracker.recipients.filter((r) => awaitingResponse(r, tracker.announcement.ask));
  const [team] = await db.select({ name: teams.name, code: teams.code }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const rows = targets.length
    ? await db.select().from(announcementRecipients).where(inArray(announcementRecipients.id, targets.map((t) => t.id)))
    : [];

  let reminded = 0;
  await inPool(rows, 4, async (recipient) => {
    const result = await deliver({
      request,
      recipient,
      announcement: tracker.announcement,
      teamName: team?.name ?? "Team",
      teamCode: team?.code ?? "",
      coach,
      reminder: true,
      shared: tracker.shared,
    });
    if (result.sent) {
      reminded++;
      await db
        .update(announcementRecipients)
        .set({ remindedAt: new Date().toISOString() })
        .where(eq(announcementRecipients.id, recipient.id));
    }
  });
  return { reminded };
}

// ---------------------------------------------------------------------------
// "Got it"

export async function findRecipientByAckToken(token: string) {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({
      id: announcementRecipients.id,
      teamId: announcementRecipients.teamId,
      familyEmail: announcementRecipients.familyEmail,
      acknowledgedAt: announcementRecipients.acknowledgedAt,
      subject: announcements.subject,
      teamName: teams.name,
      ask: announcements.ask,
    })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .innerJoin(teams, eq(announcementRecipients.teamId, teams.id))
    .where(eq(announcementRecipients.ackToken, token))
    .limit(1);
  return row ?? null;
}

// The first "Got it" counts: its time, who (a parent account, when we know
// one) and where (the app, or the email's link)
export async function acknowledgeRecipient(recipientId: string, by: { userId: string | null; via: "app" | "email" }) {
  const first = sql`${announcementRecipients.acknowledgedAt} is null`;
  await db
    .update(announcementRecipients)
    .set({
      acknowledgedAt: sql`coalesce(${announcementRecipients.acknowledgedAt}, ${new Date().toISOString()})`,
      acknowledgedBy: sql`case when ${first} then ${by.userId} else ${announcementRecipients.acknowledgedBy} end`,
      acknowledgedVia: sql`case when ${first} then ${by.via} else ${announcementRecipients.acknowledgedVia} end`,
    })
    .where(eq(announcementRecipients.id, recipientId));
}

/** Whether this signed-in person is one of the family an announcement row was sent to */
export async function isInRecipientFamily(teamId: string, familyEmail: string, userId: string) {
  const family = (await listFamilies(null, teamId)).find((f) => f.email === familyEmail);
  return Boolean(family?.userIds.includes(userId));
}

// Display names for "Got it": the parent account that tapped it, or for a tap
// on the email's link without one, the family contact the email went to
async function acknowledgerNames(
  teamId: string,
  rows: { id: string; familyEmail: string; acknowledgedAt: string | null; acknowledgedBy: string | null }[]
) {
  const result = new Map<string, string>();
  const acked = rows.filter((r) => r.acknowledgedAt);
  if (acked.length === 0) return result;
  const userIds = [...new Set(acked.flatMap((r) => (r.acknowledgedBy ? [r.acknowledgedBy] : [])))];
  const people = userIds.length
    ? new Map((await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name || u.email]))
    : new Map<string, string>();
  const anonymous = acked.filter((r) => !r.acknowledgedBy || !people.has(r.acknowledgedBy)).map((r) => r.familyEmail);
  const labels = await familyLabels(teamId, [...new Set(anonymous)]);
  for (const r of acked) {
    result.set(r.id, (r.acknowledgedBy && people.get(r.acknowledgedBy)) || labels.get(r.familyEmail)?.names[0] || r.familyEmail);
  }
  return result;
}

export type AckSummary = { announcementId: string; total: number; names: string[] };

/** Staff, under announcement copies that asked for "Got it": who has, by name, and out of how many */
export async function ackSummaries(teamId: string, messageIds: string[]) {
  const result: Record<string, AckSummary> = {};
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({
      id: announcementRecipients.id,
      messageId: announcementRecipients.messageId,
      announcementId: announcementRecipients.announcementId,
      familyEmail: announcementRecipients.familyEmail,
      acknowledgedAt: announcementRecipients.acknowledgedAt,
      acknowledgedBy: announcementRecipients.acknowledgedBy,
    })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .where(and(eq(announcementRecipients.teamId, teamId), inArray(announcementRecipients.messageId, messageIds), eq(announcements.ask, "ack")))
    .orderBy(asc(announcementRecipients.acknowledgedAt));
  const names = await acknowledgerNames(teamId, rows);
  for (const r of rows) {
    const entry = (result[r.messageId!] ??= { announcementId: r.announcementId, total: 0, names: [] });
    entry.total += 1;
    const name = names.get(r.id);
    if (name && !entry.names.includes(name)) entry.names.push(name);
  }
  return result;
}

// The announcement rows that are this parent's in a conversation. In their
// private thread that's every row there; in the team chat everyone shares one
// copy, so only rows for a family they belong to (by account or family email).
async function parentRecipients(conversation: typeof conversations.$inferSelect, userId: string) {
  if (conversation.kind === "direct") return eq(announcementRecipients.conversationId, conversation.id);
  const emails = (await listFamilies(null, conversation.teamId)).filter((f) => f.userIds.includes(userId)).map((f) => f.email);
  const mine = emails.length
    ? sql`(${announcementRecipients.parentUserId} = ${userId} or ${inArray(announcementRecipients.familyEmail, emails)})`
    : eq(announcementRecipients.parentUserId, userId);
  return and(eq(announcementRecipients.conversationId, conversation.id), mine);
}

// A parent tapping "Got it" on the copy in their thread or the team chat
export async function acknowledgeFromThread(messageId: string | null, conversation: typeof conversations.$inferSelect, userId: string) {
  if (conversation.kind === "group" || !messageId) return false;
  const rows = await db
    .select({ id: announcementRecipients.id })
    .from(announcementRecipients)
    .where(and(eq(announcementRecipients.messageId, messageId), await parentRecipients(conversation, userId)));
  for (const r of rows) await acknowledgeRecipient(r.id, { userId, via: "app" });
  return rows.length > 0;
}

/** Announcement copies this parent has answered "Got it" to here */
export async function acknowledgedMessageIds(conversation: typeof conversations.$inferSelect, userId: string) {
  if (conversation.kind === "group") return []; // Announcements never land in a group
  const rows = await db
    .select({ messageId: announcementRecipients.messageId })
    .from(announcementRecipients)
    .where(and(await parentRecipients(conversation, userId), sql`${announcementRecipients.acknowledgedAt} is not null`));
  return [...new Set(rows.flatMap((r) => (r.messageId ? [r.messageId] : [])))];
}

// ---------------------------------------------------------------------------
// Tracker

export type RecipientState = "failed" | "bounced" | "replied" | "acknowledged" | "opened" | "delivered" | "sent" | "pending";

export type RecipientView = {
  id: string;
  familyEmail: string;
  familyLabel: string;
  sentToEmail: string;
  /** Where the copy is: the team chat, or the family's private thread with the sender (null unless the viewer sent it) */
  conversationId: string | null;
  /** The viewer sent this announcement, so the family's thread (and its replies) is theirs */
  mine: boolean;
  /** Posted in the team chat: replies are public, under the announcement */
  inTeamChat: boolean;
  /** The copy in the app (the team chat message, or the one in their private thread) */
  messageId: string | null;
  onApp: boolean;
  /** Gets a push for messages in their thread, so a coach's reply needn't be emailed */
  pushReady: boolean;
  state: RecipientState;
  needsYou: boolean;
  needsYouReason: string | null;
  needsReply: boolean;
  seenInApp: boolean;
  lastReply: string | null;
  error: string | null;
  bounceReason: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  acknowledgedAt: string | null;
  /** Who tapped "Got it": a parent's name, or the family contact the email went to */
  acknowledgedBy: string | null;
  acknowledgedVia: "app" | "email" | null;
  remindedAt: string | null;
  bouncedAt: string | null;
};

const NOT_OPENED_AFTER_HOURS = 48;

type RecipientRow = typeof announcementRecipients.$inferSelect;

// Read in the app by whoever holds the family's thread now
// The parent account whose reading counts as "seen in the app": whoever holds
// the private thread now (a family that joined after it was sent included),
// or for a team chat copy, the parent the row was sent to
const appParent = sql<string | null>`coalesce(case when ${conversations.kind} = 'direct' then ${conversations.parentUserId} end, ${announcementRecipients.parentUserId})`;

function isSeenInApp(r: RecipientRow, currentParent: string | null, lastRead: string | null) {
  return Boolean(currentParent && r.messageId && lastRead != null && lastRead >= r.messageId);
}

function recipientState(r: RecipientRow, seenInApp: boolean): RecipientState {
  return r.status === "failed" ? "failed"
    : r.bouncedAt ? "bounced"
    : r.repliedAt ? "replied"
    : r.acknowledgedAt ? "acknowledged"
    : r.openedAt || seenInApp ? "opened"
    : r.deliveredAt ? "delivered"
    : r.status === "sent" ? "sent"
    : "pending";
}

// The latest announcements one family got, with what happened to each, using
// the same rules as the tracker
export async function familyAnnouncements(teamId: string, familyEmail: string, limit = 4) {
  const rows = await db
    .select({
      r: announcementRecipients,
      subject: announcements.subject,
      ask: announcements.ask,
      createdAt: announcements.createdAt,
      currentParent: appParent,
      lastRead: conversationReads.lastReadMessageId,
    })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .leftJoin(conversations, eq(announcementRecipients.conversationId, conversations.id))
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.conversationId, announcementRecipients.conversationId),
        eq(conversationReads.userId, appParent)
      )
    )
    .where(and(eq(announcementRecipients.teamId, teamId), eq(announcementRecipients.familyEmail, familyEmail.toLowerCase())))
    .orderBy(desc(announcementRecipients.id))
    .limit(limit);
  return rows.map(({ r, subject, ask, createdAt, currentParent, lastRead }) => ({
    id: r.announcementId,
    subject,
    ask,
    createdAt,
    state: recipientState(r, isSeenInApp(r, currentParent, lastRead)),
  }));
}

// Every staff member can follow delivery, opens and "Got it". What a family
// wrote back is in their private thread with the sender, so only the sender
// sees replies (`mine` on each recipient).
export async function getAnnouncementTracker(announcementId: string | null, teamId: string, viewerId: string) {
  if (!isId(announcementId)) return null;
  const [announcement] = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.id, announcementId), eq(announcements.teamId, teamId)))
    .limit(1);
  if (!announcement) return null;

  const [sender] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, announcement.sentBy)).limit(1);

  const rows = await db
    .select({
      r: announcementRecipients,
      kind: conversations.kind,
      needsReply: conversations.needsReply,
      currentParent: appParent,
      staffUserId: conversations.staffUserId,
      lastRead: conversationReads.lastReadMessageId,
    })
    .from(announcementRecipients)
    .leftJoin(conversations, eq(announcementRecipients.conversationId, conversations.id))
    .leftJoin(
      conversationReads,
      and(eq(conversationReads.conversationId, announcementRecipients.conversationId), eq(conversationReads.userId, appParent))
    )
    .where(eq(announcementRecipients.announcementId, announcementId))
    .orderBy(asc(announcementRecipients.familyLabel));
  const shared = rows.some((x) => x.kind === "team");

  // The family's latest reply, for the row preview. In their private thread
  // with the sender: anything they wrote after the copy (sender only). In the
  // team chat: their replies under the announcement, which everyone can see.
  const latestReply = new Map<string, { body: string; at: string }>(); // by recipient id
  const privateRows = rows.filter((x) => x.kind === "direct" && x.r.conversationId && x.staffUserId === viewerId);
  if (privateRows.length) {
    const conversationIds = privateRows.map((x) => x.r.conversationId!);
    // Ids sort by time, so the oldest copy is the lowest id
    const firstMessageId = privateRows.flatMap((x) => (x.r.messageId ? [x.r.messageId] : [])).sort(compareIds)[0] ?? "";
    const replies = await db
      .select({ conversationId: messages.conversationId, body: messages.body, id: messages.id, senderId: messages.senderId, at: messages.createdAt })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, conversationIds),
        gt(messages.id, firstMessageId),
        isNull(messages.deletedAt)
      ))
      .orderBy(desc(messages.id));
    const coachIds = new Set(await getCoachUserIds(teamId));
    for (const x of privateRows) {
      const reply = replies.find(
        (m) => m.conversationId === x.r.conversationId && m.id > (x.r.messageId ?? "") && !(m.senderId != null && coachIds.has(m.senderId))
      );
      if (reply) latestReply.set(x.r.id, { body: reply.body, at: reply.at });
    }
  }
  const copyIds = [...new Set(rows.filter((x) => x.kind === "team" && x.r.messageId).map((x) => x.r.messageId!))];
  if (copyIds.length) {
    const familyUsers = new Map((await listFamilies(null, teamId)).map((f) => [f.email, f.userIds]));
    const replies = await db
      .select({ parentId: messages.parentId, body: messages.body, senderId: messages.senderId, senderEmail: messages.senderEmail, at: messages.createdAt })
      .from(messages)
      .where(and(inArray(messages.parentId, copyIds), isNull(messages.deletedAt)))
      .orderBy(desc(messages.id));
    for (const x of rows) {
      if (x.kind !== "team") continue;
      const userIds = familyUsers.get(x.r.familyEmail) ?? [];
      const reply = replies.find(
        (m) =>
          m.parentId === x.r.messageId &&
          ((m.senderId != null && (userIds.includes(m.senderId) || m.senderId === x.r.parentUserId)) ||
            m.senderEmail?.toLowerCase() === x.r.familyEmail)
      );
      if (reply) latestReply.set(x.r.id, { body: reply.body, at: reply.at });
    }
  }

  const withPush = await usersWithPush(rows.flatMap((x) => (x.currentParent ? [x.currentParent] : [])));
  const ackNames = await acknowledgerNames(teamId, rows.map((x) => x.r));
  const now = Date.now();
  const recipients: RecipientView[] = rows.map(({ r: row, kind, needsReply, currentParent, staffUserId, lastRead }) => {
    const inTeamChat = kind === "team";
    // A reply in the app under a team chat announcement counts like one by email
    const r = inTeamChat && !row.repliedAt && latestReply.has(row.id) ? { ...row, repliedAt: latestReply.get(row.id)!.at } : row;
    const mine = !inTeamChat && staffUserId === viewerId;
    const seenInApp = isSeenInApp(r, currentParent, lastRead);
    const state = recipientState(r, seenInApp);
    const quiet = !r.openedAt && !seenInApp && !r.repliedAt && !r.acknowledgedAt;
    const stale = r.sentAt ? now - new Date(r.sentAt).getTime() > NOT_OPENED_AFTER_HOURS * 3600_000 : false;
    const replyWaiting = mine && Boolean(needsReply && (r.repliedAt || latestReply.has(r.id)));

    let needsYouReason: string | null = null;
    if (state === "failed") needsYouReason = "Email didn't send";
    else if (state === "bounced") needsYouReason = "Bad email address";
    else if (replyWaiting) needsYouReason = "Reply waiting";
    else if (quiet && stale && state !== "pending") needsYouReason = `No response after ${NOT_OPENED_AFTER_HOURS} hours`;

    return {
      id: r.id,
      familyEmail: r.familyEmail,
      familyLabel: r.familyLabel,
      sentToEmail: r.sentToEmail,
      conversationId: inTeamChat || mine ? r.conversationId : null,
      messageId: r.messageId,
      mine,
      inTeamChat,
      onApp: Boolean(currentParent),
      pushReady: Boolean(currentParent && withPush.has(currentParent)),
      state,
      needsYou: needsYouReason !== null,
      needsYouReason,
      needsReply: mine && Boolean(needsReply),
      seenInApp,
      lastReply: latestReply.get(r.id)?.body ?? null,
      error: r.error,
      bounceReason: r.bounceReason,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      openedAt: r.openedAt,
      repliedAt: r.repliedAt,
      acknowledgedAt: r.acknowledgedAt,
      acknowledgedBy: ackNames.get(r.id) ?? null,
      acknowledgedVia: r.acknowledgedVia,
      remindedAt: r.remindedAt,
      bouncedAt: r.bouncedAt,
    };
  });

  const count = (fn: (r: RecipientView) => boolean) => recipients.filter(fn).length;
  const stats = {
    total: recipients.length,
    delivered: count((r) => Boolean(r.deliveredAt) || ["opened", "replied", "acknowledged"].includes(r.state)),
    opened: count((r) => Boolean(r.openedAt) || r.seenInApp || r.state === "replied" || r.state === "acknowledged"),
    emailOpens: count((r) => Boolean(r.openedAt)),
    replied: count((r) => Boolean(r.repliedAt)),
    acknowledged: count((r) => Boolean(r.acknowledgedAt)),
    bounced: count((r) => r.state === "bounced" || r.state === "failed"),
    needsYou: count((r) => r.needsYou),
    awaiting: count((r) => awaitingResponse(r, announcement.ask)),
    // Did what was asked: a reply also answers a "Got it" request
    responded: count((r) =>
      announcement.ask === "ack" ? Boolean(r.acknowledgedAt || r.repliedAt)
      : announcement.ask === "reply" ? Boolean(r.repliedAt)
      : Boolean(r.openedAt || r.seenInApp || r.repliedAt || r.acknowledgedAt)
    ),
  };

  return {
    announcement,
    senderName: sender?.name || sender?.email || "Coach",
    recipients,
    stats,
    /** Posted in the team chat (sent to every family) */
    shared,
  };
}

export async function listAnnouncements(teamId: string) {
  const rows = await db
    .select({
      id: announcements.id,
      subject: announcements.subject,
      ask: announcements.ask,
      createdAt: announcements.createdAt,
      total: sql<number>`count(${announcementRecipients.id})`,
      opened: sql<number>`sum(case when ${announcementRecipients.openedAt} is not null then 1 else 0 end)`,
      replied: sql<number>`sum(case when ${announcementRecipients.repliedAt} is not null then 1 else 0 end)`,
      acknowledged: sql<number>`sum(case when ${announcementRecipients.acknowledgedAt} is not null then 1 else 0 end)`,
      problems: sql<number>`sum(case when ${announcementRecipients.bouncedAt} is not null or ${announcementRecipients.status} = 'failed' then 1 else 0 end)`,
    })
    .from(announcements)
    .leftJoin(announcementRecipients, eq(announcementRecipients.announcementId, announcements.id))
    .where(eq(announcements.teamId, teamId))
    .groupBy(announcements.id)
    .orderBy(desc(announcements.id));
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
    opened: Number(r.opened ?? 0),
    replied: Number(r.replied ?? 0),
    acknowledged: Number(r.acknowledged ?? 0),
    problems: Number(r.problems ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Coach-only family notes

export async function listFamilyNotes(teamId: string, familyEmail: string) {
  return db
    .select({ id: familyNotes.id, body: familyNotes.body, createdAt: familyNotes.createdAt, authorId: familyNotes.authorId, authorName: users.name, authorEmail: users.email })
    .from(familyNotes)
    .innerJoin(users, eq(familyNotes.authorId, users.id))
    .where(and(eq(familyNotes.teamId, teamId), eq(familyNotes.familyEmail, familyEmail.toLowerCase())))
    .orderBy(desc(familyNotes.id));
}

export async function addFamilyNote(teamId: string, familyEmail: string, authorId: string, body: string) {
  const text = body.trim().slice(0, 2000);
  if (!text) return null;
  const [note] = await db.insert(familyNotes).values({ teamId, familyEmail: familyEmail.toLowerCase(), authorId, body: text }).returning();
  return note;
}

export async function deleteFamilyNote(teamId: string, noteId: string, userId: string) {
  // Coaches can remove their own notes
  await db.delete(familyNotes).where(and(eq(familyNotes.id, noteId), eq(familyNotes.teamId, teamId), eq(familyNotes.authorId, userId)));
}

export async function familyNotesView(teamId: string, familyEmail: string) {
  const rows = await listFamilyNotes(teamId, familyEmail);
  return rows.map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.createdAt,
    authorId: n.authorId,
    authorName: n.authorName || n.authorEmail.split("@")[0],
  }));
}

// Shared by every page that shows FamilyNotes. Returns null when the form
// wasn't a notes action.
export async function handleNoteAction(formData: FormData, teamId: string, userId: string) {
  const intent = formData.get("_action");
  if (intent === "addNote") {
    const familyEmail = String(formData.get("familyEmail") ?? "").trim().toLowerCase();
    if (!familyEmail) return { error: "Missing family" };
    const note = await addFamilyNote(teamId, familyEmail, userId, String(formData.get("body") ?? ""));
    return note ? { ok: true } : { error: "Write a note first" };
  }
  if (intent === "deleteNote") {
    const noteId = parseId(formData.get("noteId"));
    if (noteId) await deleteFamilyNote(teamId, noteId, userId);
    return { ok: true };
  }
  return null;
}
