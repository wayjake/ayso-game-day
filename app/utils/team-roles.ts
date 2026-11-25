// Staff roles on a team. Every staff role gets the same coach access; the role
// is a label so families and other staff can tell who does what. Permissions
// beyond that come from being the team's owner (see team-access.server.ts).
//
// Anyone without a staff role is a parent, which comes from guardians rows
// (family.server.ts) and never grants coach access.

export const STAFF_ROLES = ["coach", "assistant-coach", "team-manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const labels: Record<StaffRole, string> = {
  coach: "Coach",
  "assistant-coach": "Assistant coach",
  "team-manager": "Team manager",
};

export function staffRoleLabel(role: StaffRole) {
  return labels[role];
}

// team_members.role also holds "owner" on legacy backfill rows, which means Coach
export function toStaffRole(value: string | null | undefined): StaffRole {
  return STAFF_ROLES.includes(value as StaffRole) ? (value as StaffRole) : "coach";
}

export function parseStaffRole(value: FormDataEntryValue | null): StaffRole | null {
  return STAFF_ROLES.includes(value as StaffRole) ? (value as StaffRole) : null;
}
