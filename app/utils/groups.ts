import type { StaffRole } from "~/utils/team-roles";

// Types shared by the New message picker and the group members panel. The
// server side is groups.server.ts and the group helpers in messages.server.ts.

export type PickerOption = {
  /** "u:<id>" for staff, an opaque hash for a family: parents see these, so never an email */
  key: string;
  kind: "staff" | "family";
  name: string;
  /** "Ricardo & Christian's family"; empty for staff */
  detail: string;
  role: StaffRole | null;
  /** Families: on the app. Others see a group once they join */
  onApp: boolean;
};

export type GroupMember = {
  /** The member row. The key the page uses: never an email, since parents see this list */
  id: number;
  userId: number | null;
  name: string;
  /** "Ricardo's family" for a family; empty for staff (their role shows as a badge) */
  detail: string;
  role: StaffRole | null;
  /** A family not on the app yet: they'll see the group once they join */
  pending: boolean;
};

export const MAX_GROUP_NAME = 60;

/** What a pick opens: one family (as staff) or one staff member (as a parent) is a private thread */
export function opensPrivateThread(side: "coach" | "parent", picked: Pick<PickerOption, "kind">[], name: string) {
  if (picked.length !== 1 || name.trim()) return false;
  return side === "coach" ? picked[0].kind === "family" : picked[0].kind === "staff";
}
