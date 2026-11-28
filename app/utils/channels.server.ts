import { and, eq, inArray, sql } from "drizzle-orm";
import { db, conversationMembers, conversations } from "~/db";
import {
  AUDIENCE_OPTIONS,
  audienceSummary,
  cleanChannelName,
  cleanTopic,
  parseAudience,
  usesMembers,
  type ChannelAudience,
  type ChannelInfo,
} from "~/utils/channels";
import type { PickerOption } from "~/utils/groups";
import { resolvable, resolveKeys, seatsFor, type Resolved, type Seat } from "~/utils/groups.server";
import { channelIdsFor, loadGroupMembers } from "~/utils/messages.server";
import { publishConversation } from "~/utils/realtime.server";
import { parseId } from "~/utils/ids";

// Making and managing channels. Only staff do either. Reading, posting and the
// lists are in messages.server.ts (getConversationAccess is the gate).
//
// A channel's readers come from its audience. 'families' and 'private' also
// use conversationMembers: picked families for the first (all staff read it
// anyway), everyone in it for the second (no other staff can see it). Member
// rows for a family not on the app are email-only, like in groups, and become
// theirs when they join (claimFamilyConversation). Changing the audience keeps
// the rows, so switching back brings the same people back.

const MAX_CHANNEL_MEMBERS = 200;

type Channel = typeof conversations.$inferSelect;
type Viewer = { id: string; side: "coach" | "parent" };

const audienceOf = (channel: Channel): ChannelAudience => (channel.audience ?? "private") as ChannelAudience;

// The people a key list stands for. A 'families' channel only takes families.
function pickedFor(audience: ChannelAudience, picked: Resolved[]) {
  return audience === "families" ? picked.filter((p) => p.option.kind === "family") : picked;
}

async function nameTaken(teamId: string, userId: string, name: string, except?: string) {
  const ids = (await channelIdsFor(teamId, userId, "coach")).filter((id) => id !== except);
  if (ids.length === 0) return false;
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), sql`lower(${conversations.name}) = ${name.toLowerCase()}`))
    .limit(1);
  return Boolean(row);
}

async function addSeats(channelId: string, seats: Seat[], addedBy: string) {
  if (seats.length === 0) return;
  await db
    .insert(conversationMembers)
    .values(seats.map((s) => ({ conversationId: channelId, userId: s.userId, familyEmail: s.familyEmail, addedBy })))
    .onConflictDoNothing();
}

async function memberRows(channelId: string) {
  return db
    .select({ userId: conversationMembers.userId, familyEmail: conversationMembers.familyEmail })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, channelId));
}

/** The person making a private channel is always in it */
async function ensureMember(channelId: string, userId: string) {
  await addSeats(channelId, [{ userId, familyEmail: null }], userId);
}

export async function createChannel(
  teamId: string,
  viewer: Viewer,
  input: { name: string; topic: string; audience: string; staffOnlyPosts: boolean; keys: string[] }
): Promise<{ conversationId: string } | { error: string }> {
  if (viewer.side !== "coach") return { error: "Only staff can make channels" };
  const name = cleanChannelName(input.name);
  if (!name) return { error: "Give the channel a name" };
  const audience = parseAudience(input.audience);
  if (!audience) return { error: "Choose who's in the channel" };
  if (await nameTaken(teamId, viewer.id, name)) return { error: `There's already a channel called ${name}` };

  let seats: Seat[] = [];
  if (usesMembers(audience)) {
    const picked = await resolveKeys(teamId, viewer.id, input.keys);
    if (!picked) return { error: "Someone you picked isn't on the team anymore. Reload and try again." };
    const me: Seat = { userId: viewer.id, familyEmail: null };
    seats = audience === "private" ? [me, ...seatsFor(picked, [me])] : seatsFor(pickedFor(audience, picked));
    if (seats.length > MAX_CHANNEL_MEMBERS) return { error: `A channel can have up to ${MAX_CHANNEL_MEMBERS} people picked` };
  }

  const [channel] = await db
    .insert(conversations)
    .values({ teamId, kind: "channel", name, topic: cleanTopic(input.topic), audience, staffOnlyPosts: input.staffOnlyPosts, createdBy: viewer.id })
    .returning();
  await addSeats(channel.id, seats, viewer.id);
  return { conversationId: channel.id };
}


