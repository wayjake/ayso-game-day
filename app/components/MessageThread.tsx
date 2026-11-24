import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Check, PaperPlaneRight } from "@phosphor-icons/react";
import { formatMessageDateTime, formatMessageTime, parseDbTimestamp, APP_TIME_ZONE } from "~/utils/dates";
import { Badge, cx } from "~/components/ui";

// Chat thread shared by the coach dashboard and the family app. The route's
// action handles `_action=send` with a `body`; its loader marks the thread
// read, so polling it while the thread is open keeps the read marker current.
//
// layout="window" (the default) scrolls the page with the composer fixed to the
// bottom of the screen. layout="pane" does the same on phones, and from lg up
// fills its flex parent: the messages scroll inside it and the composer sits
// at its foot. Which one applies is decided by CSS, and the scroll code checks
// which element actually scrolls, so there's no media query in JS.

export type ThreadMessageView = {
  id: number;
  senderId: number | null; // Null for an email reply from a family with no account
  senderName: string;
  senderIsCoach: boolean;
  body: string;
  createdAt: string;
  viaEmail?: boolean;
  emailedTo?: string | null;
  fullEmail?: string | null;
  announcement?: { id: number; subject: string; ask: "none" | "ack" | "reply" } | null;
};

const POLL_MS = 5000;
const MAX_LENGTH = 2000;

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(
    parseDbTimestamp(value)
  );
}

export function MessageThread({
  messages,
  meId,
  emptyText,
  placeholder = "Write a message",
  widthClass = "max-w-3xl",
  showEmailDetails = false,
  acknowledged,
  composerExtra,
  layout = "window",
}: {
  messages: ThreadMessageView[];
  meId: number;
  emptyText: string;
  placeholder?: string;
  widthClass?: string; // Match the page column so the composer lines up with the thread
  showEmailDetails?: boolean; // Coaches: who a message was emailed to, and full emails
  acknowledged?: number[]; // Parents: announcement messages already answered "Got it" (enables the button)
  composerExtra?: ReactNode; // Inside the form above the composer, e.g. the "Also send by email" checkbox
  layout?: "window" | "pane";
}) {
  const pane = layout === "pane";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fetcher = useFetcher<{ error?: string }>();
  const ackFetcher = useFetcher();
  const revalidator = useRevalidator();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

  const sending = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "send";
  const pendingBody = sending ? String(fetcher.formData?.get("body") ?? "") : null;

  // Poll while the tab is visible, and catch up as soon as it comes back
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [revalidator]);

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

  const submit = () => {
    if (!draft.trim() || sending) return;
    fetcher.submit(formRef.current);
  };

  const shown: (ThreadMessageView & { pending?: boolean })[] = pendingBody
    ? [
        ...messages,
        { id: -1, senderId: meId, senderName: "", senderIsCoach: false, body: pendingBody, createdAt: new Date().toISOString(), pending: true },
      ]
    : messages;

  return (
    // Bottom padding leaves room for the fixed composer
    <div className={cx("pb-28", pane && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pb-0")}>
      <div ref={scrollerRef} className={cx(pane && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-6 lg:pt-2")}>
      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ol className="space-y-1 pb-2" aria-live="polite">
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const mine = m.senderId != null && m.senderId === meId;
            const sameSender = (a?: ThreadMessageView, b?: ThreadMessageView) =>
              Boolean(a && b && a.senderId === b.senderId && (a.senderId != null || a.senderName === b.senderName));
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            const grouped = !newDay && sameSender(prev, m);
            const announcementBody = m.announcement ? m.body.slice(m.announcement.subject.length).trim() : m.body;
            const ackPending = ackFetcher.formData?.get("messageId") === String(m.id);
            const showAck = acknowledged && m.announcement?.ask === "ack";
            const acked = acknowledged?.includes(m.id) || ackPending;
            return (
              <li key={m.id}>
                {newDay && (
                  <div className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">
                    {dayLabel(m.createdAt)}
                  </div>
                )}
                <div className={cx("flex flex-col", mine ? "items-end" : "items-start", !grouped && "mt-2")}>
                  {(!mine || m.viaEmail) && !grouped && (
                    <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted">
                      {mine ? "You" : m.senderName}
                      {m.senderIsCoach && <Badge tone="primary">Coach</Badge>}
                      {m.viaEmail && <Badge>By email</Badge>}
                    </div>
                  )}
                  <div
                    className={cx(
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug sm:max-w-[70%]",
                      mine ? "bg-primary text-white" : "bg-surface text-ink ring-1 ring-line",
                      m.pending && "opacity-60"
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
                  {showEmailDetails && m.fullEmail && (
                    <details className="mt-1 max-w-[85%] px-1 text-xs text-muted sm:max-w-[70%]">
                      <summary className="cursor-pointer">Show the full email</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-sans">{m.fullEmail}</pre>
                    </details>
                  )}
                  {!m.pending && (!sameSender(shown[i + 1], m) || i === shown.length - 1) && (
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
      )}
      </div>

      <fetcher.Form
        ref={formRef}
        method="post"
        className={cx(
          "fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
          pane && "lg:static lg:z-auto lg:shrink-0 lg:pb-4"
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input type="hidden" name="_action" value="send" />
        <div className={cx("mx-auto w-full px-4 sm:px-6", widthClass, pane && "lg:max-w-none")}>
          {fetcher.data?.error && <p className="mb-2 text-sm text-danger">{fetcher.data.error}</p>}
          {composerExtra}
          <div className="flex items-end gap-2">
            <label htmlFor="message-body" className="sr-only">Message</label>
            <textarea
              ref={textareaRef}
              id="message-body"
              name="body"
              rows={1}
              maxLength={MAX_LENGTH}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
    </div>
  );
}
