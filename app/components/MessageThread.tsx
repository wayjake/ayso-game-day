import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher, useFetchers, useLocation, useRevalidator, useSubmit } from "react-router";
import { ArrowBendUpLeft, ArrowLeft, ChatCircle, Check, PaperPlaneRight } from "@phosphor-icons/react";
import { formatMessageDateTime, formatMessageTime, parseDbTimestamp, APP_TIME_ZONE } from "~/utils/dates";
import { REACTIONS } from "~/utils/reactions";
import { Badge, cx } from "~/components/ui";
import { StaffBadge } from "~/components/StaffBadge";
import type { StaffRole } from "~/utils/team-roles";
import { typingLabel, useConversationRealtime, type RealtimeConfig, type Typist, type TypingWhere } from "~/hooks/useConversationRealtime";

// Chat thread shared by the coach dashboard and the family app. The route's
// action handles `_action=send` (a `body`, and `replyTo` for a thread reply)
// and `_action=react` (`messageId`, `emoji`; toggles). Its loader marks the
// conversation read, so polling it while open keeps the read marker current.
//
// Tap a message to react or reply. Replies live in a thread under the message
// (one level deep), opened with ?thread=<id> so a notification can link to it.
//
// With realtime set up (Ably), new messages and reactions arrive the moment
// they're posted and polling drops to a slow safety net.
//
// layout="window" (the default) scrolls the page with the composer fixed to the
// bottom of the screen. layout="pane" does the same on phones, and from lg up
// fills its flex parent: the messages scroll inside it and the composer sits
// at its foot. Which one applies is decided by CSS, and the scroll code checks
// which element actually scrolls, so there's no media query in JS.

export type ReactionView = { emoji: string; count: number; mine: boolean; names: string[] };

export type ThreadMessageView = {
  id: number;
  senderId: number | null; // Null for an email reply from a family with no account
  senderName: string;
  senderIsCoach: boolean;
  senderRole?: StaffRole | null; // Staff role badge; families see it too
  body: string;
  createdAt: string;
  viaEmail?: boolean;
  emailedTo?: string | null;
  fullEmail?: string | null;
  announcement?: { id: number; subject: string; ask: "none" | "ack" | "reply" } | null;
  reactions?: ReactionView[];
  thread?: { count: number; lastAt: string; names: string[] } | null;
};

type Shown = ThreadMessageView & { pending?: boolean };

const POLL_MS = 5000;
const POLL_MS_LIVE = 30000; // Realtime connected: polling only catches anything missed
const MAX_LENGTH = 2000;
const MAIN_SEND = "send-main";
const THREAD_SEND = "send-thread";

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(
    parseDbTimestamp(value)
  );
}

