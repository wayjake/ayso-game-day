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
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getCoachUserIds } from "~/utils/family.server";
import { listFamilies, type Family } from "~/utils/parent-invites.server";
import { getOrCreateFamilyConversation, markRead, preview, usersWithPush } from "~/utils/messages.server";
import { sendPush } from "~/utils/push.server";
import { coachFromAddress, escapeHtml, familyDeliveryAddress, sendEmail, textToHtml } from "~/utils/email.server";

// Announcements: one email per family (so opens and replies are tracked per
// family) plus a copy in each family's private thread with the coaches, so
// families on the app see it there and can answer privately.

import { ASKS, MAX_BODY, MAX_SUBJECT, type Ask } from "./announcements";
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
}: {
  teamName: string;
  coachName: string;
  subject: string;
  body: string;
  ask: Ask;
  ackUrl: string;
  reminder: boolean;
}) {
  const askText =
    ask === "ack"
      ? `Tap to let ${coachName} know you've seen this: ${ackUrl}`
      : ask === "reply"
        ? `Please reply to this email. It goes to the coaches only.`
        : "";
  const text = [
    reminder ? "Reminder:" : null,
    body.trim(),
    askText ? `\n${askText}` : null,
    `\n--\n${teamName} · Replies go to the coaches only.`,
  ]
    .filter(Boolean)
    .join("\n");

  const button =
    ask === "ack"
      ? `<p style="margin:24px 0"><a href="${escapeHtml(ackUrl)}" style="display:inline-block;background:#2251c4;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Got it ✓</a></p>`
      : ask === "reply"
        ? `<p style="margin:24px 0;padding:12px 14px;background:#e9eefb;border-radius:10px;color:#1a3e9c">Please reply to this email. It goes to the coaches only.</p>`
        : "";

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">
  <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#64748b">${escapeHtml(teamName)}${reminder ? " · Reminder" : ""}</p>
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3">${escapeHtml(subject)}</h1>
  ${textToHtml(body)}
  ${button}
  <p style="margin:28px 0 0;font-size:12px;color:#64748b">Sent by ${escapeHtml(coachName)} with AYSO Game Day. Replies go to the coaches only.</p>
</div>`;
  return { text, html };
}

async function deliver({
  request,
  recipient,
  announcement,
  teamName,
  coach,
  reminder,
}: {
  request: Request;
  recipient: typeof announcementRecipients.$inferSelect;
  announcement: typeof announcements.$inferSelect;
  teamName: string;
  coach: Pick<User, "id" | "name" | "email" | "sendingEmail">;
  reminder: boolean;
}) {
  const from = coachFromAddress(coach, { id: recipient.teamId, name: teamName });
  const coachName = coach.name?.trim() || "Your coach";
  const { text, html } = announcementEmail({
    teamName,
    coachName,
    subject: announcement.subject,
    body: announcement.body,
    ask: announcement.ask,
    ackUrl: `${appOrigin(request)}/ack/${recipient.ackToken}`,
    reminder,
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
  teamId: number;
  coach: User;
  subject: string;
  body: string;
  ask: Ask;
  familyEmails: string[];
}) {
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const teamName = team?.name ?? "Team";
  const wanted = new Set(familyEmails.map((e) => e.trim().toLowerCase()));
  const families = (await listFamilies(null, teamId)).filter((f) => wanted.has(f.email));
  if (families.length === 0) return null;

  const from = coachFromAddress(coach, { id: teamId, name: teamName });
  const [announcement] = await db
    .insert(announcements)
    .values({ teamId, sentBy: coach.id, subject, body, ask, fromEmail: from.address })
    .returning();

  // Rows first, so a crash mid-send leaves a record of who was and wasn't sent
  const prepared: { recipient: typeof announcementRecipients.$inferSelect; userIds: number[]; conversationId: number }[] = [];
  for (const family of families) {
    const conversation = await getOrCreateFamilyConversation(teamId, family.email, family.userIds[0]);
    const [message] = await db
      .insert(messages)
      .values({ conversationId: conversation.id, senderId: coach.id, body: `${subject}\n\n${body}`, announcementId: announcement.id })
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: message.createdAt, lastMessagePreview: preview(subject) })
      .where(eq(conversations.id, conversation.id));
    await markRead(conversation.id, coach.id, message.id);

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
    const result = await deliver({ request, recipient, announcement, teamName, coach, reminder: false });
    await db
      .update(announcementRecipients)
      .set(
        result.sent
          ? { status: "sent", resendEmailId: result.id ?? null, sentAt: new Date().toISOString(), error: null }
          : { status: "failed", error: result.error ?? "Email failed" }
      )
      .where(eq(announcementRecipients.id, recipient.id));
  });

  await Promise.all(
    prepared
      .filter((p) => p.userIds.length > 0)
      .map((p) =>
        sendPush(p.userIds, {
          title: `${teamName} · ${subject}`,
          body: preview(body, 180),
          url: `/family/messages/${p.conversationId}`,
          tag: `announcement-${announcement.id}`,
        })
      )
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
}: {
  request: Request;
  teamId: number;
  coach: User;
  subject: string;
  body: string;
  ask: Ask;
}) {
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const { text, html } = announcementEmail({
    teamName: team?.name ?? "Team",
    coachName: coach.name?.trim() || "Your coach",
    subject,
    body,
    ask,
    ackUrl: `${appOrigin(request)}/ack/test-preview`,
    reminder: false,
  });
  return sendEmail({ from: coachFromAddress(coach, { id: teamId, name: team?.name ?? "Team" }).header, to: coach.email, subject: `[Test] ${subject}`, text, html });
}

// Families who haven't done what the announcement asked for
export function awaitingResponse(r: RecipientView, ask: Ask) {
  if (r.state === "bounced" || r.state === "failed") return false;
  if (ask === "ack") return !r.acknowledgedAt && !r.repliedAt;
  if (ask === "reply") return !r.repliedAt;
  return !r.openedAt && !r.seenInApp && !r.repliedAt;
}

export async function remindAnnouncement(request: Request, announcementId: number, teamId: number, coach: User) {
  const tracker = await getAnnouncementTracker(announcementId, teamId);
  if (!tracker) return { reminded: 0 };
  const targets = tracker.recipients.filter((r) => awaitingResponse(r, tracker.announcement.ask));
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
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
      coach,
      reminder: true,
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

export async function acknowledgeRecipient(recipientId: number) {
  await db
    .update(announcementRecipients)
    .set({ acknowledgedAt: sql`coalesce(${announcementRecipients.acknowledgedAt}, ${new Date().toISOString()})` })
    .where(eq(announcementRecipients.id, recipientId));
}

// A parent tapping "Got it" on the copy in their thread
export async function acknowledgeFromThread(messageId: number, conversationId: number) {
  const [recipient] = await db
    .select({ id: announcementRecipients.id })
    .from(announcementRecipients)
    .where(and(eq(announcementRecipients.messageId, messageId), eq(announcementRecipients.conversationId, conversationId)))
    .limit(1);
  if (recipient) await acknowledgeRecipient(recipient.id);
  return Boolean(recipient);
}

export async function acknowledgedMessageIds(conversationId: number) {
  const rows = await db
    .select({ messageId: announcementRecipients.messageId })
    .from(announcementRecipients)
    .where(and(eq(announcementRecipients.conversationId, conversationId), sql`${announcementRecipients.acknowledgedAt} is not null`));
  return rows.flatMap((r) => (r.messageId ? [r.messageId] : []));
}

// ---------------------------------------------------------------------------
// Tracker

export type RecipientState = "failed" | "bounced" | "replied" | "acknowledged" | "opened" | "delivered" | "sent" | "pending";

export type RecipientView = {
  id: number;
  familyEmail: string;
  familyLabel: string;
  sentToEmail: string;
  conversationId: number | null;
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
  remindedAt: string | null;
  bouncedAt: string | null;
};

const NOT_OPENED_AFTER_HOURS = 48;

type RecipientRow = typeof announcementRecipients.$inferSelect;

// Read in the app by whoever holds the family's thread now
function isSeenInApp(r: RecipientRow, currentParent: number | null, lastRead: number | null) {
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
export async function familyAnnouncements(teamId: number, familyEmail: string, limit = 4) {
  const rows = await db
    .select({
      r: announcementRecipients,
      subject: announcements.subject,
      ask: announcements.ask,
      createdAt: announcements.createdAt,
      currentParent: conversations.parentUserId,
      lastRead: conversationReads.lastReadMessageId,
    })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .leftJoin(conversations, eq(announcementRecipients.conversationId, conversations.id))
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.conversationId, announcementRecipients.conversationId),
        eq(conversationReads.userId, conversations.parentUserId)
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

export async function getAnnouncementTracker(announcementId: number, teamId: number) {
  if (!Number.isInteger(announcementId)) return null;
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
      needsReply: conversations.needsReply,
      currentParent: conversations.parentUserId,
      lastRead: conversationReads.lastReadMessageId,
    })
    .from(announcementRecipients)
    .leftJoin(conversations, eq(announcementRecipients.conversationId, conversations.id))
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.conversationId, announcementRecipients.conversationId),
        // Whoever holds the thread now, including a family that joined after it was sent
        eq(conversationReads.userId, conversations.parentUserId)
      )
    )
    .where(eq(announcementRecipients.announcementId, announcementId))
    .orderBy(asc(announcementRecipients.familyLabel));

  // The family's latest message after the announcement, for the row preview
  const conversationIds = rows.flatMap((x) => (x.r.conversationId ? [x.r.conversationId] : []));
  const firstMessageId = Math.min(...rows.map((x) => x.r.messageId ?? Infinity));
  const replies = conversationIds.length
    ? await db
        .select({ conversationId: messages.conversationId, body: messages.body, id: messages.id, senderId: messages.senderId })
        .from(messages)
        .where(and(inArray(messages.conversationId, conversationIds), gt(messages.id, Number.isFinite(firstMessageId) ? firstMessageId : 0)))
        .orderBy(desc(messages.id))
    : [];
  const sinceByConversation = new Map(rows.map((x) => [x.r.conversationId, x.r.messageId ?? 0]));
  const coachIds = new Set(await getCoachUserIds(teamId));
  const latestReply = new Map<number, string>();
  for (const m of replies) {
    if (m.senderId != null && coachIds.has(m.senderId)) continue;
    if (m.id <= (sinceByConversation.get(m.conversationId) ?? 0)) continue;
    if (!latestReply.has(m.conversationId)) latestReply.set(m.conversationId, m.body);
  }

  const withPush = await usersWithPush(rows.flatMap((x) => (x.currentParent ? [x.currentParent] : [])));
  const now = Date.now();
  const recipients: RecipientView[] = rows.map(({ r, needsReply, currentParent, lastRead }) => {
    const seenInApp = isSeenInApp(r, currentParent, lastRead);
    const state = recipientState(r, seenInApp);
    const quiet = !r.openedAt && !seenInApp && !r.repliedAt && !r.acknowledgedAt;
    const stale = r.sentAt ? now - new Date(r.sentAt).getTime() > NOT_OPENED_AFTER_HOURS * 3600_000 : false;
    const replyWaiting = Boolean(needsReply && (r.repliedAt || latestReply.has(r.conversationId ?? -1)));

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
      conversationId: r.conversationId,
      onApp: Boolean(currentParent),
      pushReady: Boolean(currentParent && withPush.has(currentParent)),
      state,
      needsYou: needsYouReason !== null,
      needsYouReason,
      needsReply: Boolean(needsReply),
      seenInApp,
      lastReply: r.conversationId ? latestReply.get(r.conversationId) ?? null : null,
      error: r.error,
      bounceReason: r.bounceReason,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      openedAt: r.openedAt,
      repliedAt: r.repliedAt,
      acknowledgedAt: r.acknowledgedAt,
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
  };
}

export async function listAnnouncements(teamId: number) {
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

export async function listFamilyNotes(teamId: number, familyEmail: string) {
  return db
    .select({ id: familyNotes.id, body: familyNotes.body, createdAt: familyNotes.createdAt, authorId: familyNotes.authorId, authorName: users.name, authorEmail: users.email })
    .from(familyNotes)
    .innerJoin(users, eq(familyNotes.authorId, users.id))
    .where(and(eq(familyNotes.teamId, teamId), eq(familyNotes.familyEmail, familyEmail.toLowerCase())))
    .orderBy(desc(familyNotes.id));
}

export async function addFamilyNote(teamId: number, familyEmail: string, authorId: number, body: string) {
  const text = body.trim().slice(0, 2000);
  if (!text) return null;
  const [note] = await db.insert(familyNotes).values({ teamId, familyEmail: familyEmail.toLowerCase(), authorId, body: text }).returning();
  return note;
}

export async function deleteFamilyNote(teamId: number, noteId: number, userId: number) {
  // Coaches can remove their own notes
  await db.delete(familyNotes).where(and(eq(familyNotes.id, noteId), eq(familyNotes.teamId, teamId), eq(familyNotes.authorId, userId)));
}

export async function familyNotesView(teamId: number, familyEmail: string) {
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
export async function handleNoteAction(formData: FormData, teamId: number, userId: number) {
  const intent = formData.get("_action");
  if (intent === "addNote") {
    const familyEmail = String(formData.get("familyEmail") ?? "").trim().toLowerCase();
    if (!familyEmail) return { error: "Missing family" };
    const note = await addFamilyNote(teamId, familyEmail, userId, String(formData.get("body") ?? ""));
    return note ? { ok: true } : { error: "Write a note first" };
  }
  if (intent === "deleteNote") {
    await deleteFamilyNote(teamId, Number(formData.get("noteId")), userId);
    return { ok: true };
  }
  return null;
}
