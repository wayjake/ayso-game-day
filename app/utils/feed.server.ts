import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { UTApi } from "uploadthing/server";
import { db, guardians, postComments, postLikes, postMedia, postUploads, posts, teams, users } from "~/db";
import { getTeamForUser, getStaffRoles } from "~/utils/team-access.server";
import { getCoachUserIds, getParentUserIds } from "~/utils/family.server";
import { sendPush } from "~/utils/push.server";
import { publishFeed } from "~/utils/realtime.server";
import type { StaffRole } from "~/utils/team-roles";
import { postPath, postSummary, type FeedPage, type FeedPost, type FeedUpdates, type Liker, type PostComment, type PostStats } from "~/utils/feed";

// Team feed: photo and video posts seen only by the team's coaches and
// parents. Every function that takes a post id loads the post and checks the
// viewer against *its* team; nothing trusts a team id sent by the browser.

const utapi = new UTApi();
const PAGE_SIZE = 15;

// ---------------------------------------------------------------------------
// Access

export type FeedRole = "staff" | "parent";

/** Staff (any coach role) or a parent of a player on the team; null for anyone else */
export async function feedRole(userId: number, teamId: number): Promise<FeedRole | null> {
  if (await getTeamForUser(teamId, userId)) return "staff";
  const [row] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(and(eq(guardians.userId, userId), eq(guardians.teamId, teamId)))
    .limit(1);
  return row ? "parent" : null;
}

/** Teams a parent sees in the family feed: every team they have a kid on */
export async function parentFeedTeamIds(userId: number) {
  const rows = await db.selectDistinct({ teamId: guardians.teamId }).from(guardians).where(eq(guardians.userId, userId));
  return rows.map((r) => r.teamId);
}

// ---------------------------------------------------------------------------
// Reading

export async function getFeedPage({ viewerId, teamIds, beforeId }: { viewerId: number; teamIds: number[]; beforeId?: number }): Promise<FeedPage> {
  if (teamIds.length === 0) return { posts: [], hasMore: false };
  const rows = await db
    .select()
    .from(posts)
    .where(and(inArray(posts.teamId, teamIds), beforeId ? lt(posts.id, beforeId) : undefined))
    .orderBy(desc(posts.id))
    .limit(PAGE_SIZE + 1);
  return { posts: await hydrate(rows.slice(0, PAGE_SIZE), viewerId), hasMore: rows.length > PAGE_SIZE };
}

/**
 * For polling: posts newer than `sinceId`, plus which loaded posts still exist
 * (from `oldestId` up, or all of them once the list has reached the end) and
 * their current counts.
 */
export async function getFeedUpdates({
  viewerId,
  teamIds,
  sinceId,
  oldestId,
}: {
  viewerId: number;
  teamIds: number[];
  sinceId: number;
  oldestId?: number;
}): Promise<FeedUpdates> {
  if (teamIds.length === 0) return { posts: [], liveIds: [], stats: {} };
  const fresh = await db
    .select()
    .from(posts)
    .where(and(inArray(posts.teamId, teamIds), gt(posts.id, sinceId)))
    .orderBy(desc(posts.id))
    .limit(50);
  const live = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(inArray(posts.teamId, teamIds), lte(posts.id, sinceId), oldestId ? gte(posts.id, oldestId) : undefined));
  const liveIds = live.map((r) => r.id);
  const stats = await getStats(liveIds, viewerId);
  return { posts: await hydrate(fresh, viewerId), liveIds, stats: Object.fromEntries(stats) };
}

/** One post, or null if it's gone or the viewer isn't on its team */
export async function getPost(postId: number, viewerId: number) {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!row) return null;
  const role = await feedRole(viewerId, row.teamId);
  if (!role) return null;
  const [post] = await hydrate([row], viewerId);
  return { post, role };
}

