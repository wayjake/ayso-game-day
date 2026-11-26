// Team feed: types and helpers shared by the server (feed.server.ts) and the
// browser. Posts are ordered and paged by their id (a UUIDv7, which sorts by
// creation time as text): created_at is a one-second, zone-less
// CURRENT_TIMESTAMP, so it can't break ties.

import type { StaffRole } from "~/utils/team-roles";

export const MAX_FILES = 10;
export const MAX_VIDEOS = 3;
export const MAX_CAPTION = 500;
export const MAX_COMMENT = 1000;

export type PostStats = { likes: number; liked: boolean; comments: number };

export type FeedMediaItem = {
  id: string;
  type: "image" | "video";
  url: string;
  displayUrl: string | null;
  width: number | null;
  height: number | null;
};

export type FeedAuthor = { id: string; name: string; role: StaffRole | null };

export type FeedPost = {
  id: string;
  teamId: string;
  teamName: string;
  caption: string | null;
  createdAt: string;
  author: FeedAuthor;
  media: FeedMediaItem[];
  stats: PostStats;
  /** The viewer wrote it or is on the team's staff */
  canDelete: boolean;
};

export type FeedPage = { posts: FeedPost[]; hasMore: boolean };

/** Polling: posts newer than the newest loaded, ids still alive in the loaded window, fresh counts */
export type FeedUpdates = { posts: FeedPost[]; liveIds: string[]; stats: Record<string, PostStats> };

export type PostComment = {
  id: string;
  clientId: string;
  body: string;
  createdAt: string;
  author: FeedAuthor;
  canDelete: boolean;
};

export type Liker = { id: string; name: string };

/** Which feed a page shows: every team the parent has kids on, or one team (coach view) */
export type FeedScope = { kind: "family" } | { kind: "team"; teamId: string };

export const feedScopeKey = (scope: FeedScope) => (scope.kind === "family" ? "family" : `team:${scope.teamId}`);

export const feedScopeQuery = (scope: FeedScope) =>
  scope.kind === "family" ? "scope=family" : `team=${scope.teamId}`;

/** The post page: in the family app, or under the team (by its URL code) in the dashboard */
export function postPath(base: "family" | { teamCode: string }, postId: string) {
  return base === "family" ? `/family/feed/${postId}` : `/dashboard/team/${base.teamCode}/feed/${postId}`;
}

export type PostAction =
  | { intent: "like"; liked: boolean }
  | { intent: "comment"; clientId: string; body: string }
  | { intent: "deleteComment"; commentId: string }
  | { intent: "delete" };

/**
 * Plain fetch rather than a fetcher, so the feed's own list isn't reset by a
 * loader revalidation and errors don't go to the route error boundary.
 * Resolves to the post's fresh counts.
 */
export async function sendPostAction(postId: string, action: PostAction): Promise<PostStats> {
  const res = await fetch(`/api/feed/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Something went wrong. Try again.");
  return res.json();
}

/** "Sam posted 3 photos and a video" */
export function postSummary(name: string, photos: number, videos: number) {
  const count = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${n} ${many}`);
  const parts = [photos ? count(photos, "photo", "photos") : null, videos ? count(videos, "video", "videos") : null].filter(Boolean);
  return `${name} posted ${parts.join(" and ") || "something"}`;
}

export function likedByLabel(likers: Liker[]) {
  const names = likers.map((l) => l.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  const others = names.length - 2;
  return `${names.slice(0, 2).join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
}
