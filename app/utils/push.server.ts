import { sendNotification, WebPushError } from "web-push";
import { db, pushSubscriptions, users } from "~/db";
import { and, eq, inArray } from "drizzle-orm";
import { isSwitchableKind, parseNotifyPrefs, wantsNotification, type NotifyKind, type NotifyPrefs } from "~/utils/notify";

// Web Push with VAPID. Nothing is sent unless VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and VAPID_SUBJECT are set (generate a pair with
// `npx web-push generate-vapid-keys`). The public key reaches the browser
// through loaders, so rotating keys needs no rebuild, but every existing
// subscription stops working and people have to turn notifications on again.

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export type PushPayload = {
  title: string;
  body: string;
  url: string; // Same-site path to open when the notification is tapped
  tag?: string; // Notifications with the same tag replace each other
};

export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null
) {
  // An endpoint belongs to one browser. If someone else signs in on it, it moves to them.
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
}

export async function deleteSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function getNotifyPrefs(userId: string): Promise<NotifyPrefs> {
  const [row] = await db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, userId)).limit(1);
  return parseNotifyPrefs(row?.prefs);
}

export async function setNotifyPref(userId: string, kind: NotifyKind, on: boolean) {
  if (!isSwitchableKind(kind)) throw new Error("That kind of notification can't be turned off");
  const prefs = { ...(await getNotifyPrefs(userId)), [kind]: on };
  await db.update(users).set({ notifyPrefs: JSON.stringify(prefs) }).where(eq(users.id, userId));
  return prefs;
}

// What happened to each device a push went to. Push services answer with an
// HTTP status: 201 accepted, 404/410 the subscription is gone (deleted here),
// 403 usually means it was made with a different VAPID public key.
export type PushResult = {
  sent: number;
  failed: { service: string; status: number | null; reason: string }[];
  removed: number;
};

const pushService = (endpoint: string) => {
  try {
    const host = new URL(endpoint).host;
    if (host.includes("googleapis")) return "Google (Chrome)";
    if (host.includes("apple")) return "Apple";
    if (host.includes("mozilla")) return "Mozilla (Firefox)";
    if (host.includes("windows") || host.includes("microsoft")) return "Microsoft (Edge)";
    return host;
  } catch {
    return "the push service";
  }
};

async function deliver(subs: (typeof pushSubscriptions.$inferSelect)[], payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: [], removed: 0 };
  if (subs.length === 0) return result;
  const body = JSON.stringify(payload);
  const options = {
    TTL: 60 * 60 * 24,
    urgency: "normal" as const,
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: process.env.VAPID_PRIVATE_KEY!,
    },
  };

  const gone: string[] = [];
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, options);
        result.sent++;
      } catch (error) {
        const status = error instanceof WebPushError ? error.statusCode : null;
        const reason = (error instanceof WebPushError && error.body?.trim()) || (error as Error).message;
        // 404/410: the browser unsubscribed or the subscription expired
        if (status === 404 || status === 410) gone.push(sub.endpoint);
        else console.error(`Push failed (${pushService(sub.endpoint)}, ${status ?? "no status"}):`, reason);
        result.failed.push({ service: pushService(sub.endpoint), status, reason: reason.slice(0, 300) });
      }
    })
  );

  if (gone.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone));
    result.removed = gone.length;
  }
  return result;
}

// Sends to every device of every user given who wants this kind of
// notification (see utils/notify.ts). Awaited by callers on purpose: on
// serverless hosts work left running after the response may never finish.
// Failures are logged and returned, never thrown, so a push problem can't
// break the action.
export async function sendPush(userIds: string[], kind: NotifyKind, payload: PushPayload): Promise<PushResult> {
  const none: PushResult = { sent: 0, failed: [], removed: 0 };
  let ids = [...new Set(userIds)];
  if (ids.length === 0 || !isPushConfigured()) return none;

  if (isSwitchableKind(kind)) {
    const rows = await db.select({ id: users.id, prefs: users.notifyPrefs }).from(users).where(inArray(users.id, ids));
    const wanted = new Set(rows.filter((r) => wantsNotification(parseNotifyPrefs(r.prefs), kind)).map((r) => r.id));
    ids = ids.filter((id) => wanted.has(id));
    if (ids.length === 0) return none;
  }

  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
  return deliver(subs, payload);
}

// "Send a test" from one device: only to that device, if it's registered to
// this account, with what the push service said
export async function sendTestPush(userId: string, endpoint: string, payload: PushPayload) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  if (subs.length === 0) return null;
  return deliver(subs, payload);
}
