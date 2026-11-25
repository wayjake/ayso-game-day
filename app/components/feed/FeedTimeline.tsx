import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { ArrowUp, ImagesSquare, Trash } from "@phosphor-icons/react";
import { useTeamFeed } from "~/hooks/useTeamFeed";
import { formatMessageDateTime, formatMessageTime } from "~/utils/dates";
import { sendPostAction, type FeedPage, type FeedPost, type FeedScope, type PostStats } from "~/utils/feed";
import { Button, Card, EmptyState, cx } from "~/components/ui";
import { Composer } from "~/components/feed/Composer";
import { AuthorName, PersonAvatar, PostActions, PostMedia } from "~/components/feed/PostMedia";

// The team feed page body, shared by the family app and the coach dashboard.

export function FeedTimeline({
  feed: initial,
  scope,
  me,
  teams,
  channels,
  postHref,
  showTeamName,
}: {
  feed: FeedPage;
  scope: FeedScope;
  me: { id: number; name: string };
  /** Teams the composer can post to */
  teams: { id: number; name: string }[];
  channels: string[];
  postHref: (postId: number) => string;
  /** Label each post with its team (a parent with kids on several teams) */
  showTeamName: boolean;
}) {
  const { revalidate } = useRevalidator();
  const feed = useTeamFeed({ initial, scope, viewerId: me.id, channels });

  return (
    <div className="mx-auto w-full max-w-xl">
      <Composer me={me} teams={teams} onPosted={() => void revalidate()} />

      {feed.newCount > 0 && (
        <button
          type="button"
          onClick={feed.showNew}
          className="fixed left-1/2 top-[calc(4.5rem+var(--safe-top))] z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-card"
        >
          <ArrowUp size={16} weight="bold" />
          {feed.newCount} new {feed.newCount === 1 ? "post" : "posts"}
        </button>
      )}

      {feed.posts.length === 0 && !feed.hasMore ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-line-strong">
          <EmptyState icon={<ImagesSquare size={24} />} title="No posts yet">
            Share a photo or video from practice or a game. Only coaches and families on the team can see it.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {feed.posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              href={postHref(post.id)}
              showTeamName={showTeamName}
              onDeleted={feed.remove}
              onStats={feed.patchStats}
            />
          ))}
        </div>
      )}

      {feed.hasMore && <LoadMore onLoad={feed.loadMore} loading={feed.loadingMore} failed={feed.loadError} count={feed.posts.length} />}
    </div>
  );
}

/** Loads the next page as it nears the screen; doubles as a manual retry button */
function LoadMore({ onLoad, loading, failed, count }: { onLoad: () => void; loading: boolean; failed: boolean; count: number }) {
  const ref = useRef<HTMLButtonElement>(null);

  // Re-observing after each page re-checks visibility, so a short page keeps filling the screen
  useEffect(() => {
    const el = ref.current;
    if (!el || failed) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && onLoad(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onLoad, failed, count]);

  return (
    <Button ref={ref} variant="secondary" className="mx-auto mt-8 flex" onClick={onLoad} disabled={loading}>
      {loading ? "Loading…" : failed ? "Couldn't load. Try again" : "Load older posts"}
    </Button>
  );
}

function PostCard({
  post,
  href,
  showTeamName,
  onDeleted,
  onStats,
}: {
  post: FeedPost;
  href: string;
  showTeamName: boolean;
  onDeleted: (id: number) => void;
  onStats: (id: number, stats: PostStats) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <PostHeader post={post} showTeamName={showTeamName} onDeleted={() => onDeleted(post.id)} />
      <PostMedia media={post.media} caption={post.caption} href={href} />
      <PostActions postId={post.id} stats={post.stats} onStats={(stats) => onStats(post.id, stats)} commentsTo={href} />
      {post.caption && <p className="whitespace-pre-wrap break-words px-4 pb-2 text-[15px]">{post.caption}</p>}
      {post.stats.comments > 0 ? (
        <Link to={href} state={{ fromFeed: true, focusComment: true }} className="block px-4 pb-3 text-sm text-muted hover:text-ink">
          View {post.stats.comments === 1 ? "1 comment" : `all ${post.stats.comments} comments`}
        </Link>
      ) : (
        <div className="pb-1" />
      )}
    </Card>
  );
}

/** Avatar, name, time and the delete control; shared with the post page */
export function PostHeader({
  post,
  showTeamName,
  onDeleted,
  as: Heading = "p",
}: {
  post: FeedPost;
  showTeamName: boolean;
  onDeleted: () => void;
  as?: "p" | "h1";
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await sendPostAction(post.id, { intent: "delete" });
      onDeleted();
    } catch (e) {
      setDeleting(false);
      setError(e instanceof Error ? e.message : "Couldn't delete it.");
    }
  };

  return (
    <header className="px-4 py-3">
      <div className="flex items-center gap-3">
        <PersonAvatar person={post.author} />
        <div className="min-w-0 flex-1">
          <Heading className="flex min-w-0 text-[15px]">
            <AuthorName author={post.author} />
          </Heading>
          <p className="truncate text-xs text-muted">
            <time dateTime={post.createdAt} title={formatMessageDateTime(post.createdAt)}>
              {formatMessageTime(post.createdAt)}
            </time>
            {showTeamName && <> · {post.teamName}</>}
          </p>
        </div>
        {post.canDelete &&
          (confirming ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="grid size-9 place-items-center rounded-full text-subtle transition hover:bg-danger-soft hover:text-danger"
              aria-label="Delete post"
            >
              <Trash size={18} />
            </button>
          ))}
      </div>
      {error && <p className={cx("mt-2 text-xs text-danger")}>{error}</p>}
    </header>
  );
}
