import { db, contacts, conversations, familyNotes, guardians, parentInvites, players, teamInvites, users } from "~/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { createInvites, normalizeEmail, sendInviteEmail } from "~/utils/invites.server";
import { familyDeliveryAddress } from "~/utils/email.server";
import { listFamilies, type FamilyStatus } from "~/utils/parent-invites.server";
import { getStaffRoles, removeFromStaff, setStaffRole } from "~/utils/team-access.server";
import { staffRoleLabel, type StaffRole } from "~/utils/team-roles";

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

async function revokeCoachInvites(teamId: number, email: string) {
  await db
    .update(teamInvites)
    .set({ status: "revoked" })
    .where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.email, email), eq(teamInvites.status, "pending")));
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
    await revokeCoachInvites(teamId, oldEmail);
    // Coach notes and an email-only thread follow the family to its new address
    await db
      .update(familyNotes)
      .set({ familyEmail: email })
      .where(and(eq(familyNotes.teamId, teamId), eq(familyNotes.familyEmail, oldEmail)));
    const [taken] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.familyEmail, email)))
      .limit(1);
    if (!taken) {
      await db
        .update(conversations)
        .set({ familyEmail: email })
        .where(and(eq(conversations.teamId, teamId), eq(conversations.kind, "direct"), eq(conversations.familyEmail, oldEmail)));
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
  await revokeCoachInvites(teamId, email);
}

// ---------------------------------------------------------------------------
// Households: every parent or guardian of the same kids, edited on one page.
// Each guardian is still its own email-keyed family underneath (invites,
// threads, notes and announcements stay per email); the page just edits them
// together. A household is the emails whose kids match exactly, so saving the
// shared Players list never adds or drops kids a guardian didn't already share.

export type HouseholdGuardian = {
  email: string;
  name: string;
  phone: string;
  status: FamilyStatus;
  // The account a staff role applies to, once they're on the app
  userId: number | null;
  staffRole: StaffRole | null;
  isTeamOwner: boolean;
  // A pending coach invite, for a guardian who isn't on the app yet
  staffInvite: StaffRole | null;
};

export type Household = {
  guardians: HouseholdGuardian[];
  playerIds: number[];
  // Other guardians of some (not all) of these kids, edited on their own page
  related: { email: string; name: string }[];
};

const kidsKey = (f: { kids: { id: number }[] }) => f.kids.map((k) => k.id).sort((a, b) => a - b).join(",");

// Groups email-keyed families into households: the emails whose kids match exactly
export function groupHouseholds<F extends { kids: { id: number }[] }>(families: F[]): F[][] {
  const groups = new Map<string, F[]>();
  for (const f of families) {
    const key = kidsKey(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()];
}

export async function getHousehold(teamId: number, rawEmail: string, coachId: number): Promise<Household | null> {
  const email = normalizeEmail(rawEmail);
  const families = await listFamilies(null, teamId);
  const start = families.find((f) => f.email === email);
  if (!start) return null;
  const kids = new Set(start.kids.map((k) => k.id));

  const members = families.filter((f) => kidsKey(f) === kidsKey(start));
  const related = families.filter((f) => !members.includes(f) && f.kids.some((k) => kids.has(k.id)));

  const staffRoles = await getStaffRoles(teamId);
  const emails = members.map((f) => f.email);
  const invites = await db
    .select({ email: teamInvites.email, role: teamInvites.role, expiresAt: teamInvites.expiresAt })
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), inArray(teamInvites.email, emails), eq(teamInvites.status, "pending")))
    .orderBy(desc(teamInvites.createdAt));

  const guardians: HouseholdGuardian[] = [];
  for (const f of members) {
    const rows = await getFamilyContacts(teamId, f.email);
    const userId = staffAccountFor(f.userIds, staffRoles);
    const invite = invites.find((i) => i.email === f.email && new Date(i.expiresAt).getTime() > Date.now());
    guardians.push({
      email: f.email,
      name: rows[0]?.name ?? f.parentNames[0] ?? "",
      phone: rows.find((r) => r.phone)?.phone ?? "",
      status: f.status,
      userId,
      staffRole: userId ? (staffRoles.get(userId) ?? null) : null,
      isTeamOwner: userId === coachId,
      staffInvite: userId ? null : (invite?.role ?? null),
    });
  }
  // The guardian the coach clicked comes first
  guardians.sort((a, b) => Number(b.email === email) - Number(a.email === email));

  return {
    guardians,
    playerIds: [...kids],
    related: related.map((f) => ({ email: f.email, name: f.parentNames[0] ?? f.email })),
  };
}

