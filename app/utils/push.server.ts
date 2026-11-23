import { sendNotification, WebPushError } from "web-push";
import { db, pushSubscriptions } from "~/db";
import { eq, inArray } from "drizzle-orm";

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
  userId: number,
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

// Sends to every device of every user given. Awaited by callers on purpose:
// on serverless hosts work left running after the response may never finish.
// Failures are logged, never thrown, so a push problem can't break the action.
export async function sendPush(userIds: number[], payload: PushPayload) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || !isPushConfigured()) return;

  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
  if (subs.length === 0) return;

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
      } catch (error) {
        // 404/410: the browser unsubscribed or the subscription expired
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          gone.push(sub.endpoint);
        } else {
          console.error("Push failed:", (error as Error).message);
        }
      }
    })
  );

  if (gone.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone));
  }
}