async function hydrate(rows: (typeof posts.$inferSelect)[], viewerId: number): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const teamIds = [...new Set(rows.map((r) => r.teamId))];
  const authorIds = [...new Set(rows.map((r) => r.authorId))];

  const [media, authors, teamRows, stats, staff] = await Promise.all([
    db.select().from(postMedia).where(inArray(postMedia.postId, ids)).orderBy(asc(postMedia.postId), asc(postMedia.position)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, authorIds)),
    db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)),
    getStats(ids, viewerId),
    staffByTeam(teamIds),
  ]);
  const nameOf = new Map(authors.map((a) => [a.id, a.name || a.email.split("@")[0]]));
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  return rows.map((r) => {
    const roles = staff.get(r.teamId);
    return {
      id: r.id,
      teamId: r.teamId,
      teamName: teamName.get(r.teamId) ?? "",
      caption: r.caption,
      createdAt: r.createdAt,
      author: { id: r.authorId, name: nameOf.get(r.authorId) ?? "Someone", role: roles?.get(r.authorId) ?? null },
      media: media
        .filter((m) => m.postId === r.id)
        .map((m) => ({ id: m.id, type: m.type, url: m.url, displayUrl: m.displayUrl, width: m.width, height: m.height })),
      stats: stats.get(r.id) ?? { likes: 0, liked: false, comments: 0 },
      canDelete: r.authorId === viewerId || Boolean(roles?.has(viewerId)),
    };
  });
}

async function staffByTeam(teamIds: number[]) {
  const entries = await Promise.all(teamIds.map(async (id) => [id, await getStaffRoles(id)] as const));
  return new Map<number, Map<number, StaffRole>>(entries);
}

async function getStats(postIds: number[], viewerId: number) {
  const result = new Map<number, PostStats>();
  if (postIds.length === 0) return result;
  const [likes, comments] = await Promise.all([
    db
      .select({
        postId: postLikes.postId,
        count: sql<number>`count(*)`,
        mine: sql<number>`sum(case when ${postLikes.userId} = ${viewerId} then 1 else 0 end)`,
      })
      .from(postLikes)
      .where(inArray(postLikes.postId, postIds))
      .groupBy(postLikes.postId),
    db
      .select({ postId: postComments.postId, count: sql<number>`count(*)` })
      .from(postComments)
      .where(inArray(postComments.postId, postIds))
      .groupBy(postComments.postId),
  ]);
  for (const id of postIds) result.set(id, { likes: 0, liked: false, comments: 0 });
  for (const l of likes) result.set(l.postId, { ...result.get(l.postId)!, likes: Number(l.count), liked: Number(l.mine) > 0 });
  for (const c of comments) result.get(c.postId)!.comments = Number(c.count);
  return result;
}

export async function getPostStats(postId: number, viewerId: number) {
  return (await getStats([postId], viewerId)).get(postId)!;
}

export async function getComments(postId: number, teamId: number, viewerId: number): Promise<PostComment[]> {
  const [rows, roles] = await Promise.all([
    db
      .select({
        id: postComments.id,
        clientId: postComments.clientId,
        body: postComments.body,
        createdAt: postComments.createdAt,
        userId: postComments.userId,
        name: users.name,
        email: users.email,
      })
      .from(postComments)
      .innerJoin(users, eq(postComments.userId, users.id))
      .where(eq(postComments.postId, postId))
      .orderBy(asc(postComments.id)),
    getStaffRoles(teamId),
  ]);
  const viewerIsStaff = roles.has(viewerId);
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    body: r.body,
    createdAt: r.createdAt,
    author: { id: r.userId, name: r.name || r.email.split("@")[0], role: roles.get(r.userId) ?? null },
    canDelete: r.userId === viewerId || viewerIsStaff,
  }));
}

export async function getLikers(postId: number): Promise<Liker[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(postLikes)
    .innerJoin(users, eq(postLikes.userId, users.id))
    .where(eq(postLikes.postId, postId))
    .orderBy(desc(postLikes.id));
  return rows.map((r) => ({ id: r.id, name: r.name || r.email.split("@")[0] }));
}

