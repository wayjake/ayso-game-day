// Notification categories. Every push names one, and a person can switch off
// any category that isn't locked. The choices belong to the account and apply
// on every device; turning notifications on for a device (the bell) is
// separate and still decides whether that device gets anything at all.
//
// Stored as JSON overrides in users.notify_prefs, so adding a category later
// needs no migration: anyone without an override gets its default.
//
// A category with `email` can also come by email (staff payment and join alerts). Its
// email choice is stored under "email:<kind>", apart from the push one.

export type NotifyKind = "team" | "chat" | "replies" | "reactions" | "posts" | "comments" | "dropouts" | "payments" | "venmo" | "paymentsRecorded" | "familiesJoined";
export type NotifyChannel = "push" | "email";

export type NotifyCategory = {
  kind: NotifyKind;
  label: string;
  detail: string;
  /** Can't be turned off */
  locked?: boolean;
  /** Only coaches get these */
  coachOnly?: boolean;
  default: boolean;
  /** Can also come by email; the default for that */
  email?: { default: boolean };
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
  {
    kind: "familiesJoined",
    label: "Families joining the app",
    detail: "When a family signs up for BenchTalk and is linked to their kids, and how many have joined so far.",
    coachOnly: true,
    default: true,
    email: { default: false },
  },
  { kind: "dropouts", label: "Players dropping out", detail: "When a family says their player can't make it.", coachOnly: true, default: true },
  { kind: "venmo", label: "Venmo payments to record", detail: "When a forwarded Venmo email shows a family paid.", coachOnly: true, default: true, email: { default: true } },
  { kind: "payments", label: "Families saying they paid", detail: "When a family taps “I sent a payment”.", coachOnly: true, default: true, email: { default: true } },
  {
    kind: "paymentsRecorded",
    label: "Payments recorded",
    detail: "When someone else on staff records a payment, and whether the family got a receipt.",
    coachOnly: true,
    default: true,
    email: { default: false },
  },
];

type PrefKey = NotifyKind | `email:${NotifyKind}`;
export type NotifyPrefs = Partial<Record<PrefKey, boolean>>;

export const prefKey = (kind: NotifyKind, channel: NotifyChannel = "push"): PrefKey => (channel === "email" ? `email:${kind}` : kind);

export function parseNotifyPrefs(json: string | null | undefined): NotifyPrefs {
  if (!json) return {};
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object") return {};
    const prefs: NotifyPrefs = {};
    for (const c of NOTIFY_CATEGORIES) {
      if (typeof value[c.kind] === "boolean") prefs[c.kind] = value[c.kind];
      const email = prefKey(c.kind, "email");
      if (c.email && typeof value[email] === "boolean") prefs[email] = value[email];
    }
    return prefs;
  } catch {
    return {};
  }
}

export function wantsNotification(prefs: NotifyPrefs, kind: NotifyKind, channel: NotifyChannel = "push") {
  const category = NOTIFY_CATEGORIES.find((c) => c.kind === kind);
  if (channel === "email") {
    if (!category?.email) return false;
    return prefs[prefKey(kind, "email")] ?? category.email.default;
  }
  if (!category || category.locked) return true;
  return prefs[kind] ?? category.default;
}

export function isSwitchableKind(kind: string): kind is NotifyKind {
  return NOTIFY_CATEGORIES.some((c) => c.kind === kind && !c.locked);
}

export function isSwitchable(kind: string, channel: NotifyChannel): kind is NotifyKind {
  return channel === "email" ? NOTIFY_CATEGORIES.some((c) => c.kind === kind && c.email) : isSwitchableKind(kind);
}
