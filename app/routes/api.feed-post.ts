import type { Route } from "./+types/api.feed-post";
import { data } from "react-router";
import { z } from "zod";
import { getUser } from "~/utils/auth.server";
import { addComment, deleteComment, deletePost, feedRole, getPostRow, getPostStats, setLiked } from "~/utils/feed.server";
import { publishFeed } from "~/utils/realtime.server";
import { MAX_COMMENT } from "~/utils/feed";
import { isId, parseId } from "~/utils/ids";

// POST /api/feed/posts/:postId: like, comment, delete a comment, delete the
// post. Access is checked against the post's own team. Answers with the post's
// fresh counts so the page can update without reloading its list.

const body = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("like"), liked: z.boolean() }),
  z.object({ intent: z.literal("comment"), clientId: z.string().uuid(), body: z.string().trim().min(1).max(MAX_COMMENT) }),
  z.object({ intent: z.literal("deleteComment"), commentId: z.string().refine((v) => isId(v), "Not an id") }),
  z.object({ intent: z.literal("delete") }),
]);

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request, false);
  if (!user) throw new Response("Sign in again", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  const postId = parseId(params.postId);
  if (!parsed.success || !postId) throw new Response("Bad request", { status: 400 });
  const b = parsed.data;

  // Same answer for a deleted post and someone else's team, so ids can't be probed
  const post = await getPostRow(postId);
  const role = post ? await feedRole(user.id, post.teamId) : null;
  if (!post || !role) throw new Response("This post was deleted.", { status: 404 });

  if (b.intent === "delete") {
    if (post.authorId !== user.id && role !== "staff") throw new Response("Only the person who posted it or a coach can delete it.", { status: 403 });
    await deletePost(post.id);
    await publishFeed(post.teamId, { kind: "deleted", postId: post.id });
    return data({ likes: 0, liked: false, comments: 0 });
  }

  if (b.intent === "like") {
    await setLiked(post.id, user.id, b.liked);
  } else if (b.intent === "comment") {
    await addComment({ post, user: { id: user.id, name: user.name || user.email.split("@")[0] }, clientId: b.clientId, body: b.body });
  } else if (!(await deleteComment(post.id, post.teamId, b.commentId, user.id))) {
    throw new Response("Only the person who wrote it or a coach can delete it.", { status: 403 });
  }

  await publishFeed(post.teamId, { kind: "stats", postId: post.id });
  return data(await getPostStats(post.id, user.id));
}
