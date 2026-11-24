import {
  db,
  announcementRecipients,
  announcements,
  contacts,
  conversations,
  guardians,
  inboundEmails,
  messages,
  parentInvites,
  players,
  users,
} from "~/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getReceivedEmail, parseCoachTeamAddress } from "~/utils/email.server";
import {
  authenticationPassed,
  getHeader,
  htmlToText,
  isAutoReply,
  normalizeMessageId,
  parseAddress,
  referencedMessageIds,
  stripQuotedReply,
} from "~/utils/email-reply";
import { MAX_EMAIL_MESSAGE_LENGTH, getOrCreateFamilyConversation, preview } from "~/utils/messages.server";
import { getCoachUserIds } from "~/utils/family.server";
import { sendPush } from "~/utils/push.server";

// Everything that comes back from Resend: delivery events for mail we sent,
// and email received on the domain.

type WebhookEvent = {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    message_id?: string;
    tags?: Record<string, string> | { name: string; value: string }[];
    bounce?: { message?: string; type?: string; subType?: string };
    failed?: { reason?: string };
    [key: string]: unknown;
  };
};

function tag(event: WebhookEvent, name: string) {
  const tags = event.data.tags;
  if (!tags) return null;
  if (Array.isArray(tags)) return tags.find((t) => t.name === name)?.value ?? null;
  return tags[name] ?? null;
}

// The recipient row an event is about: by our tag, or by Resend's email id
async function recipientFor(event: WebhookEvent) {
  const id = Number(tag(event, "recipient_id"));
  if (Number.isInteger(id) && id > 0) {
    const [row] = await db.select().from(announcementRecipients).where(eq(announcementRecipients.id, id)).limit(1);
    if (row) return row;
  }
  if (!event.data.email_id) return null;
  const [row] = await db.select().from(announcementRecipients).where(eq(announcementRecipients.resendEmailId, event.data.email_id)).limit(1);
  return row ?? null;
}

// Each send (the announcement and any reminders) has its own Message-ID; keep
// them all so a reply to any of them matches
function withMessageId(existing: string | null, messageId: string | undefined) {
  if (!messageId) return existing;
  const id = normalizeMessageId(messageId);
  const ids = (existing ?? "").split(" ").filter(Boolean);
  return ids.includes(id) ? existing : [...ids, id].join(" ");
}

function toDbTimestamp(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 19).replace("T", " ") : date.toISOString().slice(0, 19).replace("T", " ");
}

// Timestamps only ever fill in once, so out-of-order events can't undo each other
const firstTime = (column: unknown, at: string) => sql`coalesce(${column}, ${at})`;

export async function handleWebhookEvent(event: WebhookEvent) {
  if (event.type === "email.received") {
    if (event.data.email_id) await receiveEmail(event.data.email_id);
    return;
  }

  const at = event.created_at || new Date().toISOString();
  const recipient = await recipientFor(event);

  if (recipient) {
    const emailMessageId = withMessageId(recipient.emailMessageId, event.data.message_id);
    switch (event.type) {
      case "email.sent":
        await db.update(announcementRecipients).set({ emailMessageId }).where(eq(announcementRecipients.id, recipient.id));
        break;
      case "email.delivered":
        await db
          .update(announcementRecipients)
          .set({ emailMessageId, deliveredAt: firstTime(announcementRecipients.deliveredAt, at) })
          .where(eq(announcementRecipients.id, recipient.id));
        break;
      case "email.opened":
        await db
          .update(announcementRecipients)
          .set({ emailMessageId, openedAt: firstTime(announcementRecipients.openedAt, at) })
          .where(eq(announcementRecipients.id, recipient.id));
        break;
      case "email.bounced":
        // Temporary bounces are retried by the receiving server; only permanent ones mean a bad address
        if (event.data.bounce?.type && event.data.bounce.type !== "Permanent") break;
        await db
          .update(announcementRecipients)
          .set({ bouncedAt: firstTime(announcementRecipients.bouncedAt, at), bounceReason: event.data.bounce?.message?.slice(0, 500) ?? "Bounced" })
          .where(eq(announcementRecipients.id, recipient.id));
        break;
      case "email.complained":
        await db
          .update(announcementRecipients)
          .set({ complainedAt: firstTime(announcementRecipients.complainedAt, at) })
          .where(eq(announcementRecipients.id, recipient.id));
        break;
      case "email.failed":
        await db
          .update(announcementRecipients)
          .set({ status: "failed", error: event.data.failed?.reason ?? "Email failed" })
          .where(eq(announcementRecipients.id, recipient.id));
        break;
    }
    return;
  }

  // A coach's reply that went out by email: remember its Message-ID for threading
  const messageTag = Number(tag(event, "message_id"));
  if (event.data.message_id && (event.type === "email.sent" || event.type === "email.delivered")) {
    const where = Number.isInteger(messageTag) && messageTag > 0
      ? eq(messages.id, messageTag)
      : event.data.email_id
        ? eq(messages.resendEmailId, event.data.email_id)
        : null;
    if (where) await db.update(messages).set({ emailMessageId: normalizeMessageId(event.data.message_id) }).where(where);
  }
}

