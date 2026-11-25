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
        "tap flex h-9 w-9 items-center justify-center rounded-full text-muted ring-1 ring-line transition hover:bg-surface-2 hover:text-ink",
        className
      )}
    >
      <Question size={18} weight="bold" />
    </button>
  );
}

// ---------------------------------------------------------------------------

type Box = { top: number; left: number; width: number; height: number };

// How the spotlight and the card glide from one step to the next
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";
const MOVE_MS = 320;
const LEAVE_MS = 160;
const PAD = 8;
const GAP = 12;
const CARD_WIDTH = 380;
const DIM = "rgb(16 27 45 / 0.55)";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * Where the step's element is on screen. The previous box stays until the
 * next one is found, so the spotlight glides between steps instead of
 * blinking out. Scrolls the element into view only when it isn't already, and
 * follows it every frame until it stops moving. `moving` is true while
 * gliding; once settled, the spotlight tracks scrolling directly (no easing
 * lag behind the page).
 */
function useTarget(target: string | undefined, key: string, hold: boolean, coveredBottom: () => number) {
  const [box, setBox] = useState<Box | null>(null);
  const [moving, setMoving] = useState(false);
  const covered = useRef(coveredBottom);
  covered.current = coveredBottom;

  useLayoutEffect(() => {
    // On the way to the step's page: leave the spotlight where it is until the page renders
    if (hold) return;
    setMoving(true);
    let el: Element | null = null;
    let tries = 0;
    let timer = 0;
    let frame = 0;
    let stable = 0;
    let last = "";
    let settled = false;

    const read = (): Box | null => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    };
    const settle = () => {
      timer = window.setTimeout(() => {
        settled = true;
        setMoving(false);
      }, MOVE_MS);
    };
    // Follow it while a smooth scroll or late layout moves it, then stop
    const track = () => {
      const b = read();
      setBox(b);
      const k = b ? [b.top, b.left, b.width, b.height].map(Math.round).join() : "";
      stable = k === last ? stable + 1 : 0;
      last = k;
      if (stable < 5) frame = requestAnimationFrame(track);
      else settle();
    };
    const find = () => {
      el = target ? document.querySelector(`[data-tour="${target}"]`) : null;
      if (!el) {
        // Still rendering after a navigation? Otherwise it's a centered step
        if (target && tries++ < 20) timer = window.setTimeout(find, 100);
        else {
          setBox(null);
          settle();
        }
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.top < GAP || r.bottom > window.innerHeight - covered.current() - GAP) {
        el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      }
      track();
    };
    find();

    const follow = () => {
      if (settled) setBox(read());
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [target, key, hold]);

  return { box, moving };
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
  const { w, h } = useViewport();
  const phone = w < 640;
  const [cardHeight, setCardHeight] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const path = step.path?.(teamId);
  const navigating = Boolean(path && location.pathname !== path);
  useEffect(() => {
    if (path && location.pathname !== path) navigate(path);
  }, [path, location.pathname, navigate]);

  const { box, moving } = useTarget(step.target, `${tour.id}-${index}-${location.pathname}`, navigating, () =>
    phone ? (cardRef.current?.offsetHeight ?? 0) + GAP : 0
  );

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCardHeight(el.offsetHeight));
    observer.observe(el);
    setCardHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  // Fade out, then hand back
  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return; // A double tap on Done
    left.current = true;
    setLeaving(true);
    window.setTimeout(onDone, reducedMotion() ? 0 : LEAVE_MS);
  }, [onDone]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
      if (e.key === "ArrowRight") last ? leave() : onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, leave, onIndex]);

  const glide = moving && !reducedMotion();
  const transition = (props: string[]) => (glide ? props.map((p) => `${p} ${MOVE_MS}ms ${EASE}`).join(", ") : "none");

  // The spotlight never unmounts: with nothing to point at it shrinks to a
  // point in the middle, so the dim closes in and opens out like an iris.
  const hole = box
    ? { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }
    : { top: h / 2, left: w / 2, width: 0, height: 0 };

  // Bigger screens: the card sits below the element if it fits, else above;
  // centered when there's no element. Phones: a sheet along the bottom.
  let card: { x: number; y: number } | null = null;
  if (!phone) {
    if (box) {
      const x = Math.min(Math.max(16, box.left + box.width / 2 - CARD_WIDTH / 2), w - CARD_WIDTH - 16);
      const below = box.top + box.height + PAD + GAP;
      const y = below + cardHeight + 16 < h ? below : Math.max(16, box.top - PAD - GAP - cardHeight);
      card = { x, y };
    } else {
      card = { x: (w - CARD_WIDTH) / 2, y: Math.max(16, (h - cardHeight) / 2) };
    }
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      style={{ opacity: leaving ? 0 : 1, transition: `opacity ${LEAVE_MS}ms ease-out` }}
    >
      <div
        aria-hidden
        className="tour-fade pointer-events-none fixed top-0 left-0 rounded-xl"
        style={{
          transform: `translate(${hole.left}px, ${hole.top}px)`,
          width: hole.width,
          height: hole.height,
          // Same two shadows either way so they can animate: the ring, then the dim around it
          boxShadow: `0 0 0 2px ${box ? "var(--color-primary)" : "transparent"}, 0 0 0 9999px ${DIM}`,
          transition: transition(["transform", "width", "height", "box-shadow"]),
        }}
      />

      <div
        className={cx("fixed", phone ? "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]" : "top-0 left-0")}
        style={
          card
            ? { width: CARD_WIDTH, transform: `translate(${card.x}px, ${card.y}px)`, transition: transition(["transform"]) }
            : undefined
        }
      >
        <div
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          className="tour-pop rounded-2xl bg-surface p-5 shadow-2xl ring-1 ring-line outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold tracking-wider text-muted uppercase">
              {tour.title} · {index + 1} of {tour.steps.length}
            </span>
            <button
              type="button"
              onClick={leave}
              className="tap -mr-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Skip tour"
            >
              <X size={16} weight="bold" />
            </button>
          </div>
          {/* Keyed by step so the words fade in fresh while the card glides */}
          <div key={index} className="tour-step">
            <h2 id="tour-title" className="text-lg leading-snug font-semibold">
              {step.title}
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{step.body}</p>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex gap-1" aria-hidden>
              {tour.steps.map((_, i) => (
                <span
                  key={i}
                  className={cx("h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-primary" : "w-1.5 bg-line-strong")}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={() => onIndex(index - 1)}>
                  <ArrowLeft size={16} weight="bold" />
                  Back
                </Button>
              )}
              <Button size="sm" onClick={() => (last ? leave() : onIndex(index + 1))}>
                {last ? "Done" : "Next"}
                {!last && <ArrowRight size={16} weight="bold" />}
              </Button>
            </div>
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
    a: "An announcement to every family is posted in the team chat, and replies go under it there, where everyone on the app can see them. Everything else lands in the family's private thread with whoever they're answering, which nobody else sees.",
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
      <button type="button" aria-label="Close help" onClick={onClose} className="help-backdrop fixed inset-0 bg-ink/40" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="help-panel fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface shadow-2xl outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[400px] sm:rounded-none sm:rounded-l-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="help-title" className="text-lg font-semibold">Help</h2>
          <button type="button" onClick={onClose} className="tap -mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
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
