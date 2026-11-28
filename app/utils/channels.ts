// Channels: named, lasting conversations that staff make and manage, unlike
// group chats, which anyone starts for something quick. Shared by the server
// (channels.server.ts) and the pages. Pure, so it's unit tested.

import type { GroupMember, PickerOption } from "./groups.ts";

export type ChannelAudience = "everyone" | "staff" | "families" | "private";

export const CHANNEL_AUDIENCES: ChannelAudience[] = ["everyone", "staff", "families", "private"];

export const MAX_CHANNEL_NAME = 60;
export const MAX_CHANNEL_TOPIC = 140;

// `detail` is for whoever is making the channel; `about` is shown to everyone in it
export const AUDIENCE_OPTIONS: Record<ChannelAudience, { label: string; detail: string; about: string }> = {
  everyone: {
    label: "Everyone on the team",
    detail: "All staff and every family on the app. Families who join later are in it too.",
    about: "Every coach and family on the team can see this.",
  },
  staff: { label: "Staff only", detail: "Coaches, assistant coaches and team managers.", about: "Only coaches, assistant coaches and team managers can see this." },
  families: {
    label: "Staff and some families",
    detail: "All staff, plus the families you pick, like the ones going to a tournament.",
    about: "All staff and the families listed here can see this.",
  },
  private: {
    label: "Private",
    detail: "Only the people you pick. Other staff, the team owner included, can't see it.",
    about: "Only the people listed here can see this. Other staff can't.",
  },
};

export function parseAudience(value: unknown): ChannelAudience | null {
  return CHANNEL_AUDIENCES.includes(value as ChannelAudience) ? (value as ChannelAudience) : null;
}

/** Whether the channel's readers come from its member rows */
export const usesMembers = (audience: ChannelAudience) => audience === "families" || audience === "private";

/** "Carpool  " -> "Carpool"; a leading # is dropped since the list draws its own */
export function cleanChannelName(raw: string) {
  return raw.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").slice(0, MAX_CHANNEL_NAME).trim();
}

export function cleanTopic(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_CHANNEL_TOPIC) || null;
}

/**
 * One line on who reads it, for the list and the thread header. `families`
 * counts the families in a 'families' channel; `people` everyone in a private one.
 */
export function audienceSummary(audience: ChannelAudience, counts: { families?: number; people?: number } = {}) {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (audience === "everyone") return "Everyone on the team";
  if (audience === "staff") return "Staff only";
  if (audience === "families") return `Staff and ${n(counts.families ?? 0, "family", "families")}`;
  return `Private · ${n(counts.people ?? 0, "person", "people")}`;
}

/**
 * Who can write a new message (not a thread reply) in a channel. Archived:
 * nobody. "Only staff post": staff only, families still react and reply.
 */
export function channelPosting(channel: { archivedAt: string | null; staffOnlyPosts: boolean }, side: "coach" | "parent") {
  if (channel.archivedAt) return { canPost: false, canReply: false };
  return { canPost: side === "coach" || !channel.staffOnlyPosts, canReply: true };
}

/** Channels in the list: by name, the way people find them, not by last message */
export function compareChannels(a: { title: string }, b: { title: string }) {
  return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
}

// What a channel's page shows about it (channelView in channels.server.ts)
export type ChannelInfo = {
  name: string;
  topic: string | null;
  audience: ChannelAudience;
  audienceLabel: string;
  /** "Staff and 6 families", "Private · 5 people" */
  summary: string;
  staffOnlyPosts: boolean;
  archived: boolean;
  /** Picked families ('families') or everyone in it ('private'); empty otherwise */
  members: GroupMember[];
  /** Staff can rename it, change who's in it, and archive it */
  canManage: boolean;
  /** A picked-people channel's member can leave it (not staff in a 'families' one: they read it anyway) */
  canLeave: boolean;
  addable: PickerOption[];
};
