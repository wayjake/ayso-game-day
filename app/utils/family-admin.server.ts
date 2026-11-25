import { db, contacts, conversations, familyNotes, guardians, parentInvites, players, users } from "~/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { normalizeEmail } from "~/utils/invites.server";

// A family is every contact on the team that shares one email address and
// belongs to a player. Coaches edit it as one unit: the parent's name, email
// and phone, and which kids it covers.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sameEmail = (email: string) => sql`lower(trim(${contacts.email})) = ${email}`;

export async function getFamilyContacts(teamId: number, email: string) {
  return db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone, playerId: contacts.playerId })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(eq(contacts.teamId, teamId), eq(players.teamId, teamId), sameEmail(normalizeEmail(email))));
}

// Parent accounts that belong to this family: an account with the email, or
// the account that accepted the family's invite.
async function familyUserIds(teamId: number, email: string) {
  const byEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  const accepted = await db
    .select({ id: parentInvites.acceptedBy })
    .from(parentInvites)
    .where(and(eq(parentInvites.teamId, teamId), eq(parentInvites.email, email), eq(parentInvites.status, "accepted"), isNotNull(parentInvites.acceptedBy)));
  return [...new Set([...byEmail.map((u) => u.id), ...accepted.map((a) => a.id!)])];
}

async function unlinkKids(teamId: number, email: string, playerIds: number[]) {
  if (playerIds.length === 0) return;
  const userIds = await familyUserIds(teamId, email);
  if (userIds.length === 0) return;
  await db
    .delete(guardians)
    .where(and(eq(guardians.teamId, teamId), inArray(guardians.userId, userIds), inArray(guardians.playerId, playerIds)));
}

async function revokePendingInvites(teamId: number, email: string) {
  await db
    .update(parentInvites)
    .set({ status: "revoked" })
    .where(and(eq(parentInvites.teamId, teamId), eq(parentInvites.email, email), eq(parentInvites.status, "pending")));
}

export type SaveFamilyResult = { ok: true; email: string } | { ok: false; error: string };

// Creates a family (originalEmail null) or updates one in place.
export async function saveFamily({
  teamId,
  originalEmail,
  name,
  email: rawEmail,
  phone,
  playerIds: requestedIds,
}: {
  teamId: number;
  originalEmail: string | null;
  name: string;
  email: string;
  phone: string;
  playerIds: number[];
}): Promise<SaveFamilyResult> {
  const email = normalizeEmail(rawEmail);
  const oldEmail = originalEmail ? normalizeEmail(originalEmail) : null;
  const parentName = name.trim();
  if (!parentName) return { ok: false, error: "Enter the parent's name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const teamPlayers = requestedIds.length
    ? await db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.teamId, teamId), inArray(players.id, requestedIds)))
    : [];
  const playerIds = teamPlayers.map((p) => p.id);
  if (playerIds.length === 0) return { ok: false, error: "Pick at least one player for this family." };

  if (email !== oldEmail) {
    const clash = await getFamilyContacts(teamId, email);
    if (clash.length > 0) {
      return { ok: false, error: `${email} is already a family on this team. Edit that family instead.` };
    }
  }

  const existing = oldEmail ? await getFamilyContacts(teamId, oldEmail) : [];
  if (oldEmail && existing.length === 0) return { ok: false, error: "That family isn't on this team anymore." };

  const keep = new Set(playerIds);
  const removedContacts = existing.filter((c) => !keep.has(c.playerId!));
  const removedKids = [...new Set(removedContacts.map((c) => c.playerId!))];
  const haveKids = new Set(existing.map((c) => c.playerId!));
  const addedKids = playerIds.filter((id) => !haveKids.has(id));
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    const keptIds = existing.filter((c) => keep.has(c.playerId!)).map((c) => c.id);
    if (keptIds.length) {
      await tx
        .update(contacts)
        .set({ name: parentName, email, phone: phone.trim() || null, updatedAt: now })
        .where(inArray(contacts.id, keptIds));
    }
    if (removedContacts.length) {
      await tx.delete(contacts).where(inArray(contacts.id, removedContacts.map((c) => c.id)));
    }
    if (addedKids.length) {
      await tx.insert(contacts).values(
        addedKids.map((playerId) => ({ teamId, playerId, name: parentName, email, phone: phone.trim() || null, relationship: "parent" as const }))
      );
    }
  });

  // Kids taken off the family: their parent accounts lose access to them
  if (oldEmail) await unlinkKids(teamId, oldEmail, removedKids);

  if (oldEmail && email !== oldEmail) {
    // An invite to the old address shouldn't still work
    await revokePendingInvites(teamId, oldEmail);
    // Coach notes and an email-only thread follow the family to its new address
    await db
      .update(familyNotes)
      .set({ familyEmail: email })
      .where(and(eq(familyNotes.teamId, teamId), eq(familyNotes.familyEmail, oldEmail)));
    // Each staff member has their own thread with the family; move each one
    // unless that staff member already has a thread at the new address
    const directs = and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"));
    const taken = new Set(
      (await db.select({ staff: conversations.staffUserId }).from(conversations).where(and(directs, eq(conversations.familyEmail, email))))
        .map((r) => r.staff)
    );
    const moving = await db.select({ id: conversations.id, staff: conversations.staffUserId }).from(conversations).where(and(directs, eq(conversations.familyEmail, oldEmail)));
    for (const row of moving) {
      if (!taken.has(row.staff)) await db.update(conversations).set({ familyEmail: email }).where(eq(conversations.id, row.id));
    }
  }

  return { ok: true, email };
}

// Removes the family from the team: its contacts, any pending invite, and
// its parent accounts' access to the kids. Messages and notes stay as history.
export async function deleteFamily(teamId: number, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const existing = await getFamilyContacts(teamId, email);
  if (existing.length === 0) return;
  await unlinkKids(teamId, email, [...new Set(existing.map((c) => c.playerId!))]);
  await db.delete(contacts).where(inArray(contacts.id, existing.map((c) => c.id)));
  await revokePendingInvites(teamId, email);
}