// ---------------------------------------------------------------------------
// Matching a received email to a family

type Match = {
  teamId: number;
  familyEmail: string;
  recipientId: number | null;
  conversationId: number | null;
  by: "headers" | "sender";
};

// 1. Headers: it answers an email we sent (announcement, reminder, or reply)
async function matchByHeaders(refs: string[]): Promise<Match | null> {
  if (refs.length === 0) return null;
  for (const ref of refs) {
    const [recipient] = await db
      .select()
      .from(announcementRecipients)
      .where(sql`instr(' ' || ${announcementRecipients.emailMessageId} || ' ', ${` ${ref} `}) > 0`)
      .orderBy(desc(announcementRecipients.id))
      .limit(1);
    if (recipient) {
      return { teamId: recipient.teamId, familyEmail: recipient.familyEmail, recipientId: recipient.id, conversationId: recipient.conversationId, by: "headers" };
    }
    const [message] = await db
      .select({ conversationId: messages.conversationId, teamId: conversations.teamId, familyEmail: conversations.familyEmail, emailedTo: messages.emailedTo })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(messages.emailMessageId, ref))
      .limit(1);
    if (message) {
      const familyEmail = message.familyEmail ?? message.emailedTo;
      if (familyEmail) return { teamId: message.teamId, familyEmail, recipientId: null, conversationId: message.conversationId, by: "headers" };
    }
  }
  return null;
}

// 2. Sender: a family writing fresh. Only trusted when the email passed
// SPF/DKIM/DMARC, so nobody can drop a message into a family's thread by
// faking their address.
async function matchBySender(address: string, subject: string | null, ownerUserId: number | null, toTeamId: number | null): Promise<Match | null> {
  const teamRows = await db
    .selectDistinct({ teamId: contacts.teamId })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(sql`lower(trim(${contacts.email})) = ${address}`, eq(players.teamId, contacts.teamId)));
  let teamIds = teamRows.map((r) => r.teamId);
  if (teamIds.length === 0) return null;

  // Sent to a coach+team address: that team, if the family is on it
  if (toTeamId && teamIds.includes(toTeamId)) teamIds = [toTeamId];

  // Sent to a particular coach's address: prefer that coach's teams
  if (ownerUserId && teamIds.length > 1) {
    const mine: number[] = [];
    for (const teamId of teamIds) if ((await getCoachUserIds(teamId)).includes(ownerUserId)) mine.push(teamId);
    if (mine.length > 0) teamIds = mine;
  }

  // Most recent announcement to this family picks the team. It only counts as
  // a reply to that announcement when the subject says so ("Re: Picture day").
  const [recent] = await db
    .select({ teamId: announcementRecipients.teamId, id: announcementRecipients.id, conversationId: announcementRecipients.conversationId, subject: announcements.subject })
    .from(announcementRecipients)
    .innerJoin(announcements, eq(announcementRecipients.announcementId, announcements.id))
    .where(and(eq(announcementRecipients.familyEmail, address), inArray(announcementRecipients.teamId, teamIds)))
    .orderBy(desc(announcementRecipients.id))
    .limit(1);
  if (recent) {
    const answers = baseSubject(subject) === baseSubject(recent.subject);
    return { teamId: recent.teamId, familyEmail: address, recipientId: answers ? recent.id : null, conversationId: recent.conversationId, by: "sender" };
  }
  return { teamId: teamIds[0], familyEmail: address, recipientId: null, conversationId: null, by: "sender" };
}

