import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, conversationMembers, conversations } from "~/db";
import { listFamilies } from "~/utils/parent-invites.server";
import { getTeamStaff } from "~/utils/team-access.server";
import { MAX_GROUP_NAME, opensPrivateThread, type PickerOption } from "~/utils/groups";
import {
  getOrCreateDirectConversation,
  getOrCreateFamilyConversation,
  groupIdsFor,
  groupManagerId,
  loadGroupMembers,
} from "~/utils/messages.server";
import { publishConversation } from "~/utils/realtime.server";
import { parseId } from "~/utils/ids";

// Open pages reload: the header and member list change for everyone in it
const publishGroupChange = (conversation: typeof conversations.$inferSelect) => publishConversation(conversation, { kind: "members" });

// Starting conversations from the New message picker, and managing groups.
//
// The picker lists the team's staff and families (one per family email). Pick
// one family as staff, or one staff member as a parent, and it opens the
// existing private thread. Anything else is a group: only its members can read
// it, so a group of parents stays out of the coaches' sight unless one is in it.
//
// Parents see this picker too, so options are keyed without emails: staff by
// account id, families by an HMAC of the email that only the server can map back.

const MAX_GROUP_SIZE = 60;

export type Resolved = { option: PickerOption; userIds: string[]; familyEmail: string | null };

function familyKey(teamId: string, email: string) {
  const secret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
  return `f:${crypto.createHmac("sha256", secret).update(`group-family:${teamId}:${email}`).digest("hex").slice(0, 16)}`;
}

const firstNames = (names: string[]) => {
  const first = names.map((n) => n.split(" ")[0]);
  return first.length <= 1 ? first.join("") : `${first.slice(0, -1).join(", ")} & ${first.at(-1)}`;
};

// Everyone on the team the viewer could start a conversation with, by key
export async function resolvable(teamId: string, viewerId: string) {
  const [staff, families] = await Promise.all([getTeamStaff(teamId), listFamilies(null, teamId)]);
  const byKey = new Map<string, Resolved>();
  for (const m of staff) {
    if (m.userId === viewerId) continue;
    const option: PickerOption = {
      key: `u:${m.userId}`,
      kind: "staff",
      name: m.name || m.email.split("@")[0],
      detail: "",
      role: m.role,
      onApp: true,
    };
    byKey.set(option.key, { option, userIds: [m.userId], familyEmail: null });
  }
  for (const f of families) {
    // Their own family email isn't someone to message (a spouse's is)
    if (f.userIds.includes(viewerId)) continue;
    const kids = firstNames(f.kids.map((k) => k.name));
    const option: PickerOption = {
      key: familyKey(teamId, f.email),
      kind: "family",
      name: f.parentNames.find((n) => n && !n.includes("@")) || `${kids}'s family`,
      detail: `${kids}'s family`,
      role: null,
      onApp: f.status === "joined" && f.userIds.length > 0,
    };
    byKey.set(option.key, { option, userIds: f.status === "joined" ? f.userIds : [], familyEmail: f.email });
  }
  return byKey;
}

/** Picker options: staff first, then families by kid */
export async function pickerOptions(teamId: string, viewerId: string) {
  return [...(await resolvable(teamId, viewerId)).values()].map((r) => r.option);
}

export type Seat = { userId: string | null; familyEmail: string | null };

// One seat per account; a family not on the app is one email-only seat
export function seatsFor(picked: Resolved[], exclude: Seat[] = []) {
  const seats: Seat[] = [];
  const users = new Set(exclude.flatMap((s) => (s.userId ? [s.userId] : [])));
  const emails = new Set(exclude.flatMap((s) => (!s.userId && s.familyEmail ? [s.familyEmail] : [])));
  for (const p of picked) {
    if (p.userIds.length > 0) {
      for (const userId of p.userIds) {
        if (users.has(userId)) continue;
        users.add(userId);
        seats.push({ userId, familyEmail: p.familyEmail });
      }
    } else if (p.familyEmail && !emails.has(p.familyEmail)) {
      emails.add(p.familyEmail);
      seats.push({ userId: null, familyEmail: p.familyEmail });
    }
  }
  return seats;
}

const signature = (seats: Seat[]) =>
  seats
    .map((s) => (s.userId ? `u:${s.userId}` : `e:${s.familyEmail}`))
    .sort()
    .join(",");

export async function resolveKeys(teamId: string, viewerId: string, keys: string[]) {
  const byKey = await resolvable(teamId, viewerId);
  const picked = [...new Set(keys)].map((k) => byKey.get(k));
  if (picked.some((p) => !p)) return null; // Someone left the team since the page loaded
  return picked as Resolved[];
}

// An unnamed group the viewer is in with exactly these people, so picking the
// same people twice opens the same chat
async function findSameGroup(teamId: string, viewerId: string, seats: Seat[]) {
  const ids = await groupIdsFor(viewerId, [teamId]);
  if (ids.length === 0) return null;
  const unnamed = await db
    .select()
    .from(conversations)
    .where(and(inArray(conversations.id, ids), isNull(conversations.name)));
  if (unnamed.length === 0) return null;
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId, familyEmail: conversationMembers.familyEmail })
    .from(conversationMembers)
    .where(inArray(conversationMembers.conversationId, unnamed.map((c) => c.id)));
  const want = signature(seats);
  return unnamed.find((c) => signature(rows.filter((r) => r.conversationId === c.id)) === want) ?? null;
}

