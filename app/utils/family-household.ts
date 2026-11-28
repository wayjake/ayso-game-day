import type { FamilyStatus } from "~/utils/parent-invites.server";

// Shared by Settings and family-household.server.ts: a family's own household on one team.

export type HouseholdMember = {
  email: string;
  name: string;
  status: FamilyStatus;
  isYou: boolean;
  /** On the team staff, or invited to it: only staff can remove them */
  staff: boolean;
};

export type FamilyHousehold = {
  teamId: string;
  teamName: string;
  kids: { id: string; name: string; profilePicture?: string | null; jerseyNumber?: number | null }[];
  members: HouseholdMember[];
};

/** `warning`: it saved, but something after it (the invite email) didn't work */
export type HouseholdActionResult = { ok: true; message: string; warning?: boolean } | { ok: false; error: string };