const baseSubject = (subject: string | null) =>
  (subject ?? "").replace(/^\s*((re|fwd?|aw|sv)\s*:\s*|reminder:\s*)+/i, "").trim().toLowerCase();

// The parent account for a family email on a team, if they've joined. Only
// proven links count: an account with that email, or the one that accepted
// that email's invite.
async function familyUserId(teamId: number, familyEmail: string) {
  const [byEmail] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(guardians, and(eq(guardians.userId, users.id), eq(guardians.teamId, teamId)))
    .where(sql`lower(${users.email}) = ${familyEmail}`)
    .limit(1);
  if (byEmail) return byEmail.id;
  const [invite] = await db
    .select({ id: parentInvites.acceptedBy })
    .from(parentInvites)
    .where(and(eq(parentInvites.teamId, teamId), eq(parentInvites.email, familyEmail), eq(parentInvites.status, "accepted")))
    .orderBy(desc(parentInvites.id))
    .limit(1);
  return invite?.id ?? null;
}

// Puts an email into a family's thread and updates the tracker
async function fileIntoThread(inbound: typeof inboundEmails.$inferSelect, match: Omit<Match, "by"> & { by: string }) {
  const userId = await familyUserId(match.teamId, match.familyEmail);
  const conversation = match.conversationId
    ? (await db.select().from(conversations).where(eq(conversations.id, match.conversationId)).limit(1))[0] ??
      (await getOrCreateFamilyConversation(match.teamId, match.familyEmail, userId))
    : await getOrCreateFamilyConversation(match.teamId, match.familyEmail, userId);

  const full = inbound.text ?? "";
  const { body } = stripQuotedReply(full);
  const text = (body || inbound.subject || "(empty email)").slice(0, MAX_EMAIL_MESSAGE_LENGTH);

  // Written by the family's own account address: show it as theirs
  let senderId: number | null = null;
  if (userId) {
    const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (account && account.email.toLowerCase() === inbound.fromEmail) senderId = userId;
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      senderId,
      senderEmail: inbound.fromEmail,
      senderName: inbound.fromName,
      source: "email",
      body: text,
      inboundEmailId: inbound.id,
      emailMessageId: inbound.emailMessageId,
      // Same format as CURRENT_TIMESTAMP, so threads sort and display alike
      createdAt: toDbTimestamp(inbound.receivedAt),
    })
    .returning();

  await db
    .update(conversations)
    .set({
      // A late-sorted email can be older than the thread's latest message
      lastMessageAt: sql`max(coalesce(${conversations.lastMessageAt}, ''), ${message.createdAt})`,
      lastMessagePreview: sql`case when coalesce(${conversations.lastMessageAt}, '') > ${message.createdAt} then ${conversations.lastMessagePreview} else ${preview(text)} end`,
      // An out-of-office shouldn't flag the thread
      ...(inbound.isAutoReply ? {} : { needsReply: true }),
    })
    .where(eq(conversations.id, conversation.id));

  if (match.recipientId && !inbound.isAutoReply) {
    await db
      .update(announcementRecipients)
      .set({ repliedAt: sql`coalesce(${announcementRecipients.repliedAt}, ${inbound.receivedAt})` })
      .where(eq(announcementRecipients.id, match.recipientId));
  }

  await db
    .update(inboundEmails)
    .set({ status: "matched", matchedBy: match.by, teamId: match.teamId, conversationId: conversation.id, recipientId: match.recipientId })
    .where(eq(inboundEmails.id, inbound.id));

  if (!inbound.isAutoReply) {
    const who = inbound.fromName || inbound.fromEmail;
    await sendPush(await getCoachUserIds(match.teamId), {
      title: `${who} replied by email`,
      body: preview(text, 180),
      url: `/dashboard/team/${match.teamId}/messages/${conversation.id}`,
      tag: `conversation-${conversation.id}`,
    });
  }
  return conversation;
}

async function coachTeamFromAddresses(to: string[]) {
  for (const address of to) {
    const parsed = parseCoachTeamAddress(address);
    if (parsed && (await getCoachUserIds(parsed.teamId)).includes(parsed.coachId)) return parsed;
  }
  return null;
}