// From the New message picker. Returns the conversation to open.
export async function startConversation(
  teamId: string,
  viewer: { id: string; side: "coach" | "parent" },
  keys: string[],
  rawName: string
): Promise<{ conversationId: string } | { error: string }> {
  if (keys.length === 0) return { error: "Pick who to message" };
  const picked = await resolveKeys(teamId, viewer.id, keys);
  if (!picked) return { error: "Someone you picked isn't on the team anymore. Reload and try again." };
  const name = rawName.trim().slice(0, MAX_GROUP_NAME) || null;

  // One person, the usual way: staff open their private thread with a family,
  // parents theirs with a staff member. A name asks for a group anyway.
  if (opensPrivateThread(viewer.side, picked.map((p) => p.option), name ?? "")) {
    const [only] = picked;
    if (viewer.side === "coach" && only.familyEmail) {
      const conversation = await getOrCreateFamilyConversation(teamId, only.familyEmail, only.userIds[0], viewer.id);
      return { conversationId: conversation.id };
    }
    if (viewer.side === "parent") {
      const conversation = await getOrCreateDirectConversation(teamId, viewer.id, only.userIds[0]);
      return { conversationId: conversation.id };
    }
  }

  const me: Seat = { userId: viewer.id, familyEmail: null };
  const seats = [me, ...seatsFor(picked, [me])];
  if (seats.length < 2) return { error: "Pick who to message" };
  if (seats.length > MAX_GROUP_SIZE) return { error: `A group can have up to ${MAX_GROUP_SIZE} people` };

  if (!name) {
    const same = await findSameGroup(teamId, viewer.id, seats);
    if (same) return { conversationId: same.id };
  }

  const [conversation] = await db.insert(conversations).values({ teamId, kind: "group", name, createdBy: viewer.id }).returning();
  await db
    .insert(conversationMembers)
    .values(seats.map((s) => ({ conversationId: conversation.id, userId: s.userId, familyEmail: s.familyEmail, addedBy: viewer.id })))
    .onConflictDoNothing();
  return { conversationId: conversation.id };
}

// ---------------------------------------------------------------------------
// Managing a group: whoever started it (see groupManagerId) renames it and adds
// or removes people. Anyone can leave.

export async function groupView(conversation: typeof conversations.$inferSelect, viewerId: string) {
  const members = (await loadGroupMembers(conversation.teamId, [conversation.id])).get(conversation.id) ?? [];
  const managerId = groupManagerId(conversation, members);
  const canManage = managerId === viewerId;
  // Only the manager needs the people they could add: everyone not in it yet
  let addable: PickerOption[] = [];
  if (canManage) {
    const rows = await db
      .select({ userId: conversationMembers.userId, familyEmail: conversationMembers.familyEmail })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversation.id));
    const users = new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
    const emails = new Set(rows.flatMap((r) => (r.familyEmail ? [r.familyEmail] : [])));
    addable = [...(await resolvable(conversation.teamId, viewerId)).values()]
      .filter((r) => !(r.familyEmail && emails.has(r.familyEmail)) && !r.userIds.some((id) => users.has(id)))
      .map((r) => r.option);
  }
  return { name: conversation.name, members, managerId, canManage, addable };
}

export type GroupActionResult = { ok: true } | { error: string } | { left: true };

/** Handles the group's _action intents; null when the form isn't one of them */
export async function handleGroupAction(
  formData: FormData,
  conversation: typeof conversations.$inferSelect,
  user: { id: string; name: string | null; email: string }
): Promise<GroupActionResult | null> {
  const intent = String(formData.get("_action") ?? "");
  if (!intent.startsWith("group")) return null;
  if (conversation.kind !== "group") return { error: "Not a group" };

  if (intent === "groupLeave") {
    await db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, user.id)));
    await publishGroupChange(conversation);
    return { left: true };
  }

  const members = (await loadGroupMembers(conversation.teamId, [conversation.id])).get(conversation.id) ?? [];
  if (groupManagerId(conversation, members) !== user.id) return { error: "Only the group's organizer can change it" };

  if (intent === "groupRename") {
    const name = String(formData.get("name") ?? "").trim().slice(0, MAX_GROUP_NAME) || null;
    await db.update(conversations).set({ name }).where(eq(conversations.id, conversation.id));
  } else if (intent === "groupAdd") {
    const picked = await resolveKeys(conversation.teamId, user.id, formData.getAll("key").map(String));
    if (!picked) return { error: "Someone you picked isn't on the team anymore. Reload and try again." };
    const existing = await db
      .select({ userId: conversationMembers.userId, familyEmail: conversationMembers.familyEmail })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversation.id));
    const seats = seatsFor(picked, existing);
    if (existing.length + seats.length > MAX_GROUP_SIZE) return { error: `A group can have up to ${MAX_GROUP_SIZE} people` };
    if (seats.length > 0) {
      await db
        .insert(conversationMembers)
        .values(seats.map((s) => ({ conversationId: conversation.id, userId: s.userId, familyEmail: s.familyEmail, addedBy: user.id })))
        .onConflictDoNothing();
    }
  } else if (intent === "groupRemove") {
    const memberId = parseId(formData.get("memberId"));
    const target = memberId ? members.find((m) => m.id === memberId) : undefined;
    if (!memberId || !target) return { error: "They're not in this group" };
    if (target.userId === user.id) return { error: "Use Leave to leave the group" };
    await db.delete(conversationMembers).where(and(eq(conversationMembers.id, memberId), eq(conversationMembers.conversationId, conversation.id)));
  } else {
    return { error: "Unknown action" };
  }
  await publishGroupChange(conversation);
  return { ok: true };
}
