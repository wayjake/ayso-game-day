import { useEffect, useState } from "react";
import { Bell, CalendarX, ChatsCircle } from "@phosphor-icons/react";
import { Sheet, SheetTitle } from "~/components/Sheet";
import type { PushState } from "~/hooks/usePush";
import { isTouchDevice } from "~/utils/pwa";

// Asks for notifications once per phone, as soon as this device could say yes
// (on an iPhone that's the first launch from the Home Screen). A sheet with a
// button rather than a cold permission popup: iOS only lets a tap ask, and a
// popup nobody expected mostly gets "Don't Allow", which can never be asked
// again. The bell in the header has the switch after that.

const ASKED_KEY = "push:asked";

function asked() {
  try {
    return Boolean(localStorage.getItem(ASKED_KEY));
  } catch {
    return true; // No storage: don't nag on every launch
  }
}

export function NotifyPrompt({ push, audience = "family" }: { push: PushState; audience?: "family" | "coach" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (push.status !== "off" || !isTouchDevice()) return;
    let retry = 0;
    const show = () => {
      if (asked()) return;
      // Something else is up: a sheet (install, after signing in) or a guided
      // tour, which is a plain role="dialog" with no close event. Look again shortly.
      if (document.querySelector('dialog[open], [role="dialog"]')) {
        window.clearTimeout(retry);
        retry = window.setTimeout(show, 1500);
        return;
      }
      try {
        localStorage.setItem(ASKED_KEY, String(Date.now()));
      } catch {}
      setOpen(true);
    };
    // "close" doesn't bubble, so catch any dialog closing in the capture phase
    const onDialogClose = () => window.setTimeout(show, 300);
    document.addEventListener("close", onDialogClose, true);
    // Let a sheet opened on the same render (install, after signing in) claim the screen first
    const timer = window.setTimeout(show, 600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      document.removeEventListener("close", onDialogClose, true);
    };
  }, [push.status]);

  if (!open) return null;

  return (
    <Sheet labelledBy="notify-prompt-title" onClose={() => setOpen(false)}>
      {(close) => (
        <>
          <SheetTitle
            id="notify-prompt-title"
            icon={
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
                <Bell size={28} weight="fill" />
              </span>
            }
            title="Turn on notifications"
            subtitle="So you never miss a change"
          />
          <ul className="mt-5 space-y-2.5 text-[15px]">
            <li className="flex gap-3">
              <ChatsCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-pitch" aria-hidden />
              {audience === "coach"
                ? "Messages and email replies from families"
                : "New messages from the coaches and the team"}
            </li>
            <li className="flex gap-3">
              <CalendarX size={20} weight="fill" className="mt-0.5 shrink-0 text-brand" aria-hidden />
              {audience === "coach"
                ? "Players who can't make a game or practice"
                : "New, moved or cancelled games and practices"}
            </li>
          </ul>
          <p className="mt-4 text-sm text-muted">Change this anytime from the bell at the top of the app.</p>

          <button
            type="button"
            className="mt-6 h-12 w-full rounded-lg bg-primary text-base font-semibold text-white shadow-card transition hover:bg-primary-hover active:translate-y-px disabled:opacity-50"
            disabled={push.busy}
            onClick={async () => {
              await push.enable();
              close();
            }}
          >
            {push.busy ? "Turning on…" : "Turn on notifications"}
          </button>
          <button type="button" onClick={close} className="mt-2 h-11 w-full text-sm font-semibold text-muted">
            Not now
          </button>
        </>
      )}
    </Sheet>
  );
}