export async function receiveEmail(resendEmailId: string) {
  // Webhooks can arrive more than once
  const [already] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.resendEmailId, resendEmailId)).limit(1);
  if (already) return;

  const email = await getReceivedEmail(resendEmailId);
  // Throw so the webhook returns an error and Resend retries
  if (!email) throw new Error(`Couldn't fetch received email ${resendEmailId}`);

  const from = parseAddress(getHeader(email.headers, "from")) ?? parseAddress(email.from);
  if (!from) throw new Error(`Received email ${resendEmailId} has no sender`);
  const to = (email.to ?? []).map((t) => parseAddress(t)?.address).filter((a): a is string => Boolean(a));
  const refs = referencedMessageIds(email.headers);
  const text = email.text?.trim() || (email.html ? htmlToText(email.html) : "");

  // Sent to a coach+team address (only when that coach is on that team), or
  // to an admin's own address on the domain
  const toTeam = await coachTeamFromAddresses(to);
  const [owner] = toTeam
    ? [{ id: toTeam.coachId }]
    : to.length
      ? await db.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.sendingEmail})`, to)).limit(1)
      : [];

  const [inbound] = await db
    .insert(inboundEmails)
    .values({
      resendEmailId,
      fromEmail: from.address,
      fromName: from.name,
      toEmails: JSON.stringify(to),
      subject: email.subject,
      text,
      emailMessageId: email.message_id ? normalizeMessageId(email.message_id) : null,
      inReplyTo: getHeader(email.headers, "in-reply-to"),
      references: refs.join(" ") || null,
      authPassed: authenticationPassed(email.authentication),
      isAutoReply: isAutoReply(email.headers, email.subject),
      ownerUserId: owner?.id ?? null,
      // Unmatched mail to a team's address waits in that team's "Emails to sort"
      teamId: toTeam?.teamId ?? null,
      receivedAt: email.created_at || new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning();
  if (!inbound) return; // Lost a race with a duplicate delivery

  const match = (await matchByHeaders(refs)) ?? (inbound.authPassed ? await matchBySender(from.address, email.subject, inbound.ownerUserId, toTeam?.teamId ?? null) : null);
  if (match) await fileIntoThread(inbound, match);
}

// ---------------------------------------------------------------------------
// Unmatched mail, for coaches to sort

// Unmatched email a coach can see: sent to their address, or guessed onto one
// of their teams. Mail to nobody in particular goes to admins.
function unmatchedVisibleTo(user: { id: number; role: string }, teamId: number) {
  return or(
    eq(inboundEmails.ownerUserId, user.id),
    eq(inboundEmails.teamId, teamId),
    ...(user.role === "admin" ? [and(isNull(inboundEmails.ownerUserId), isNull(inboundEmails.teamId))] : [])
  );
}

// How many emails wait in "Emails to sort", without loading them
export async function countUnmatched(user: { id: number; role: string }, teamId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.status, "unmatched"), unmatchedVisibleTo(user, teamId)));
  return Math.min(Number(row?.n ?? 0), 50);
}

export async function listUnmatched(user: { id: number; role: string }, teamId: number) {
  const visible = unmatchedVisibleTo(user, teamId);
  return db
    .select({
      id: inboundEmails.id,
      fromEmail: inboundEmails.fromEmail,
      fromName: inboundEmails.fromName,
      subject: inboundEmails.subject,
      text: inboundEmails.text,
      receivedAt: inboundEmails.receivedAt,
      authPassed: inboundEmails.authPassed,
      isAutoReply: inboundEmails.isAutoReply,
    })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.status, "unmatched"), visible))
    .orderBy(desc(inboundEmails.id))
    .limit(50);
}

async function unmatchedFor(user: { id: number; role: string }, teamId: number, inboundId: number) {
  const rows = await listUnmatched(user, teamId);
  if (!rows.some((r) => r.id === inboundId)) return null;
  const [row] = await db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundId)).limit(1);
  return row ?? null;
}

export async function assignUnmatched(user: { id: number; role: string }, teamId: number, inboundId: number, familyEmail: string) {
  const inbound = await unmatchedFor(user, teamId, inboundId);
  if (!inbound) return null;
  return fileIntoThread(inbound, { teamId, familyEmail: familyEmail.toLowerCase(), recipientId: null, conversationId: null, by: "coach" });
}

export async function dismissUnmatched(user: { id: number; role: string }, teamId: number, inboundId: number) {
  const inbound = await unmatchedFor(user, teamId, inboundId);
  if (!inbound) return false;
  await db.update(inboundEmails).set({ status: "dismissed" }).where(eq(inboundEmails.id, inbound.id));
  return true;
}
