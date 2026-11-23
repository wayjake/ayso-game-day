import type { Route } from "./+types/api.tours";
import { data } from "react-router";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "~/db";
import { getUser } from "~/utils/auth.server";
import { getTour, parseToursSeen } from "~/utils/tours";

// Remembers tours a coach has finished or dismissed, on their account so it
// follows them across devices.

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seen"), tourId: z.string().max(40) }),
  z.object({ action: z.literal("reset") }),
]);

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request, false);
  if (!user) return data({ error: "Sign in first" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return data({ error: "Bad request" }, { status: 400 });

  let seen = parseToursSeen(user.toursSeen);
  if (parsed.data.action === "reset") {
    seen = {};
  } else {
    const tour = getTour(parsed.data.tourId);
    if (!tour) return data({ error: "Unknown tour" }, { status: 400 });
    seen = { ...seen, [tour.id]: tour.version };
  }
  await db.update(users).set({ toursSeen: JSON.stringify(seen) }).where(eq(users.id, user.id));
  return data({ ok: true, seen });
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
