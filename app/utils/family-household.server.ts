import { normalizeEmail } from "~/utils/invites.server";
import { deleteFamily, getFamilyContacts, groupHouseholds, saveFamily } from "~/utils/family-admin.server";
import { inviteFamily, listFamilies, type Family } from "~/utils/parent-invites.server";
import type { FamilyHousehold, HouseholdActionResult } from "~/utils/family-household";
import { getStaffRoles } from "~/utils/team-access.server";

// Families managing their own household from Settings: add another parent or
// guardian of their kids, invite them, or remove one. No coach approval;
// staff can do the same on Families → Edit family. A household is the
// email-keyed families whose kids match exactly (groupHouseholds), and
// everything here goes through the same saveFamily/deleteFamily as the staff side.
//
// A family can't remove themselves (they'd lock themselves out), or anyone on
// the team staff or with a pending staff invite: deleting that family would
// revoke the coach invite too. Staff handle those.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Viewer = { id: string; name: string | null; email: string };

// The viewer's household on one team: their own family email first
async function householdOn(teamId: string, viewerId: string) {
  const families = await listFamilies(null, teamId);
  const mine = families.find((f) => f.userIds.includes(viewerId));
  if (!mine) return null;
  const household = groupHouseholds(families).find((group) => group.includes(mine)) ?? [mine];
  return { mine, household };
}

function isStaff(f: Family, roles: Map<string, unknown>) {
  return Boolean(f.staffInvite) || f.userIds.some((id) => roles.has(id));
}

export async function familyHouseholds(viewerId: string, teams: { teamId: string; teamName: string }[]): Promise<FamilyHousehold[]> {
  const result: FamilyHousehold[] = [];
  for (const { teamId, teamName } of teams) {
    const found = await householdOn(teamId, viewerId);
    if (!found) continue;
    const roles = await getStaffRoles(teamId);
    const members = found.household
      .map((f) => ({
        email: f.email,
        name: f.parentNames[0] || f.email,
        status: f.status,
        isYou: f === found.mine,
        staff: isStaff(f, roles),
      }))
      .sort((a, b) => Number(b.isYou) - Number(a.isYou));
    result.push({ teamId, teamName, kids: found.mine.kids.map((k) => ({ id: k.id, name: k.name })), members });
  }
  return result;
}

export async function addFamilyMember(
  request: Request,
  viewer: Viewer,
  teamId: string,
  input: { name: string; email: string }
): Promise<HouseholdActionResult> {
  const found = await householdOn(teamId, viewer.id);
  if (!found) return { ok: false, error: "You're not linked to a player on that team." };
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) return { ok: false, error: "Enter their name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (found.household.some((f) => f.email === email)) return { ok: false, error: `${email} is already in your family.` };
  // Someone already on the team with other kids: the coach decides how it fits
  if ((await getFamilyContacts(teamId, email)).length > 0) {
    return { ok: false, error: `${email} is already on the team. Ask your coach to add them to your family.` };
  }

  const saved = await saveFamily({
    teamId,
    originalEmail: null,
    name,
    email,
    phone: "",
    playerIds: found.mine.kids.map((k) => k.id),
  });
  if (!saved.ok) return saved;

  const first = name.split(" ")[0];
  const invite = await inviteFamily({ request, teamId, email, invitedBy: viewer });
  if (invite.result === "linked") return { ok: true, message: `${first} is in your family now.` };
  if (invite.result === "sent") return { ok: true, message: `Added ${first} and emailed them an invite to join.` };
  return { ok: true, warning: true, message: `Added ${first}, but the invite email didn't go out. Try Send invite again in a bit.` };
}

/** Resend the invite to someone in the household who isn't on the app yet */
export async function inviteFamilyMember(request: Request, viewer: Viewer, teamId: string, rawEmail: string): Promise<HouseholdActionResult> {
  const found = await householdOn(teamId, viewer.id);
  const email = normalizeEmail(rawEmail);
  const member = found?.household.find((f) => f.email === email);
  if (!found || !member) return { ok: false, error: "They're not in your family on this team." };
  if (member.status === "joined") return { ok: false, error: "They're already on the app." };
  if (member.staffInvite) return { ok: false, error: "The coach has already invited them." };
  const invite = await inviteFamily({ request, teamId, email, invitedBy: viewer });
  const first = (member.parentNames[0] || email).split(" ")[0];
  if (invite.result === "sent") return { ok: true, message: `Sent ${first} a new invite.` };
  if (invite.result === "linked") return { ok: true, message: `${first} is in your family now.` };
  return { ok: false, error: "The invite email didn't go out. Try again in a bit." };
}

export async function removeFamilyMember(viewer: Viewer, teamId: string, rawEmail: string): Promise<HouseholdActionResult> {
  const found = await householdOn(teamId, viewer.id);
  const email = normalizeEmail(rawEmail);
  const member = found?.household.find((f) => f.email === email);
  if (!found || !member) return { ok: false, error: "They're not in your family on this team." };
  if (member === found.mine || member.userIds.includes(viewer.id)) return { ok: false, error: "You can't remove yourself. Ask your coach." };
  if (isStaff(member, await getStaffRoles(teamId))) return { ok: false, error: "They're on the team staff. Ask your coach to remove them." };
  await deleteFamily(teamId, email);
  return { ok: true, message: `Removed ${(member.parentNames[0] || email).split(" ")[0]} from your family.` };
}
