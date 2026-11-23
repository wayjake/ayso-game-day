import { useEffect, useId, useRef, useState } from "react";
import { Question } from "@phosphor-icons/react";

// "Also send by email" for a coach writing to a family. Families with the app
// and notifications on get a push for every message, so the email copy is
// optional for them (and unchecking saves a double ping). Everyone else needs
// the email to know there's a message, so it's locked on. The server applies
// the same rule. Unchecking is remembered per thread on this device.

export function EmailToggle({
  email,
  pushReady,
  conversationId,
}: {
  email: string;
  pushReady: boolean;
  conversationId: number;
}) {
  const storageKey = `email-off:${conversationId}`;
  const [checked, setChecked] = useState(true);
  useEffect(() => {
    if (!pushReady) return setChecked(true);
    try {
      setChecked(!localStorage.getItem(storageKey));
    } catch {}
  }, [pushReady, storageKey]);

  const change = (next: boolean) => {
    setChecked(next);
    try {
      if (next) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, "1");
    } catch {}
  };

  return (
    <div className="relative mb-2 flex items-center gap-1.5 text-xs text-muted">
      <label
        className={pushReady ? "flex min-w-0 cursor-pointer items-center gap-2" : "flex min-w-0 items-center gap-2"}
      >
        <input
          type="checkbox"
          name="alsoEmail"
          value="1"
          checked={checked}
          disabled={!pushReady}
          onChange={(e) => change(e.target.checked)}
          className="size-4 shrink-0 accent-primary disabled:opacity-60"
        />
        <span className="truncate">
          Also send by email to <span className="font-medium text-ink">{email}</span>
        </span>
      </label>
      {/* A disabled checkbox isn't submitted; say yes explicitly */}
      {!pushReady && <input type="hidden" name="alsoEmail" value="1" />}
      <HelpTip
        text={
          pushReady
            ? "They have the app with notifications on, so they'll get this as a push either way. Uncheck to skip the email and the double ping."
            : "Locked on: they haven't turned on notifications in the app yet, so email is how they'll know you wrote. Once they do, you can turn this off."
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
        className="flex size-6 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-ink"
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
