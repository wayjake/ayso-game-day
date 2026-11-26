import { useCallback, useEffect, useRef, useState } from "react";
import { feedScopeKey, feedScopeQuery, type FeedPage, type FeedPost, type FeedScope, type FeedUpdates, type PostStats } from "~/utils/feed";
import { useRealtimeEvents } from "~/hooks/useConversationRealtime";
import { compareIds, maxId } from "~/utils/ids";

// The feed's list: starts from the loader's first page, pages older posts in
// as you scroll, and polls for what changed (right away when a realtime event
// says so). New posts that arrive while you're scrolled down are held back so
// nothing jumps, until you tap the "new posts" pill or scroll to the top.
// Ported from disney-social's use-timeline-feed, keyed by post id (a UUIDv7,
// which sorts by time as text) instead of time.

const byNewest = (a: FeedPost, b: FeedPost) => compareIds(b.id, a.id);

/** Upsert by id and keep newest first */
function merge(list: FeedPost[], incoming: FeedPost[]) {
  if (!incoming.length) return list;
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, p);
  return [...byId.values()].sort(byNewest);
}

const sameStats = (a: PostStats, b: PostStats) => a.likes === b.likes && a.liked === b.liked && a.comments === b.comments;

/** Swap in fresh counts, keeping object identity where nothing changed */
function withStats(list: FeedPost[], stats: Record<string, PostStats>) {
  let changed = false;
  const next = list.map((p) => {
    const s = stats[p.id];
    if (!s || sameStats(s, p.stats)) return p;
    changed = true;
    return { ...p, stats: s };
  });
  return changed ? next : list;
}

// The list as you left it, so coming back from a post page restores every
// paged-in post and the browser can put you back where you were. One entry,
// keyed by who's looking and which feed, so switching teams or accounts in the
// same tab never mixes lists. Written from an effect: browser only.
let saved: { key: string; posts: FeedPost[]; hasMore: boolean } | null = null;

function restore(key: string, initial: FeedPage) {
  if (!saved || saved.key !== key) return null;
  const known = new Set(saved.posts.map((p) => p.id));
  return {
    posts: merge(saved.posts, initial.posts),
    hasMore: saved.hasMore,
    held: new Set(initial.posts.filter((p) => !known.has(p.id)).map((p) => p.id)),
  };
}

const isNearTop = () => window.scrollY < 120;

export function useTeamFeed({
  initial,
  scope,
  viewerId,
  channels,
}: {
  initial: FeedPage;
  scope: FeedScope;
  viewerId: string;
  /** Realtime channels to listen on; empty when realtime isn't set up */
  channels: string[];
}) {
  const cacheKey = `${viewerId}:${feedScopeKey(scope)}`;
  const scopeQuery = feedScopeQuery(scope);
  // Slow safety net when realtime is on; events trigger an update right away
  const pollMs = channels.length ? 60_000 : 20_000;

  const [restored] = useState(() => restore(cacheKey, initial));
  const [posts, setPosts] = useState(restored?.posts ?? initial.posts);
  const [hasMore, setHasMore] = useState(restored?.hasMore ?? initial.hasMore);
  const [held, setHeld] = useState<ReadonlySet<string>>(restored?.held ?? new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const removed = useRef(new Set<string>());
  // Bumped on reset so responses for the old list are dropped
  const generation = useRef(0);

  // A fresh loader result (a new post of ours, another team) restarts from page one
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    generation.current++;
    setSource(initial);
    setPosts(initial.posts.filter((p) => !removed.current.has(p.id)));
    setHasMore(initial.hasMore);
    setHeld(new Set());
  }

  const latest = useRef({ posts, hasMore });
  latest.current = { posts, hasMore };

  useEffect(() => {
    saved = { key: cacheKey, posts, hasMore };
  }, [cacheKey, posts, hasMore]);

  // ——— Updates: new posts, deletions, fresh counts ———
  const busy = useRef(false);
  const again = useRef(false);
  const tick = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    if (busy.current) {
      again.current = true; // An event arrived mid-request; check once more after
      return;
    }
    busy.current = true;
    const gen = generation.current;
    try {
      const { posts: now, hasMore } = latest.current;
      // Empty when nothing is loaded yet: every id sorts after ""
      const since = maxId(now.map((p) => p.id)) ?? "";
      const params = new URLSearchParams(scopeQuery);
      params.set("since", since);
      // Older than the last loaded post comes in through paging instead
      const oldest = hasMore ? now.at(-1)?.id : undefined;
      if (oldest) params.set("oldest", oldest);

      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok || gen !== generation.current) return;
      const update: FeedUpdates = await res.json();
      if (gen !== generation.current) return;

      const alive = new Set(update.liveIds);
      const incoming = update.posts.filter((p) => !removed.current.has(p.id));
      const known = new Set(latest.current.posts.map((p) => p.id));
      const fresh = incoming.filter((p) => !known.has(p.id)).map((p) => p.id);

      setPosts((list) =>
        merge(
          withStats(
            list.filter((p) => p.id > since || alive.has(p.id) || (oldest !== undefined && p.id < oldest)),
            update.stats
          ),
          incoming
        )
      );
      if (isNearTop()) setHeld(new Set());
      else if (fresh.length) setHeld((h) => new Set([...h, ...fresh]));
    } catch {
      // Offline at the field: try again next time
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void tick();
      }
    }
  }, [scopeQuery]);

  useEffect(() => {
    // A restored list may be stale (likes, comments, deletions): catch up now
    if (restored) void tick();
    const id = window.setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pollMs, restored, tick]);

  useRealtimeEvents(channels, () => void tick());

  // Scrolling back to the top shows anything held back
  const heldCount = posts.filter((p) => held.has(p.id)).length;
  useEffect(() => {
    if (!heldCount) return;
    const onScroll = () => isNearTop() && setHeld(new Set());
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [heldCount]);

  // ——— Paging older posts ———
  const loadingRef = useRef(false);
  const loadMore = useCallback(async () => {
    const last = latest.current.posts.at(-1);
    if (loadingRef.current || !last || !latest.current.hasMore) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError(false);
    const gen = generation.current;
    try {
      const params = new URLSearchParams(scopeQuery);
      params.set("before", last.id);
      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) throw new Error(res.statusText);
      const page: FeedPage = await res.json();
      if (gen !== generation.current) return;
      setPosts((list) => merge(list, page.posts.filter((p) => !removed.current.has(p.id))));
      setHasMore(page.hasMore);
    } catch {
      setLoadError(true);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [scopeQuery]);

  const showNew = useCallback(() => {
    setHeld(new Set());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const remove = useCallback((id: string) => {
    removed.current.add(id);
    setPosts((list) => list.filter((p) => p.id !== id));
  }, []);

  // A like or comment made here: no need to wait for the next update
  const patchStats = useCallback((id: string, stats: PostStats) => {
    setPosts((list) => withStats(list, { [id]: stats }));
  }, []);

  return {
    posts: held.size ? posts.filter((p) => !held.has(p.id)) : posts,
    hasMore,
    loadingMore,
    loadError,
    loadMore,
    newCount: heldCount,
    showNew,
    remove,
    patchStats,
  };
}