export async function channelView(channel: Channel, viewer: Viewer): Promise<ChannelInfo> {
  const audience = audienceOf(channel);
  const all = usesMembers(audience) ? (await loadGroupMembers(channel.teamId, [channel.id])).get(channel.id) ?? [] : [];
  // In a 'families' channel staff aren't picked; they're all in it
  const members = audience === "families" ? all.filter((m) => !m.role) : all;
  const canManage = viewer.side === "coach";
  const mine = all.some((m) => m.userId === viewer.id);
  let addable: PickerOption[] = [];
  if (canManage && usesMembers(audience) && !channel.archivedAt) {
    const rows = await memberRows(channel.id);
    const users = new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
    const emails = new Set(rows.flatMap((r) => (r.familyEmail ? [r.familyEmail] : [])));
    addable = pickedFor(audience, [...(await resolvable(channel.teamId, viewer.id)).values()])
      .filter((r) => !(r.familyEmail && emails.has(r.familyEmail)) && !r.userIds.some((id) => users.has(id)))
      .map((r) => r.option);
  }
  return {
    name: channel.name || "Channel",
    topic: channel.topic,
    audience,
    audienceLabel: AUDIENCE_OPTIONS[audience].label,
    summary: audienceSummary(audience, { families: members.length, people: members.length }),
    staffOnlyPosts: channel.staffOnlyPosts,
    archived: Boolean(channel.archivedAt),
    members,
    canManage,
    canLeave: mine && (audience === "private" || viewer.side === "parent"),
    addable,
  };
}

export type ChannelActionResult = { ok: true } | { error: string } | { left: true };

/** Handles the channel* intents of a thread page; null when the form isn't one of them */
export async function handleChannelAction(formData: FormData, channel: Channel, viewer: Viewer): Promise<ChannelActionResult | null> {
  const intent = String(formData.get("_action") ?? "");
  if (!intent.startsWith("channel")) return null;
  if (channel.kind !== "channel") return { error: "Not a channel" };

  if (intent === "channelLeave") {
    await db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, channel.id), eq(conversationMembers.userId, viewer.id)));
    await publishConversation(channel, { kind: "members" });
    return { left: true };
  }

  if (viewer.side !== "coach") return { error: "Only staff can change a channel" };
  const audience = audienceOf(channel);
  let updated: Channel = channel;

  if (intent === "channelSave") {
    const name = cleanChannelName(String(formData.get("name") ?? ""));
    if (!name) return { error: "Give the channel a name" };
    if (await nameTaken(channel.teamId, viewer.id, name, channel.id)) return { error: `There's already a channel called ${name}` };
    const next = parseAudience(formData.get("audience")) ?? audience;
    // Making it private: whoever does it stays in it, or they'd lose it
    if (next === "private" && audience !== "private") await ensureMember(channel.id, viewer.id);
    [updated] = await db
      .update(conversations)
      .set({ name, topic: cleanTopic(String(formData.get("topic") ?? "")), audience: next, staffOnlyPosts: formData.get("staffOnlyPosts") === "1" })
      .where(eq(conversations.id, channel.id))
      .returning();
  } else if (intent === "channelArchive" || intent === "channelUnarchive") {
    const archive = intent === "channelArchive";
    [updated] = await db
      .update(conversations)
      .set({ archivedAt: archive ? sql`CURRENT_TIMESTAMP` : null, archivedBy: archive ? viewer.id : null })
      .where(eq(conversations.id, channel.id))
      .returning();
  } else if (intent === "channelAdd") {
    if (!usesMembers(audience)) return { error: "Everyone on the team is already in this channel" };
    const picked = await resolveKeys(channel.teamId, viewer.id, formData.getAll("key").map(String));
    if (!picked) return { error: "Someone you picked isn't on the team anymore. Reload and try again." };
    const existing = await memberRows(channel.id);
    const seats = seatsFor(pickedFor(audience, picked), existing);
    if (existing.length + seats.length > MAX_CHANNEL_MEMBERS) return { error: `A channel can have up to ${MAX_CHANNEL_MEMBERS} people picked` };
    await addSeats(channel.id, seats, viewer.id);
  } else if (intent === "channelRemove") {
    const memberId = parseId(formData.get("memberId"));
    if (!memberId) return { error: "They're not in this channel" };
    const [row] = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.id, memberId), eq(conversationMembers.conversationId, channel.id)))
      .limit(1);
    if (!row) return { error: "They're not in this channel" };
    if (row.userId === viewer.id) return { error: "Use Leave to leave the channel" };
    await db.delete(conversationMembers).where(eq(conversationMembers.id, memberId));
  } else {
    return { error: "Unknown action" };
  }

  // Becoming private (or no longer) moves its realtime channel: tell both
  await publishConversation(channel, { kind: "members" });
  if (updated.audience !== channel.audience) await publishConversation(updated, { kind: "members" });
  return { ok: true };
}

/** Archived channels on a team, for staff: listed apart, with a way back */
export async function archivedChannels(teamId: string, userId: string) {
  const ids = await channelIdsFor(teamId, userId, "coach", { archived: true });
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: conversations.id, name: conversations.name })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), sql`${conversations.archivedAt} is not null`));
  return rows.map((r) => ({ id: r.id, name: r.name || "Channel" })).sort((a, b) => a.name.localeCompare(b.name));
}
