// Notification categories. Every push names one, and a person can switch off
// any category that isn't locked. The choices belong to the account and apply
// on every device; turning notifications on for a device (the bell) is
// separate and still decides whether that device gets anything at all.
//
// Stored as JSON overrides in users.notify_prefs, so adding a category later
// needs no migration: anyone without an override gets its default.

export type NotifyKind = "team" | "chat" | "replies" | "reactions" | "posts" | "comments" | "dropouts" | "payments";

export type NotifyCategory = {
  kind: NotifyKind;
  label: string;
  detail: string;
  /** Can't be turned off */
  locked?: boolean;
  /** Only coaches get these */
  coachOnly?: boolean;
  default: boolean;
};

export const NOTIFY_CATEGORIES: NotifyCategory[] = [
  {
    kind: "team",
    label: "Team announcements",
    detail: "Announcements, schedule changes and RSVP reminders. Always on.",
    locked: true,
    default: true,
  },
  { kind: "chat", label: "Chat messages", detail: "Team chat and your private messages.", default: true },
  { kind: "replies", label: "Replies to threads you're in", detail: "When someone replies to a thread you started or replied to.", default: true },
  { kind: "reactions", label: "Reactions", detail: "When someone reacts to one of your messages.", default: true },
  { kind: "posts", label: "New photos and videos", detail: "When someone posts to the team feed.", default: false },
  { kind: "comments", label: "Comments on your posts", detail: "When someone comments on a photo or video you posted.", default: true },
  { kind: "dropouts", label: "Players dropping out", detail: "When a family says their player can't make it.", coachOnly: true, default: true },
  { kind: "payments", label: "Payments to confirm", detail: "When a family says they sent money.", coachOnly: true, default: true },
];

export type NotifyPrefs = Partial<Record<NotifyKind, boolean>>;

export function parseNotifyPrefs(json: string | null | undefined): NotifyPrefs {
  if (!json) return {};
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object") return {};
    const prefs: NotifyPrefs = {};
    for (const c of NOTIFY_CATEGORIES) {
      if (typeof value[c.kind] === "boolean") prefs[c.kind] = value[c.kind];
    }
    return prefs;
  } catch {
    return {};
  }
}

export function wantsNotification(prefs: NotifyPrefs, kind: NotifyKind) {
  const category = NOTIFY_CATEGORIES.find((c) => c.kind === kind);
  if (!category || category.locked) return true;
  return prefs[kind] ?? category.default;
}

export function isSwitchableKind(kind: string): kind is NotifyKind {
  return NOTIFY_CATEGORIES.some((c) => c.kind === kind && !c.locked);
}