// ---------------------------------------------------------------------------
// Posting

export type PublishFile = { key: string; displayKey?: string; thumbKey?: string; width?: number; height?: number };

/**
 * Turns files the composer already uploaded (drafts in post_uploads) into one
 * post. Every draft must be the caller's and for this team. Safe to retry: if
 * the files were already published by this person, returns that post.
 * Returns null when a file is missing (discarded, swept, or not theirs).
 */
export async function publishPost({
  userId,
  teamId,
  caption,
  files,
}: {
  userId: number;
  teamId: number;
  caption: string | null;
  files: PublishFile[];
}): Promise<{ postId: number; created: boolean } | null> {
  const keys = files.map((f) => f.key);
  const copyKeys = files.flatMap((f) => [f.displayKey, f.thumbKey]).filter((k): k is string => Boolean(k));

  const drafts = await db
    .select()
    .from(postUploads)
    .where(and(eq(postUploads.userId, userId), eq(postUploads.teamId, teamId), inArray(postUploads.fileKey, [...keys, ...copyKeys])));
  const byKey = new Map(drafts.map((d) => [d.fileKey, d]));

  if (keys.some((k) => !byKey.has(k))) {
    // A retry after the post went through: the drafts are already in a post of theirs
    const [done] = await db
      .select({ postId: postMedia.postId })
      .from(postMedia)
      .innerJoin(posts, eq(postMedia.postId, posts.id))
      .where(and(eq(postMedia.fileKey, keys[0]), eq(posts.authorId, userId), eq(posts.teamId, teamId)))
      .limit(1);
    return done ? { postId: done.postId, created: false } : null;
  }

  // A missing smaller copy isn't worth failing the post over; that file shows its original
  const copy = (key?: string) => {
    const d = key ? byKey.get(key) : undefined;
    return d?.type === "image" ? d : undefined;
  };

  const postId = await db.transaction(async (tx) => {
    const [post] = await tx.insert(posts).values({ teamId, authorId: userId, caption }).returning({ id: posts.id });
    await tx.insert(postMedia).values(
      files.map((f, position) => {
        const d = byKey.get(f.key)!;
        const display = copy(f.displayKey);
        const thumb = copy(f.thumbKey);
        return {
          postId: post.id,
          position,
          type: d.type,
          url: d.url,
          fileKey: d.fileKey,
          displayUrl: display?.url ?? null,
          displayKey: display?.fileKey ?? null,
          thumbUrl: thumb?.url ?? null,
          thumbKey: thumb?.fileKey ?? null,
          width: display ? (f.width ?? null) : null,
          height: display ? (f.height ?? null) : null,
        };
      })
    );
    await tx.delete(postUploads).where(inArray(postUploads.fileKey, [...byKey.keys()]));
    return post.id;
  });

  await sweepStaleUploads();
  return { postId, created: true };
}

/** Files taken out of the composer, or a draft left behind: gone from storage too */
export async function discardUploads(userId: number, keys: string[]) {
  const deleted = await db
    .delete(postUploads)
    .where(and(eq(postUploads.userId, userId), inArray(postUploads.fileKey, keys)))
    .returning({ fileKey: postUploads.fileKey });
  await deleteFiles(deleted.map((d) => d.fileKey));
}

async function sweepStaleUploads() {
  try {
    const stale = await db
      .delete(postUploads)
      .where(lt(postUploads.createdAt, sql`datetime('now', '-1 day')`))
      .returning({ fileKey: postUploads.fileKey });
    await deleteFiles(stale.map((s) => s.fileKey));
  } catch (error) {
    console.error("Sweeping stale feed uploads failed:", (error as Error).message);
  }
}