export function MessageThread({
  messages,
  thread = null,
  meId,
  emptyText,
  placeholder = "Write a message",
  widthClass = "max-w-3xl",
  showEmailDetails = false,
  acknowledged,
  composerExtra,
  realtime = null,
  layout = "window",
  initialDraft = null,
}: {
  layout?: "window" | "pane";
  /** Text to start the main composer with, e.g. a drafted task reminder. Fills the box each time it changes. */
  initialDraft?: string | null;
  messages: ThreadMessageView[];
  /** Ably channel for this conversation and my name for typing indicators; null polls instead */
  realtime?: RealtimeConfig;
  /** The open thread (?thread=), if any */
  thread?: { root: ThreadMessageView; replies: ThreadMessageView[] } | null;
  meId: number;
  emptyText: string;
  placeholder?: string;
  widthClass?: string; // Match the page column so the composer lines up with the thread
  showEmailDetails?: boolean; // Coaches: who a message was emailed to, and full emails
  acknowledged?: number[]; // Parents: announcement messages already answered "Got it" (enables the button)
  composerExtra?: ReactNode; // Inside the form above the composer, e.g. the "Also send by email" checkbox
}) {
  const pane = layout === "pane";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const revalidator = useRevalidator();
  const reactions = usePendingReactions();
  const mainSend = useFetcher<{ error?: string }>({ key: MAIN_SEND });
  const pendingBody = pendingSendBody(mainSend);

  // An event that arrives mid-reload waits for it to finish, then reloads again
  const missed = useRef(false);
  const live = useConversationRealtime(realtime, () => {
    if (revalidator.state === "idle") revalidator.revalidate();
    else missed.current = true;
  });
  useEffect(() => {
    if (revalidator.state === "idle" && missed.current) {
      missed.current = false;
      revalidator.revalidate();
    }
  }, [revalidator]);

  // Poll while the tab is visible, and catch up as soon as it comes back
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    };
    const timer = setInterval(tick, live.connected ? POLL_MS_LIVE : POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [revalidator, live.connected]);

  // Stay pinned to the newest message when the user is already near it
  const lastId = messages[messages.length - 1]?.id ?? 0;
  const firstRender = useRef(true);
  useLayoutEffect(() => {
    // The pane scrolls itself only where its CSS makes it scrollable (lg up)
    const el = scrollerRef.current;
    const inPane = el && getComputedStyle(el).overflowY === "auto" ? el : null;
    const nearBottom = inPane
      ? inPane.scrollTop + inPane.clientHeight >= inPane.scrollHeight - 200
      : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
    if (firstRender.current || nearBottom || pendingBody) {
      const behavior = firstRender.current ? "instant" : "smooth";
      if (inPane) inPane.scrollTo({ top: inPane.scrollHeight, behavior });
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    }
    firstRender.current = false;
  }, [lastId, pendingBody]);

  const shown: Shown[] = pendingBody ? [...messages, pendingMessage(meId, pendingBody)] : messages;

  return (
    // Bottom padding leaves room for the fixed composer
    <div className={cx("pb-28", pane && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pb-0")}>
      <div ref={scrollerRef} className={cx(pane && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-6 lg:pt-2")}>
        {shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">{emptyText}</p>
        ) : (
          <MessageList
            messages={shown.map(reactions.apply)}
            meId={meId}
            showEmailDetails={showEmailDetails}
            acknowledged={acknowledged}
            canReply
          />
        )}
      </div>

      <Composer
        fetcherKey={MAIN_SEND}
        placeholder={placeholder}
        className={cx(
          "fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
          pane && "lg:static lg:z-auto lg:shrink-0 lg:pb-4"
        )}
        innerClassName={cx("mx-auto w-full px-4 sm:px-6", widthClass, pane && "lg:max-w-none")}
        extra={composerExtra}
        initialDraft={initialDraft}
        onTyping={live.setTyping}
        typists={live.typists.filter((t) => t.where == null)}
      />

      {thread && (
        <ThreadPanel
          key={thread.root.id}
          root={reactions.apply(thread.root)}
          replies={thread.replies.map(reactions.apply)}
          meId={meId}
          showEmailDetails={showEmailDetails}
          widthClass={widthClass}
          onTyping={live.setTyping}
          typists={live.typists.filter((t) => t.where === thread.root.id)}
        />
      )}
    </div>
  );
}

// A thread over the whole screen: the message, then its replies, with its own composer
function ThreadPanel({
  root,
  replies,
  meId,
  showEmailDetails,
  widthClass,
  onTyping,
  typists,
}: {
  root: ThreadMessageView;
  replies: ThreadMessageView[];
  meId: number;
  showEmailDetails: boolean;
  widthClass: string;
  onTyping: (where: TypingWhere) => void;
  typists: Typist[];
}) {
  const { pathname } = useLocation();
  const send = useFetcher<{ error?: string }>({ key: THREAD_SEND });
  const pendingBody = pendingSendBody(send);
  const scroller = useRef<HTMLDivElement>(null);
  const shown: Shown[] = pendingBody ? [...replies, pendingMessage(meId, pendingBody)] : replies;
  const people = [...new Set([root.senderName, ...replies.map((r) => r.senderName)].map((n) => n.split(" ")[0]))];

  // The page behind shouldn't scroll while the thread is open
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, []);

  const lastId = shown[shown.length - 1]?.id ?? 0;
  const firstRender = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
    if (firstRender.current || nearBottom || pendingBody) {
      el.scrollTo({ top: el.scrollHeight, behavior: firstRender.current ? "instant" : "smooth" });
    }
    firstRender.current = false;
  }, [lastId, pendingBody]);

  return (
    <div role="dialog" aria-label="Thread" className="fixed inset-0 z-50 flex flex-col bg-canvas pt-[env(safe-area-inset-top)]">
      <div className="border-b border-line bg-canvas/95 backdrop-blur">
        <div className={cx("mx-auto flex w-full items-center gap-3 px-4 py-3 sm:px-6", widthClass)}>
          <Link
            to={pathname}
            replace
            preventScrollReset
            className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Back to the chat"
          >
            <ArrowLeft size={20} weight="bold" />
          </Link>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">Thread</h2>
            <p className="truncate text-xs text-muted">{people.join(", ")}</p>
          </div>
        </div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain">
        <div className={cx("mx-auto w-full px-4 pb-4 sm:px-6", widthClass)}>
          <MessageList messages={[root]} meId={meId} showEmailDetails={showEmailDetails} />
          <div className="my-3 flex items-center gap-3 text-xs font-semibold text-subtle">
            <span className="h-px flex-1 bg-line" />
            {replies.length === 0 ? "No replies yet" : replies.length === 1 ? "1 reply" : `${replies.length} replies`}
            <span className="h-px flex-1 bg-line" />
          </div>
          {shown.length > 0 && <MessageList messages={shown} meId={meId} showEmailDetails={showEmailDetails} after={root.createdAt} />}
        </div>
      </div>

      <Composer
        fetcherKey={THREAD_SEND}
        replyTo={root.id}
        placeholder="Reply…"
        autoFocus
        onTyping={onTyping}
        typists={typists}
        className="border-t border-line bg-canvas pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        innerClassName={cx("mx-auto w-full px-4 sm:px-6", widthClass)}
      />
    </div>
  );
}

