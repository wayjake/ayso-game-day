import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { formatMessageDateTime, formatMessageTime, parseDbTimestamp, APP_TIME_ZONE } from "~/utils/dates";
import { Badge, cx } from "~/components/ui";

// Chat thread shared by the coach dashboard and the family app. The route's
// action handles `_action=send` with a `body`; its loader marks the thread
// read, so polling it while the thread is open keeps the read marker current.

export type ThreadMessageView = {
  id: number;
  senderId: number;
  senderName: string;
  senderIsCoach: boolean;
  body: string;
  createdAt: string;
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
}: {
  messages: ThreadMessageView[];
  meId: number;
  emptyText: string;
  placeholder?: string;
  widthClass?: string; // Match the page column so the composer lines up with the thread
}) {
  const fetcher = useFetcher<{ error?: string }>();
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
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
    if (firstRender.current || nearBottom || pendingBody) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: firstRender.current ? "instant" : "smooth" });
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
    <div className="pb-28">
      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ol className="space-y-1 pb-2" aria-live="polite">
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const mine = m.senderId === meId;
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            const grouped = !newDay && prev && prev.senderId === m.senderId;
            return (
              <li key={m.id}>
                {newDay && (
                  <div className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">
                    {dayLabel(m.createdAt)}
                  </div>
                )}
                <div className={cx("flex flex-col", mine ? "items-end" : "items-start", !grouped && "mt-2")}>
                  {!mine && !grouped && (
                    <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted">
                      {m.senderName}
                      {m.senderIsCoach && <Badge tone="primary">Coach</Badge>}
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
                    {m.body}
                  </div>
                  {!m.pending && (shown[i + 1]?.senderId !== m.senderId || i === shown.length - 1) && (
                    <span className="mt-0.5 px-1 text-[11px] text-subtle">{formatMessageTime(m.createdAt)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <fetcher.Form
        ref={formRef}
        method="post"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input type="hidden" name="_action" value="send" />
        <div className={cx("mx-auto w-full px-4 sm:px-6", widthClass)}>
          {fetcher.data?.error && <p className="mb-2 text-sm text-danger">{fetcher.data.error}</p>}
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
