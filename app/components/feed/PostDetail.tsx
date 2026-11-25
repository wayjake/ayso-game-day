import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useRevalidator } from "react-router";
import { ArrowLeft, ImagesSquare, PaperPlaneRight } from "@phosphor-icons/react";
import { formatMessageTime } from "~/utils/dates";
import { likedByLabel, MAX_COMMENT, sendPostAction, type FeedPost, type Liker, type PostComment, type PostStats } from "~/utils/feed";
import { useRealtimeEvents } from "~/hooks/useConversationRealtime";
import { Card, EmptyState, buttonClass, cx } from "~/components/ui";
import { AuthorName, PostActions, PostMedia } from "~/components/feed/PostMedia";
import { PersonAvatar } from "~/components/PersonAvatar";
import { PostHeader } from "~/components/feed/FeedTimeline";
import { setNavMotion } from "~/utils/nav-motion";

// One post with its likes and comments, for the family app and the coach
// dashboard. Comments are flat and optimistic: each send carries a clientId,
// and the copy shown while sending is swapped for the saved one by that id.

export type PostDetailProps = {
  post: FeedPost | null;
  comments: PostComment[];
  likers: Liker[];
  me: { id: number; name: string };
  feedHref: string;
  showTeamName: boolean;
  channels: string[];
  /** Pins the comment box above a phone tab bar */
  composerClassName?: string;
};

export function PostDetail({ post, comments, likers, me, feedHref, showTeamName, channels, composerClassName }: PostDetailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromFeed?: boolean; focusComment?: boolean } | null;
  const { revalidate } = useRevalidator();

  // Fresh comments and likes while you're here: on realtime events, plus a poll
  // (every 15 s without realtime, a slow safety net with it)
  useRealtimeEvents(channels, (event) => {
    if (!post || event.postId === post.id) revalidate();
  });
  useEffect(() => {
    const ms = channels.length ? 60_000 : 15_000;
    const id = window.setInterval(() => document.visibilityState === "visible" && revalidate(), ms);
    return () => window.clearInterval(id);
  }, [channels.length, revalidate]);

  const back = (
    // From the feed, step back so it keeps its place; from a notification, go to it
    <button
      type="button"
      onClick={() => {
        setNavMotion("back");
        if (state?.fromFeed) navigate(-1);
        else navigate(feedHref, { viewTransition: true });
      }}
      className="-ml-2 mb-3 flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
    >
      <ArrowLeft size={18} />
      Feed
    </button>
  );

  if (!post) {
    return (
      <div className="mx-auto w-full max-w-xl">
        {back}
        <Card>
          <EmptyState
            icon={<ImagesSquare size={24} />}
            title="Post not found"
            action={
              <Link to={feedHref} className={buttonClass({ variant: "secondary" })}>
                Go to the feed
              </Link>
            }
          >
            It may have been deleted.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      {back}
      <PostBody
        key={post.id}
        post={post}
        comments={comments}
        likers={likers}
        me={me}
        showTeamName={showTeamName}
        focusComment={state?.focusComment === true}
        onDeleted={() => navigate(feedHref, { replace: true })}
        onChanged={revalidate}
        composerClassName={composerClassName}
      />
    </div>
  );
}