// The family's account a staff role applies to: the one already on staff,
// else the first linked one. Null until the family is on the app.
export function staffAccountFor(userIds: number[], staffRoles: Map<number, StaffRole>) {
  return userIds.find((id) => staffRoles.has(id)) ?? userIds[0] ?? null;
}

export type GuardianInput = {
  originalEmail: string | null;
  name: string;
  email: string;
  phone: string;
  remove: boolean;
};

// Saves the whole household or nothing: everything is checked before any
// guardian is written. Removed guardians go first so a kept one can take over
// a removed one's email.
export async function saveHousehold({
  teamId,
  guardians: input,
  playerIds,
}: {
  teamId: number;
  guardians: GuardianInput[];
  playerIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const kept = input.filter((g) => !g.remove);
  const removed = input.filter((g) => g.remove && g.originalEmail);
  if (kept.length === 0) return { ok: false, error: "Keep at least one parent or guardian, or remove the family instead." };

  const originals = new Set(input.map((g) => g.originalEmail && normalizeEmail(g.originalEmail)).filter(Boolean) as string[]);
  const freed = new Set(removed.map((g) => normalizeEmail(g.originalEmail!)));
  const seen = new Set<string>();
  for (const g of kept) {
    const email = normalizeEmail(g.email);
    if (!g.name.trim()) return { ok: false, error: "Enter a name for each parent or guardian." };
    if (!EMAIL_RE.test(email)) return { ok: false, error: `Enter a valid email address for ${g.name.trim()}.` };
    if (seen.has(email)) return { ok: false, error: `${email} is listed twice. Each parent or guardian needs their own email.` };
    seen.add(email);
    const own = g.originalEmail ? normalizeEmail(g.originalEmail) : null;
    if (email === own) continue;
    // Taking another kept guardian's current email would clash midway through saving
    if (originals.has(email) && !freed.has(email)) {
      return { ok: false, error: `${email} already belongs to another parent here.` };
    }
    if (!freed.has(email) && (await getFamilyContacts(teamId, email)).length > 0) {
      return { ok: false, error: `${email} is already a family on this team. Edit that family instead.` };
    }
  }
  const valid = playerIds.length
    ? await db.select({ id: players.id }).from(players).where(and(eq(players.teamId, teamId), inArray(players.id, playerIds)))
    : [];
  if (valid.length === 0) return { ok: false, error: "Pick at least one player for this family." };

  for (const g of removed) await deleteFamily(teamId, g.originalEmail!);
  for (const g of kept) {
    const result = await saveFamily({ teamId, originalEmail: g.originalEmail, name: g.name, email: g.email, phone: g.phone, playerIds });
    if (!result.ok) return result;
  }
  return { ok: true };
}

// Gives a guardian a staff role, or takes it away. On the app: changes their
// account's role. Not on the app yet: sends (or cancels) a coach invite, and
// accepting it also links them to their kids.
export async function setGuardianRole({
  request,
  team,
  guardian,
  role,
  owner,
}: {
  request: Request;
  team: { id: number; name: string; coachId: number };
  guardian: { email: string; name?: string; userId: number | null; staffRole: StaffRole | null; staffInvite: StaffRole | null };
  role: StaffRole | null;
  owner: { id: number; name: string | null; email: string };
}): Promise<string | null> {
  const who = guardian.name?.trim() || guardian.email;
  if (guardian.userId) {
    if (role === guardian.staffRole) return null;
    if (!role) {
      if (guardian.userId === team.coachId) return null;
      await removeFromStaff(team.id, guardian.userId);
      return `${who} is a parent only now, without coach access.`;
    }
    await setStaffRole(team.id, guardian.userId, role, owner.id);
    return `${who} is now ${staffRoleLabel(role).toLowerCase()}.`;
  }

  if (role === guardian.staffInvite) return null;
  if (!role) {
    await revokeCoachInvites(team.id, guardian.email);
    return `Cancelled the coach invite to ${who}.`;
  }
  const { created } = await createInvites({ email: guardian.email, teamIds: [team.id], invitedBy: owner.id, role });
  if (created.length === 0) return null;
  const result = await sendInviteEmail({
    request,
    // Outside production this goes to the coach instead, like all family mail
    to: familyDeliveryAddress(guardian.email, owner.email),
    shareCode: created[0].shareCode,
    inviterName: owner.name || owner.email,
    inviterEmail: owner.email,
    teamNames: [team.name],
    role,
  });
  const label = staffRoleLabel(role).toLowerCase();
  return result.sent
    ? `Emailed ${who} an invite to join as ${label}.`
      : `Invited ${who} as ${label}, but the email didn't go out. Copy their invite link from Settings.`;
}
