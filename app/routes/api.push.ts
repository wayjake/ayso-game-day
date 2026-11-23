import type { Route } from "./+types/api.push";
import { data } from "react-router";
import { z } from "zod";
import { getUser } from "~/utils/auth.server";
import { deleteSubscription, isPushConfigured, saveSubscription, sendPush } from "~/utils/push.server";
import { db, pushSubscriptions } from "~/db";
import { and, eq } from "drizzle-orm";

// JSON endpoint for PushToggle: subscribe, unsubscribe, or send a test to yourself

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribe"),
    subscription: z.object({
      endpoint: z.string().url().max(2000),
      keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    }),
  }),
  z.object({ action: z.literal("unsubscribe"), endpoint: z.string().max(2000) }),
  z.object({ action: z.literal("test") }),
]);

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request, false);
  if (!user) return data({ error: "Sign in first" }, { status: 401 });
  if (!isPushConfigured()) return data({ error: "Notifications aren't set up on this server" }, { status: 503 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return data({ error: "Bad request" }, { status: 400 });
  const input = parsed.data;

  if (input.action === "subscribe") {
    await saveSubscription(user.id, input.subscription, request.headers.get("User-Agent"));
    return data({ ok: true });
  }

  if (input.action === "unsubscribe") {
    // Only your own subscription
    const [own] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, user.id)))
      .limit(1);
    if (own) await deleteSubscription(input.endpoint);
    return data({ ok: true });
  }

  await sendPush([user.id], {
    title: "AYSO Game Day",
    body: "Notifications are working on this device.",
    url: "/family",
    tag: "test",
  });
  return data({ ok: true });
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
