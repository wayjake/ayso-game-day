import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { ArrowDown, CircleNotch } from "@phosphor-icons/react";
import { haptic } from "~/utils/haptics";
import { cx } from "~/components/ui";

// Pull down at the top of the page to reload its data, like a native app.
// Only in the installed app: Safari and Chrome tabs have their own. It never
// stops the page's own scrolling or iOS's rubber band; it reads the finger and
// shows a disc that slides out from under the top bar. Touches that start in
// a dialog, a sheet or anything marked data-no-pull are left alone.

const ARM_AT = 72; // px of (damped) pull that arms a refresh
const MAX_PULL = 120;
const MIN_SPIN_MS = 600; // long enough to read as "it refreshed"

function isInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PullToRefresh({ top = "calc(3.5rem + var(--safe-top))" }: { top?: string }) {
  const { revalidate } = useRevalidator();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;

    const reset = () => {
      start = null;
      pulling = false;
      distance = 0;
    };

    const onStart = (e: TouchEvent) => {
      reset();
      if (refreshingRef.current || e.touches.length !== 1 || window.scrollY > 0 || !isInstalledApp()) return;
      if (e.target instanceof Element && e.target.closest("dialog, [role=dialog], [data-no-pull]")) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        // Sideways (a photo carousel) or upwards (scrolling): not ours
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) return reset();
        if (dy < 10) return;
        pulling = true;
      }
      if (window.scrollY > 0) {
        setPull(0);
        return reset();
      }
      // Damped, so it feels like pulling against a spring
      distance = Math.min(MAX_PULL, (dy - 10) * 0.55);
      setPull(distance);
    };

    const onEnd = async () => {
      if (!pulling) return reset();
      const armed = distance >= ARM_AT;
      reset();
      if (!armed) return setPull(0);

      haptic();
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(ARM_AT);
      try {
        await Promise.all([revalidateRef.current(), new Promise((r) => setTimeout(r, MIN_SPIN_MS))]);
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const armed = pull >= ARM_AT;
  const dragging = pull > 0 && !refreshing;

  return (
    <div
      aria-hidden={!refreshing}
      role="status"
      className="pointer-events-none fixed left-1/2 z-20 -ml-5"
      style={{
        top,
        transform: `translateY(${pull - 48}px)`,
        opacity: pull > 0 ? Math.min(1, pull / 40) : 0,
        // Follow the finger exactly; animate only the settle afterwards
        transition: dragging ? "none" : "transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 200ms ease-out",
      }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-raised ring-1 ring-line/70">
        {refreshing ? (
          <CircleNotch size={20} weight="bold" className="animate-spin text-primary" />
        ) : (
          <ArrowDown
            size={20}
            weight="bold"
            className={cx("transition-[color,rotate] duration-150", armed ? "rotate-180 text-primary" : "text-muted")}
          />
        )}
        <span className="sr-only">{refreshing ? "Refreshing" : ""}</span>
      </span>
    </div>
  );
}