function PostBody({
  post,
  comments,
  likers,
  me,
  showTeamName,
  focusComment,
  onDeleted,
  onChanged,
  composerClassName,
}: {
  post: FeedPost;
  comments: PostComment[];
  likers: Liker[];
  me: { id: number; name: string };
  showTeamName: boolean;
  focusComment: boolean;
  onDeleted: () => void;
  onChanged: () => void;
  composerClassName?: string;
}) {
  // Counts from our own like or comment, until the reloaded post catches up
  const [override, setOverride] = useState<{ from: FeedPost; stats: PostStats } | null>(null);
  const stats = override?.from === post ? override.stats : post.stats;
  const applyStats = useCallback(
    (fresh: PostStats) => {
      setOverride({ from: post, stats: fresh });
      onChanged();
    },
    [post, onChanged]
  );

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PostComment[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusComment) input.current?.focus({ preventScroll: true });
  }, [focusComment]);

  const saved = new Set(comments.map((c) => c.clientId));
  const shown = [...comments.filter((c) => !hidden.has(c.id)), ...pending.filter((c) => !saved.has(c.clientId))];

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    const clientId = crypto.randomUUID();
    setDraft("");
    setError(null);
    setPending((list) => [
      ...list,
      { id: -Date.now(), clientId, body, createdAt: new Date().toISOString(), author: { id: me.id, name: me.name, role: null }, canDelete: false },
    ]);
    requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    try {
      applyStats(await sendPostAction(post.id, { intent: "comment", clientId, body }));
    } catch (e) {
      setPending((list) => list.filter((c) => c.clientId !== clientId));
      setDraft((d) => d || body);
      setError(e instanceof Error ? e.message : "Couldn't post your comment.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    setHidden((h) => new Set([...h, id]));
    try {
      applyStats(await sendPostAction(post.id, { intent: "deleteComment", commentId: id }));
    } catch {
      setHidden((h) => new Set([...h].filter((x) => x !== id)));
      setError("Couldn't delete that comment.");
    }
  };

  return (
    <Card>
      <PostHeader post={post} showTeamName={showTeamName} onDeleted={onDeleted} as="h1" />

      {/* Tall photos shouldn't push the comments off screen */}
      <div className="bg-surface-2 [&_img]:max-h-[70dvh] [&_img]:object-contain [&_video]:max-h-[70dvh]">
        <PostMedia media={post.media} caption={post.caption} />
      </div>
      <PostActions postId={post.id} stats={stats} onStats={applyStats} onCommentClick={() => input.current?.focus()} />

      <div className="space-y-3 px-4 pb-4">
        {post.caption && (
          <p className="whitespace-pre-wrap break-words text-[15px]">
            <span className="font-semibold">{post.author.name}</span> {post.caption}
          </p>
        )}
        {likers.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <div className="flex -space-x-1.5">
              {likers.slice(0, 3).map((l) => (
                <PersonAvatar key={l.id} person={l} size="sm" className="size-5 text-[8px] ring-2 ring-surface" />
              ))}
            </div>
            <span>
              Liked by <span className="font-semibold text-ink">{likedByLabel(likers)}</span>
            </span>
          </div>
        )}

        {shown.length > 0 ? (
          <ul className="space-y-3 border-t border-line pt-3">
            {shown.map((c) => {
              const sending = c.id < 0;
              return (
                <li key={c.clientId} className={cx("flex gap-2.5", sending && "opacity-60")}>
                  <PersonAvatar person={c.author} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px]">
                      <AuthorName author={c.author} />
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[15px]">{c.body}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {sending ? "Sending…" : formatMessageTime(c.createdAt)}
                      {!sending && c.canDelete && (
                        <>
                          {" · "}
                          <button type="button" onClick={() => remove(c.id)} className="font-semibold hover:text-danger">
                            Delete
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line pt-3 text-sm text-muted">No comments yet.</p>
        )}
        <div ref={end} />
      </div>

      <form
        className={cx("sticky flex items-end gap-2 rounded-b-2xl border-t border-line bg-surface px-4 py-3", composerClassName ?? "bottom-0")}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <PersonAvatar person={me} size="sm" className="mb-2" />
        <div className="min-w-0 flex-1">
          {error && <p className="mb-1 text-xs text-danger">{error}</p>}
          <label htmlFor="comment-body" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="comment-body"
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; on phones the return key adds a line
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={MAX_COMMENT}
            placeholder="Add a comment…"
            className="block max-h-32 min-h-11 w-full resize-none rounded-2xl border border-field bg-surface px-4 py-2.5 text-[16px] text-ink [field-sizing:content] placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Post comment"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:bg-primary-hover disabled:opacity-40"
        >
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </form>
    </Card>
  );
}
