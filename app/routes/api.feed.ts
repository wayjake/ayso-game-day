import type { Route } from "./+types/api.feed";
import { data } from "react-router";
import { z } from "zod";
import { getUser } from "~/utils/auth.server";
import {
  announcePost,
  discardUploads,
  feedRole,
  getFeedPage,
  getFeedUpdates,
  parentFeedTeamIds,
  publishPost,
} from "~/utils/feed.server";
import { MAX_CAPTION, MAX_FILES } from "~/utils/feed";
import { isId } from "~/utils/ids";

// The team feed's list, for paging and polling, and the composer's publish
// and discard calls. JSON in and out.

const id = z.string().refine((v) => isId(v), "Not an id");

// ?team=<id> (coach view) or ?scope=family (every team the parent has kids on), then
//   &since=<id>[&oldest=<id>]  new posts, ids still alive, fresh counts (polling);
//                              since= (empty) when nothing is loaded yet
//   &before=<id>               the next older page (infinite scroll)
const query = z
  .object({
    team: id.optional(),
    scope: z.literal("family").optional(),
    since: z.union([id, z.literal("")]).optional(),
    oldest: id.optional(),
    before: id.optional(),
  })
  .refine((q) => Boolean(q.team) !== Boolean(q.scope))
  .refine((q) => q.since !== undefined || q.before !== undefined);

async function requireApiUser(request: Request) {
  const user = await getUser(request, false);
  if (!user) throw new Response("Sign in again", { status: 401 });
  return user;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw new Response("Bad request", { status: 400 });
  const q = parsed.data;

  let teamIds: string[];
  if (q.team) {
    if (!(await feedRole(user.id, q.team))) throw new Response("Not found", { status: 404 });
    teamIds = [q.team];
  } else {
    teamIds = await parentFeedTeamIds(user.id);
  }

  const headers = { "Cache-Control": "no-store" };
  if (q.since !== undefined) {
    return data(await getFeedUpdates({ viewerId: user.id, teamIds, sinceId: q.since, oldestId: q.oldest }), { headers });
  }
  return data(await getFeedPage({ viewerId: user.id, teamIds, beforeId: q.before }), { headers });
}

const key = z.string().min(1).max(200);
const body = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("publish"),
    teamId: id,
    caption: z.string().trim().max(MAX_CAPTION).optional(),
    files: z
      .array(
        z.object({
          key,
          // The browser's smaller copies; optional, since making them can fail
          displayKey: key.optional(),
          thumbKey: key.optional(),
          width: z.number().int().min(1).max(20_000).optional(),
          height: z.number().int().min(1).max(20_000).optional(),
        })
      )
      .min(1)
      .max(MAX_FILES),
  }),
  // Up to 10 files, each with two smaller copies
  z.object({ intent: z.literal("discard"), keys: z.array(key).min(1).max(MAX_FILES * 3) }),
]);

export async function action({ request }: Route.ActionArgs) {
  const user = await requireApiUser(request);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new Response("Bad request", { status: 400 });
  const b = parsed.data;

  if (b.intent === "discard") {
    await discardUploads(user.id, b.keys);
    return data({ ok: true });
  }

  if (!(await feedRole(user.id, b.teamId))) throw new Response("You're not on that team.", { status: 403 });
  const caption = b.caption || null;
  const result = await publishPost({ userId: user.id, teamId: b.teamId, caption, files: b.files });
  // Plain text so the composer can show it as is
  if (!result) throw new Response("Some files are no longer available. Remove them and add them again.", { status: 409 });
  if (result.created) {
    await announcePost({ id: result.postId, teamId: b.teamId, caption }, { id: user.id, name: user.name || user.email.split("@")[0] });
  }
  return data({ ok: true, postId: result.postId });
}
