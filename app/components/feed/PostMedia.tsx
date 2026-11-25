import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CaretLeft, CaretRight, ChatCircle, Heart } from "@phosphor-icons/react";
import { cx } from "~/components/ui";
import { StaffBadge } from "~/components/StaffBadge";
import { sendPostAction, type FeedAuthor, type FeedMediaItem, type PostStats } from "~/utils/feed";
import { navMotion } from "~/utils/nav-motion";
import { haptic } from "~/utils/haptics";

// A post's files (one on its own, several as a swipeable carousel) and the
// like/comment row under it. Ported from disney-social's PostMedia.

/** `href`: tapping a photo opens the post (videos keep their own controls) */
export function PostMedia({ media, caption, href }: { media: FeedMediaItem[]; caption: string | null; href?: string }) {
  return media.length === 1 ? <Media item={media[0]} caption={caption} href={href} /> : <Carousel media={media} caption={caption} href={href} />;
}

function Carousel({ media, caption, href }: { media: FeedMediaItem[]; caption: string | null; href?: string }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const last = media.length - 1;

  const goTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(i, last)) * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={track}
        // overflow-x forces overflow-y to auto; pin it so a vertical swipe scrolls the page
        className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {media.map((item, i) => (
          <div
            key={item.id}
            className="grid aspect-[4/5] min-h-0 w-full flex-none snap-center snap-always place-items-center overflow-hidden bg-surface-2"
            aria-label={`${i + 1} of ${media.length}`}
          >
            <Media item={item} caption={caption} href={href} fill />
          </div>
        ))}
      </div>
      {index > 0 && <CarouselArrow dir="prev" onClick={() => goTo(index - 1)} />}
      {index < last && <CarouselArrow dir="next" onClick={() => goTo(index + 1)} />}
      <span className="absolute right-3 top-3 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-semibold tabular text-white">
        {index + 1}/{media.length}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
        {media.map((item, i) => (
          <span key={item.id} className={cx("size-1.5 rounded-full shadow transition", i === index ? "bg-white" : "bg-white/50")} />
        ))}
      </div>
    </div>
  );
}

function CarouselArrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  const Icon = dir === "prev" ? CaretLeft : CaretRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous" : "Next"}
      className={cx(
        "absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink shadow-card backdrop-blur transition hover:bg-white",
        dir === "prev" ? "left-2" : "right-2"
      )}
    >
      <Icon size={18} weight="bold" />
    </button>
  );
}

function Media({ item, caption, href, fill = false }: { item: FeedMediaItem; caption: string | null; href?: string; fill?: boolean }) {
  // min-h-0: a tall file mustn't stretch its 4:5 slide
  const size = fill ? "size-full min-h-0 object-contain" : "w-full";
  // The 1280px copy's size holds the space while it loads, so the feed doesn't jump
  const dims = { width: item.width ?? undefined, height: item.height ?? undefined };
  if (item.type === "image") {
    const img = <img src={item.displayUrl ?? item.url} alt={caption ?? ""} loading="lazy" decoding="async" draggable={false} {...dims} className={cx(size, "bg-surface-2")} />;
    return href ? (
      <Link to={href} state={{ fromFeed: true }} {...navMotion("push")} className={cx("block", fill && "size-full min-h-0")} aria-label="Open post">
        {img}
      </Link>
    ) : (
      img
    );
  }
  return (
    <video
      src={item.url}
      // The frame at 3 s stands in until play, so none of the video downloads before then
      poster={item.displayUrl ?? undefined}
      preload={item.displayUrl ? "none" : "metadata"}
      controls
      playsInline
      {...dims}
      className={cx(size, "bg-ink")}
    />
  );
}

/** Like and comment buttons. Likes are optimistic and roll back if the request fails. */
export function PostActions({
  postId,
  stats,
  onStats,
  commentsTo,
  onCommentClick,
}: {
  postId: number;
  stats: PostStats;
  /** Called with the server's counts once a like lands */
  onStats: (stats: PostStats) => void;
  /** The post page, from the feed; on the post page itself, onCommentClick focuses the box */
  commentsTo?: string;
  onCommentClick?: () => void;
}) {
  const [optimistic, setOptimistic] = useState<PostStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the latest tap's response counts, so quick double taps settle right
  const seq = useRef(0);
  const shown = optimistic ?? stats;

  const toggleLike = async () => {
    const liked = !shown.liked;
    if (liked) haptic();
    const n = ++seq.current;
    setError(null);
    setOptimistic({ ...shown, liked, likes: Math.max(0, shown.likes + (liked ? 1 : -1)) });
    try {
      const fresh = await sendPostAction(postId, { intent: "like", liked });
      if (n !== seq.current) return;
      onStats(fresh);
      setOptimistic(null);
    } catch (e) {
      if (n !== seq.current) return;
      setOptimistic(null);
      setError(e instanceof Error ? e.message : "Couldn't save your like.");
    }
  };

  const btn = "flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition hover:bg-surface-2";
  const comment = (
    <>
      <ChatCircle size={22} />
      <span className="tabular">{shown.comments || ""}</span>
    </>
  );

  return (
    <div className="px-1.5 py-1">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={shown.liked}
          aria-label={shown.liked ? "Unlike" : "Like"}
          className={cx(btn, shown.liked ? "text-coral" : "text-muted")}
        >
          <Heart size={22} weight={shown.liked ? "fill" : "regular"} className={cx("transition-transform", shown.liked && "like-pop scale-110")} />
          <span className="tabular">{shown.likes || ""}</span>
        </button>
        {commentsTo ? (
          <Link to={commentsTo} state={{ fromFeed: true, focusComment: true }} {...navMotion("push")} className={cx(btn, "text-muted")} aria-label="Comments">
            {comment}
          </Link>
        ) : (
          <button type="button" onClick={onCommentClick} className={cx(btn, "text-muted")} aria-label="Comment">
            {comment}
          </button>
        )}
      </div>
      {error && <p className="px-3 pb-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People

const avatarSizes = { sm: "size-7 text-[10px]", md: "size-9 text-xs" };

/** Initials in a colored circle; the color comes from the person's id so it stays the same */
export function PersonAvatar({ person, size = "md", className }: { person: { id: number; name: string }; size?: keyof typeof avatarSizes; className?: string }) {
  const parts = person.name.trim().split(/\s+/);
  const letters = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.[0] ?? "?").toUpperCase();
  const tones = ["bg-primary", "bg-coral", "bg-pitch", "bg-brand", "bg-primary-ink"];
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center rounded-full font-bold text-white", tones[person.id % tones.length], avatarSizes[size], className)}
    >
      {letters}
    </span>
  );
}

/** Name with a staff badge for coaches */
export function AuthorName({ author, children }: { author: FeedAuthor; children?: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate font-semibold">{author.name}</span>
      {author.role && <StaffBadge role={author.role} short />}
      {children}
    </span>
  );
}

