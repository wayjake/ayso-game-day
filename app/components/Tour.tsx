import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { TOURS, getTour, hasSeen, type Tour, type ToursSeen } from "~/utils/tours";
import { Badge, Button, cx } from "~/components/ui";
import { ArrowLeft, ArrowRight, CheckCircle, Play, Question, X } from "@phosphor-icons/react";

// Guided tours plus the Help sheet behind the "?" button. Steps are cards: a
// bottom sheet on phones, placed next to the highlighted element on bigger
// screens, centered when a step has no element or it isn't on the page.
// Finishing or skipping a tour saves it to the coach's account.

type TourContextValue = {
  start: (id: string) => void;
  openHelp: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTours() {
  return useContext(TourContext);
}

async function save(body: { action: "seen"; tourId: string } | { action: "reset" }) {
  try {
    const res = await fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return (json?.seen ?? null) as ToursSeen | null;
  } catch {
    return null;
  }
}

export function TourProvider({ teamId, initialSeen, children }: { teamId: number; initialSeen: ToursSeen; children: ReactNode }) {
  const [seen, setSeen] = useState<ToursSeen>(initialSeen);
  const [active, setActive] = useState<{ tour: Tour; index: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const location = useLocation();
  const autoStarted = useRef(false);

  const start = useCallback((id: string) => {
    const tour = getTour(id);
    if (!tour) return;
    setHelpOpen(false);
    setActive({ tour, index: 0 });
  }, []);

  const finish = useCallback(async (tour: Tour) => {
    setActive(null);
    setSeen((s) => ({ ...s, [tour.id]: tour.version }));
    const saved = await save({ action: "seen", tourId: tour.id });
    if (saved) setSeen(saved);
  }, []);

  // First visit: the welcome tour. First time in Messages after that: the
  // announcements tour. Never both at once, and never over the Help sheet.
  useEffect(() => {
    if (active || helpOpen || autoStarted.current) return;
    const welcome = getTour("welcome")!;
    const announcements = getTour("announcements")!;
    // Only start where the tour's first step lives, so it never pulls you off the page you came for
    const startsHere = (tour: Tour) => (tour.steps[0].path?.(teamId) ?? location.pathname) === location.pathname;
    let next: Tour | null = null;
    if (!hasSeen(seen, welcome)) next = startsHere(welcome) ? welcome : null;
    else if (!hasSeen(seen, announcements) && startsHere(announcements)) next = announcements;
    if (!next) return;
    autoStarted.current = true;
    const timer = setTimeout(() => setActive({ tour: next!, index: 0 }), 600);
    return () => clearTimeout(timer);
  }, [seen, location.pathname, active, helpOpen, teamId]);

  // Allow a later auto-start on another page once this one is finished
  useEffect(() => {
    if (!active) autoStarted.current = false;
  }, [location.pathname, active]);

  return (
    <TourContext.Provider value={{ start, openHelp: () => setHelpOpen(true) }}>
      {children}
      {active && (
        <TourRunner
          teamId={teamId}
          tour={active.tour}
          index={active.index}
          onIndex={(index) => setActive({ tour: active.tour, index })}
          onDone={() => finish(active.tour)}
        />
      )}
      {helpOpen && (
        <HelpSheet
          seen={seen}
          onStart={start}
          onClose={() => setHelpOpen(false)}
          onReset={async () => {
            setSeen({});
            const saved = await save({ action: "reset" });
            if (saved) setSeen(saved);
          }}
        />
      )}
    </TourContext.Provider>
  );
}

export function HelpButton({ className }: { className?: string }) {
  const tours = useTours();
  if (!tours) return null;
  return (
    <button
      type="button"
      onClick={tours.openHelp}
      data-tour="help-button"
      aria-label="Help and tours"
      className={cx(
        "flex h-9 w-9 items-center justify-center rounded-full text-muted ring-1 ring-line transition hover:bg-surface-2 hover:text-ink",
        className
      )}
    >
      <Question size={18} weight="bold" />
    </button>
  );
}

// ---------------------------------------------------------------------------

function useTargetRect(target: string | undefined, key: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    setRect(null);
    if (!target) return;
    let el: Element | null = null;
    let tries = 0;
    let frame = 0;

    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect(r.width > 0 && r.height > 0 ? r : null);
    };
    // Wait for the page to render after a navigation
    const find = () => {
      el = document.querySelector(`[data-tour="${target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(measure, 350);
      } else if (tries++ < 25) {
        frame = window.setTimeout(find, 100);
      }
    };
    find();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target, key]);

  return rect;
}

function TourRunner({
  teamId,
  tour,
  index,
  onIndex,
  onDone,
}: {
  teamId: number;
  tour: Tour;
  index: number;
  onIndex: (index: number) => void;
  onDone: () => void;
}) {
  const step = tour.steps[index];
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const last = index === tour.steps.length - 1;

  const path = step.path?.(teamId);
  useEffect(() => {
    if (path && location.pathname !== path) navigate(path);
  }, [path, location.pathname, navigate]);

  const rect = useTargetRect(path && location.pathname !== path ? undefined : step.target, `${tour.id}-${index}-${location.pathname}`);

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight") last ? onDone() : onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, onDone, onIndex]);

  // Desktop placement: below the element if there's room, otherwise above
  const pad = 8;
  const cardStyle: React.CSSProperties = {};
  if (rect && typeof window !== "undefined" && window.innerWidth >= 640) {
    const width = 360;
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    const below = rect.bottom + pad + 220 < window.innerHeight;
    Object.assign(cardStyle, { width, left, ...(below ? { top: rect.bottom + pad + 8 } : { bottom: window.innerHeight - rect.top + pad + 8 }) });
  }
  const placed = Object.keys(cardStyle).length > 0;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/* Dim everything except the highlighted element */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-all duration-300"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgb(16 27 45 / 0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/55" />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={cardStyle}
        className={cx(
          "fixed rounded-2xl bg-surface p-5 shadow-2xl ring-1 ring-line outline-none",
          placed
            ? ""
            : rect
              ? "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-1/2 sm:w-[380px] sm:-translate-x-1/2"
              : "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2"
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {tour.title} · {index + 1} of {tour.steps.length}
          </span>
          <button type="button" onClick={onDone} className="-mr-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Skip tour">
            <X size={16} weight="bold" />
          </button>
        </div>
        <h2 id="tour-title" className="text-lg font-semibold leading-snug">{step.title}</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{step.body}</p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex gap-1" aria-hidden>
            {tour.steps.map((_, i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-1.5 bg-line-strong")} />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onIndex(index - 1)}>
                <ArrowLeft size={16} weight="bold" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? onDone() : onIndex(index + 1))}>
              {last ? "Done" : "Next"}
              {!last && <ArrowRight size={16} weight="bold" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const FAQ: { q: string; a: string }[] = [
  {
    q: "Where do families' email replies go?",
    a: "Into that family's private thread in Messages, the same place their app messages go. Other families never see them.",
  },
  {
    q: "Why does it say “Probably opened”?",
    a: "Email opens are a guess. Apple Mail opens every email automatically, and many apps block the tracking. Replies and “Got it” taps are exact, so ask for one when it matters.",
  },
  {
    q: "What if a family isn't on the app?",
    a: "They get announcements and your replies by email and can answer by email. When they join, their thread comes with them.",
  },
  {
    q: "Who can see my notes about a family?",
    a: "Only coaches on this team. Families never do.",
  },
  {
    q: "What's in “Emails to sort”?",
    a: "Email that came in from an address we don't recognize, like a work account. Pick the family and it moves into their thread.",
  },
];

function HelpSheet({
  seen,
  onStart,
  onClose,
  onReset,
}: {
  seen: ToursSeen;
  onStart: (id: string) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close help" onClick={onClose} className="fixed inset-0 bg-ink/40" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface shadow-2xl outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[400px] sm:rounded-none sm:rounded-l-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="help-title" className="text-lg font-semibold">Help</h2>
          <button type="button" onClick={onClose} className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={18} weight="bold" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tours</h3>
          <ul className="space-y-2">
            {TOURS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onStart(t.id)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 ring-line transition hover:bg-surface-2"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Play size={18} weight="fill" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold">
                      {t.title}
                      {hasSeen(seen, t) && (
                        <Badge tone="success">
                          <CheckCircle size={12} weight="fill" />
                          Seen
                        </Badge>
                      )}
                    </span>
                    <span className="block text-sm text-muted">{t.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Quick answers</h3>
          <div className="divide-y divide-line rounded-xl ring-1 ring-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-3 py-2.5">
                <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-2">
                    {f.q}
                    <span aria-hidden className="text-muted transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-1.5 text-sm text-muted">{f.a}</p>
              </details>
            ))}
          </div>

          <button type="button" onClick={onReset} className="mt-6 text-sm font-medium text-primary hover:underline">
            Show tours again automatically
          </button>
        </div>
      </div>
    </div>
  );
}
