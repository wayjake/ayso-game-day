import type { ReactNode, RefObject } from "react";
import { useLocation, useNavigation } from "react-router";
import { cx } from "~/components/ui";

// Switching tabs: the moment a tab is tapped, the next page's outline turns in
// over the old one, so the app answers straight away even while the page is
// still loading. When its data is in, React Router commits the page inside the
// tab View Transition (navMotion("tab")), which cross-fades the outline into
// the real thing.
//
// It's a layer over the page rather than a stand-in for <Outlet />, so the old
// page stays mounted underneath (a cancelled navigation finds it as it was)
// and layouts that depend on the outlet being a direct flex child (Messages)
// are untouched. Everything comes from useNavigation(), with no state of its
// own, so it can't get stuck after a redirect, an error or a cancel.

export type SkeletonKind = "overview" | "events" | "people" | "chats" | "feed" | "form";

export type TransitionTab = {
  to: string;
  /** Only this exact path, like NavLink's end */
  end?: boolean;
  /** Other paths that count as this tab (Families and Tasks under Roster) */
  also?: string[];
  skeleton: SkeletonKind;
  /** The destination page's container, so the outline lines up with what replaces it */
  frame: string;
};

const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

function tabIndex(tabs: TransitionTab[], pathname: string) {
  const path = trim(pathname);
  return tabs.findIndex(({ to, end, also }) => {
    const base = trim(to);
    if (path === base) return true;
    if (!end && path.startsWith(`${base}/`)) return true;
    return Boolean(also?.some((p) => path === trim(p) || path.startsWith(`${trim(p)}/`)));
  });
}

export function TabTransition({ tabs, below }: { tabs: TransitionTab[]; below: RefObject<HTMLElement | null> }) {
  const navigation = useNavigation();
  const { pathname } = useLocation();

  // Only a plain GET navigation to another tab: not a form submission or the redirect after one
  const pending = navigation.state === "loading" && !navigation.formMethod ? navigation.location : undefined;
  if (!pending || typeof document === "undefined") return null;
  // Browser back/forward and the iOS edge swipe: iOS already animated it (see nav-motion.ts)
  if (document.documentElement.dataset.nav === "none") return null;

  const from = tabIndex(tabs, pathname);
  const to = tabIndex(tabs, pending.pathname);
  if (to === -1 || to === from) return null;
  const tab = tabs[to];

  // Cover from the bottom of the header (or the tab row) down. Read here rather
  // than in an effect so the first frame is already in place; this only ever
  // renders mid-navigation in the browser.
  const top = Math.max(0, below.current?.getBoundingClientRect().bottom ?? 0);

  return (
    <div
      className="tab-turn-layer fixed inset-x-0 bottom-0 z-20 overflow-hidden bg-canvas"
      style={{ top, paddingTop: top === 0 ? "var(--safe-top)" : undefined }}
      data-turn={from === -1 || to > from ? "next" : "prev"}
    >
      <span role="status" className="sr-only">
        Loading
      </span>
      <div aria-hidden className={cx("tab-turn", tab.frame)}>
        <Skeleton kind={tab.skeleton} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outlines of each tab's page: grey bars where the text goes, white cards
// where the cards go

function Bar({ className }: { className?: string }) {
  return <div className={cx("skeleton-bar h-3.5 rounded-full", className)} />;
}

function Box({ className }: { className?: string }) {
  return <div className={cx("skeleton-bar rounded-xl", className)} />;
}

function Shell({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl bg-surface shadow-card ring-1 ring-line/70", className)}>{children}</div>;
}

function Header({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="w-full max-w-md space-y-3">
        <Bar className="h-7 w-40" />
        <Bar className="w-11/12" />
      </div>
      {actions && <Box className="h-10 w-36" />}
    </div>
  );
}

function Rows({ count, lead }: { count: number; lead: "date" | "avatar" }) {
  return (
    <Shell className="divide-y divide-line/70">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          {lead === "date" ? <Box className="h-14 w-12 shrink-0" /> : <div className="skeleton-bar h-10 w-10 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2.5">
            <Bar className={i % 2 ? "w-1/3" : "w-2/5"} />
            <Bar className={cx("h-3", i % 2 ? "w-2/3" : "w-1/2")} />
          </div>
        </div>
      ))}
    </Shell>
  );
}

function Skeleton({ kind }: { kind: SkeletonKind }) {
  switch (kind) {
    case "overview":
      return (
        <div className="space-y-6">
          <Shell className="flex flex-col items-center gap-4 px-6 py-12">
            <Box className="h-14 w-14" />
            <Bar className="h-5 w-48" />
            <Bar className="w-64 max-w-full" />
            <Box className="mt-2 h-11 w-44" />
          </Shell>
          <Shell className="space-y-4 p-5">
            <Bar className="h-4 w-28" />
            <Bar className="w-3/4" />
          </Shell>
          <Rows count={2} lead="date" />
        </div>
      );
    case "events":
      return (
        <>
          <Header actions />
          <Bar className="mb-3 h-4 w-24" />
          <Rows count={4} lead="date" />
        </>
      );
    case "people":
      return (
        <>
          <Header actions />
          <Rows count={6} lead="avatar" />
        </>
      );
    case "chats":
      return (
        <>
          <Header />
          <Rows count={5} lead="avatar" />
        </>
      );
    case "feed":
      return (
        <>
          <Header />
          <div className="space-y-5">
            {[0, 1].map((i) => (
              <Shell key={i} className="overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className="skeleton-bar h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Bar className="w-32" />
                    <Bar className="h-3 w-20" />
                  </div>
                </div>
                <div className="skeleton-bar aspect-[4/3] w-full" />
                <div className="space-y-2.5 p-4">
                  <Bar className="w-2/3" />
                </div>
              </Shell>
            ))}
          </div>
        </>
      );
    case "form":
      return (
        <>
          <Header />
          <div className="space-y-6">
            {[3, 2].map((fields, i) => (
              <Shell key={i} className="space-y-5 p-5 sm:p-6">
                <Bar className="h-4 w-36" />
                {Array.from({ length: fields }, (_, j) => (
                  <div key={j} className="space-y-2">
                    <Bar className="h-3 w-24" />
                    <Box className="h-11 w-full" />
                  </div>
                ))}
              </Shell>
            ))}
          </div>
        </>
      );
  }
}
