import { useEffect, useId, useRef, useState } from "react";
import { Question } from "@phosphor-icons/react";

// "Send by email" for a coach writing to a family. A message is emailed only
// when this is ticked, and thread replies never are. It starts ticked for
// families who'd otherwise not hear about it (no app notifications) and
// unticked for those who get a push; the coach's choice is remembered per
// thread on this device.

export function EmailToggle({
  email,
  pushReady,
  conversationId,
}: {
  email: string;
  pushReady: boolean;
  conversationId: string;
}) {
  const storageKey = `send-email:${conversationId}`;
  const [checked, setChecked] = useState(!pushReady);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setChecked(saved == null ? !pushReady : saved === "1");
    } catch {}
  }, [pushReady, storageKey]);

  const change = (next: boolean) => {
    setChecked(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {}
  };

  return (
    <div className="relative mb-2 flex items-center gap-1.5 text-xs text-muted">
      <label className="flex min-w-0 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          name="alsoEmail"
          value="1"
          checked={checked}
          onChange={(e) => change(e.target.checked)}
          className="size-4 shrink-0 accent-primary"
        />
        <span className="truncate">
          Send by email to <span className="font-medium text-ink">{email}</span>
        </span>
      </label>
      <HelpTip
        text={
          pushReady
            ? "They have the app with notifications on, so they'll get a push either way. Tick this to email it too."
            : "They don't have app notifications on, so without email they won't know you wrote until they open the app."
        }
      />
    </div>
  );
}

// A "?" that shows a short explanation on hover, focus or tap
function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="group flex shrink-0">
      <button
        type="button"
        aria-label="Why?"
        aria-describedby={id}
        onClick={() => setOpen(!open)}
        className="tap flex size-6 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-ink"
      >
        <Question size={14} weight="bold" />
      </button>
      {/* Above the whole row (positioned by it), since the composer sits at the bottom of the screen */}
      <span
        id={id}
        role="tooltip"
        className={
          "pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 w-full max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-snug text-white shadow-overlay transition-opacity " +
          (open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")
        }
      >
        {text}
      </span>
    </span>
  );
}