function MessageList({
  messages,
  meId,
  showEmailDetails,
  acknowledged,
  canReply = false,
  after,
}: {
  messages: Shown[];
  /** When the list continues from an earlier message (a thread's replies), skip repeating its day */
  after?: string;
  meId: number;
  showEmailDetails: boolean;
  acknowledged?: number[];
  /** Offer "Reply" and show thread links (the main list, not inside a thread) */
  canReply?: boolean;
}) {
  const ackFetcher = useFetcher();
  const submit = useSubmit();
  const [selected, setSelected] = useState<number | null>(null);

  // Tap anywhere else, or Esc, to put the reaction bar away
  useEffect(() => {
    if (selected == null) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-message="${selected}"]`)) setSelected(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  const react = (messageId: number, emoji: string) => {
    submit(
      { _action: "react", messageId: String(messageId), emoji },
      { method: "post", navigate: false, fetcherKey: `react-${messageId}-${emoji}-${Date.now()}` }
    );
  };

  const sameSender = (a?: ThreadMessageView, b?: ThreadMessageView) =>
    Boolean(a && b && a.senderId === b.senderId && (a.senderId != null || a.senderName === b.senderName));

  return (
    <ol className="space-y-1 pb-2" aria-live="polite">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const mine = m.senderId != null && m.senderId === meId;
        const prevDay = prev?.createdAt ?? after;
        const newDay = !prevDay || dayLabel(prevDay) !== dayLabel(m.createdAt);
        // Reactions or a thread under the previous message break the run
        const prevHasExtras = Boolean(prev?.reactions?.length || (canReply && prev?.thread));
        const grouped = !newDay && sameSender(prev, m) && !prevHasExtras;
        const hasExtras = Boolean(m.reactions?.length || (canReply && m.thread));
        const announcementBody = m.announcement ? m.body.slice(m.announcement.subject.length).trim() : m.body;
        const ackPending = ackFetcher.formData?.get("messageId") === String(m.id);
        const showAck = acknowledged && m.announcement?.ask === "ack";
        const acked = acknowledged?.includes(m.id) || ackPending;
        const isSelected = selected === m.id;
        return (
          <li key={m.id} data-message={m.id}>
            {newDay && (
              <div className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">{dayLabel(m.createdAt)}</div>
            )}
            <div className={cx("flex flex-col", mine ? "items-end" : "items-start", !grouped && "mt-2")}>
              {(!mine || m.viaEmail) && !grouped && (
                <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted">
                  {mine ? "You" : m.senderName}
                  {m.senderRole ? <StaffBadge role={m.senderRole} short /> : m.senderIsCoach && <Badge tone="primary">Coach</Badge>}
                  {m.viaEmail && <Badge>By email</Badge>}
                </div>
              )}
              <div
                // Tapping the bubble shows the reaction bar; buttons inside (Got it) keep working
                onClick={(e) => {
                  if (m.pending || (e.target as Element).closest("button, a, summary")) return;
                  if (window.getSelection()?.toString()) return; // Selecting text, not tapping
                  setSelected(isSelected ? null : m.id);
                }}
                className={cx(
                  "max-w-[85%] cursor-pointer whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug transition sm:max-w-[70%]",
                  mine ? "bg-primary text-white" : "bg-surface text-ink ring-1 ring-line",
                  m.pending && "cursor-default opacity-60",
                  isSelected && "ring-2 ring-primary/40 ring-offset-2 ring-offset-canvas"
                )}
                title={m.pending ? "Sending…" : formatMessageDateTime(m.createdAt)}
              >
                {m.announcement && (
                  <span className={cx("mb-1 block text-[11px] font-semibold uppercase tracking-wider", mine ? "text-white/70" : "text-muted")}>
                    Announcement
                  </span>
                )}
                {m.announcement && <strong className="mb-1 block">{m.announcement.subject}</strong>}
                {announcementBody}
                {showAck && (
                  <ackFetcher.Form method="post" className="mt-2">
                    <input type="hidden" name="_action" value="ack" />
                    <input type="hidden" name="messageId" value={m.id} />
                    <button
                      type="submit"
                      disabled={acked}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-white disabled:bg-success-soft disabled:text-success"
                    >
                      <Check size={16} weight="bold" />
                      {acked ? "Coaches know you've seen it" : "Got it"}
                    </button>
                  </ackFetcher.Form>
                )}
              </div>

              {isSelected && (
                <div
                  role="toolbar"
                  aria-label="React or reply"
                  className="mt-1.5 flex items-center gap-0.5 rounded-full bg-surface p-1 shadow-overlay ring-1 ring-line"
                >
                  {REACTIONS.map((emoji) => {
                    const on = m.reactions?.some((r) => r.emoji === emoji && r.mine);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          react(m.id, emoji);
                          setSelected(null);
                        }}
                        aria-label={on ? `Remove ${emoji}` : `React ${emoji}`}
                        aria-pressed={on}
                        className={cx(
                          "flex size-10 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-surface-2",
                          on && "bg-primary-soft"
                        )}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                  {canReply && (
                    <Link
                      to={`?thread=${m.id}`}
                      preventScrollReset
                      onClick={() => setSelected(null)}
                      className="ml-1 flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-surface-2"
                    >
                      <ArrowBendUpLeft size={16} weight="bold" /> Reply
                    </Link>
                  )}
                </div>
              )}

              {m.reactions && m.reactions.length > 0 && (
                <div className={cx("mt-1 flex flex-wrap gap-1 px-1", mine && "justify-end")}>
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => react(m.id, r.emoji)}
                      title={r.names.join(", ")}
                      aria-label={`${r.emoji} ${r.count}: ${r.names.join(", ")}${r.mine ? ". Tap to remove yours" : ". Tap to add yours"}`}
                      aria-pressed={r.mine}
                      className={cx(
                        "flex h-7 items-center gap-1 rounded-full px-2 text-sm ring-1 transition",
                        r.mine ? "bg-primary-soft text-primary-ink ring-primary/40" : "bg-surface text-muted ring-line hover:bg-surface-2"
                      )}
                    >
                      <span>{r.emoji}</span>
                      <span className="tabular text-xs font-semibold">{r.count}</span>
                    </button>
                  ))}
                </div>
              )}

              {canReply && m.thread && (
                <Link
                  to={`?thread=${m.id}`}
                  preventScrollReset
                  className="mt-1 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs font-semibold text-primary hover:underline"
                >
                  <ChatCircle size={14} weight="fill" />
                  {m.thread.count === 1 ? "1 reply" : `${m.thread.count} replies`}
                  <span className="font-normal text-muted">
                    · {m.thread.names.slice(0, 3).join(", ")}
                    {m.thread.names.length > 3 && ` +${m.thread.names.length - 3}`} · {formatMessageTime(m.thread.lastAt)}
                  </span>
                </Link>
              )}

              {showEmailDetails && m.fullEmail && (
                <details className="mt-1 max-w-[85%] px-1 text-xs text-muted sm:max-w-[70%]">
                  <summary className="cursor-pointer">Show the full email</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-sans">{m.fullEmail}</pre>
                </details>
              )}
              {!m.pending && (!sameSender(next, m) || hasExtras || i === messages.length - 1) && (
                <span className="mt-0.5 px-1 text-[11px] text-subtle">
                  {formatMessageTime(m.createdAt)}
                  {showEmailDetails && m.emailedTo && ` · emailed to ${m.emailedTo}`}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Composer({
  fetcherKey,
  replyTo,
  placeholder,
  className,
  innerClassName,
  extra,
  autoFocus = false,
  onTyping,
  typists = [],
  initialDraft = null,
}: {
  initialDraft?: string | null;
  onTyping?: (where: TypingWhere) => void;
  typists?: Typist[];
  fetcherKey: string;
  replyTo?: number;
  placeholder: string;
  className: string;
  innerClassName: string;
  extra?: ReactNode;
  autoFocus?: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>({ key: fetcherKey });
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const sending = fetcher.state !== "idle";
  const id = `message-body-${fetcherKey}`;

  // A new draft handed in (the page stays mounted between conversations)
  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);
  const typingText = typingLabel(typists);

  // Tell the others I'm typing: at most every 3s, and stop after 5s of quiet
  const typing = useRef<{ at: number; timer?: number }>({ at: 0 });
  const signalTyping = (active: boolean) => {
    if (!onTyping) return;
    window.clearTimeout(typing.current.timer);
    if (!active) {
      if (typing.current.at) onTyping(false);
      typing.current.at = 0;
      return;
    }
    if (Date.now() - typing.current.at > 3000) {
      typing.current.at = Date.now();
      onTyping(replyTo ?? null);
    }
    typing.current.timer = window.setTimeout(() => signalTyping(false), 5000);
  };
  const stopTyping = useRef(signalTyping);
  stopTyping.current = signalTyping;
  useEffect(() => () => stopTyping.current(false), []);

  // Clear the box once the send lands
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) setDraft("");
  }, [fetcher.state, fetcher.data]);

  // Grow the textarea with its content, up to a limit
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft]);

  // Keyboards only: on a phone, focusing would throw the keyboard up over the thread
  useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (!draft.trim() || sending) return;
    signalTyping(false);
    fetcher.submit(formRef.current);
  };

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="hidden" name="_action" value="send" />
      {replyTo != null && <input type="hidden" name="replyTo" value={replyTo} />}
      <div className={innerClassName}>
        {typingText && (
          <p className="mb-2 flex items-center gap-2 px-1 text-xs text-muted" aria-live="polite">
            <span className="flex gap-0.5" aria-hidden>
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="size-1.5 animate-bounce rounded-full bg-subtle" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
            {typingText}
          </p>
        )}
        {fetcher.data?.error && <p className="mb-2 text-sm text-danger">{fetcher.data.error}</p>}
        {extra}
        <div className="flex items-end gap-2">
          <label htmlFor={id} className="sr-only">
            {replyTo != null ? "Reply" : "Message"}
          </label>
          <textarea
            ref={textareaRef}
            id={id}
            name="body"
            rows={1}
            maxLength={MAX_LENGTH}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              signalTyping(e.target.value.trim().length > 0);
            }}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; on phones the return key adds a line
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="block min-h-11 w-full resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-[16px] text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:bg-primary-hover disabled:opacity-40"
          >
            <PaperPlaneRight size={20} weight="fill" />
          </button>
        </div>
      </div>
    </fetcher.Form>
  );
}

function pendingSendBody(fetcher: { state: string; formData?: FormData }) {
  return fetcher.state !== "idle" && fetcher.formData?.get("_action") === "send" ? String(fetcher.formData.get("body") ?? "") : null;
}

function pendingMessage(meId: number, body: string): Shown {
  return { id: -1, senderId: meId, senderName: "", senderIsCoach: false, body, createdAt: new Date().toISOString(), pending: true };
}

// Reactions show the moment they're tapped, before the server answers
function usePendingReactions() {
  const toggles = useFetchers()
    .filter((f) => f.state !== "idle" && f.formData?.get("_action") === "react")
    .map((f) => ({ messageId: Number(f.formData!.get("messageId")), emoji: String(f.formData!.get("emoji")) }));

  const apply = <T extends ThreadMessageView>(m: T): T => {
    const mine = toggles.filter((t) => t.messageId === m.id);
    if (mine.length === 0) return m;
    let reactions = [...(m.reactions ?? [])];
    for (const { emoji } of mine) {
      const existing = reactions.find((r) => r.emoji === emoji);
      if (existing?.mine) {
        reactions = reactions
          .map((r) => (r.emoji === emoji ? { ...r, mine: false, count: r.count - 1, names: r.names.filter((n) => n !== "You") } : r))
          .filter((r) => r.count > 0);
      } else if (existing) {
        reactions = reactions.map((r) => (r.emoji === emoji ? { ...r, mine: true, count: r.count + 1, names: [...r.names, "You"] } : r));
      } else {
        reactions.push({ emoji, count: 1, mine: true, names: ["You"] });
      }
    }
    return { ...m, reactions };
  };

  return { apply };
}