async function deleteFiles(keys: string[]) {
  if (keys.length === 0) return;
  try {
    await utapi.deleteFiles(keys);
  } catch (error) {
    console.error("UploadThing delete failed:", (error as Error).message);
  }
}

/** Push to the rest of the team (the "posts" category is off unless they turn it on) and tell open feeds */
export async function announcePost(post: { id: number; teamId: number; caption: string | null }, author: { id: number; name: string }) {
  const media = await db.select({ type: postMedia.type }).from(postMedia).where(eq(postMedia.postId, post.id));
  const videos = media.filter((m) => m.type === "video").length;
  const [coaches, parents, [team]] = await Promise.all([
    getCoachUserIds(post.teamId),
    getParentUserIds(post.teamId),
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, post.teamId)).limit(1),
  ]);
  const title = postSummary(author.name.split(" ")[0], media.length - videos, videos);
  const body = post.caption?.slice(0, 140) || team?.name || "Team feed";
  const others = (ids: number[]) => ids.filter((id) => id !== author.id);
  const coachSet = new Set(coaches);
  await Promise.all([
    publishFeed(post.teamId, { kind: "post" }),
    sendPush(others(coaches), "posts", { title, body, url: postPath({ teamId: post.teamId }, post.id), tag: `post-${post.id}` }),
    sendPush(others(parents.filter((id) => !coachSet.has(id))), "posts", { title, body, url: postPath("family", post.id), tag: `post-${post.id}` }),
  ]);
}

// ---------------------------------------------------------------------------
// Likes, comments, deleting

export async function setLiked(postId: number, userId: number, liked: boolean) {
  if (liked) await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
  else await db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));
}

export async function addComment({
  post,
  user,
  clientId,
  body,
}: {
  post: { id: number; teamId: number; authorId: number };
  user: { id: number; name: string };
  clientId: string;
  body: string;
}) {
  const inserted = await db
    .insert(postComments)
    .values({ postId: post.id, userId: user.id, clientId, body })
    .onConflictDoNothing()
    .returning({ id: postComments.id });
  if (inserted.length === 0) return; // A retried send that already went through

  if (post.authorId !== user.id) {
    // Parents open it in the family app, staff in the dashboard
    const isStaff = Boolean(await getTeamForUser(post.teamId, post.authorId));
    await sendPush([post.authorId], "comments", {
      title: `${user.name.split(" ")[0]} commented on your post`,
      body: body.slice(0, 140),
      url: isStaff ? postPath({ teamId: post.teamId }, post.id) : postPath("family", post.id),
      tag: `post-${post.id}-comments`,
    });
  }
}

/** Deletes a comment on this post if the viewer wrote it or is on the team's staff */
export async function deleteComment(postId: number, teamId: number, commentId: number, viewerId: number) {
  const [comment] = await db
    .select({ userId: postComments.userId })
    .from(postComments)
    .where(and(eq(postComments.id, commentId), eq(postComments.postId, postId)))
    .limit(1);
  if (!comment) return true; // Already gone
  if (comment.userId !== viewerId && !(await getTeamForUser(teamId, viewerId))) return false;
  await db.delete(postComments).where(eq(postComments.id, commentId));
  return true;
}

/** Deletes the post, its likes and comments, and its files */
export async function deletePost(postId: number) {
  const media = await db.select().from(postMedia).where(eq(postMedia.postId, postId));
  await db.transaction(async (tx) => {
    await tx.delete(postLikes).where(eq(postLikes.postId, postId));
    await tx.delete(postComments).where(eq(postComments.postId, postId));
    await tx.delete(postMedia).where(eq(postMedia.postId, postId));
    await tx.delete(posts).where(eq(posts.id, postId));
  });
  await deleteFiles(media.flatMap((m) => [m.fileKey, m.displayKey, m.thumbKey]).filter((k): k is string => Boolean(k)));
}

export async function getPostRow(postId: number) {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  return row ?? null;
}
