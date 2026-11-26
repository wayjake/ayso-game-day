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

/** "inbox" is the coach Messages workspace (a list column and a pane from lg); "chats" is the family's plain list */
export type SkeletonKind = "overview" | "events" | "people" | "chats" | "inbox" | "feed" | "form";

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

// The Inbox | Announcements switch, Inbox picked
function Switch({ className }: { className?: string }) {
  return (
    <div className={cx("grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line", className)}>
      <div className="flex h-9 items-center justify-center rounded-lg bg-surface shadow-card ring-1 ring-line">
        <Bar className="h-3 w-12" />
      </div>
      <div className="flex h-9 items-center justify-center">
        <Bar className="h-3 w-24" />
      </div>
    </div>
  );
}

function Pills({ widths, className }: { widths: string[]; className?: string }) {
  return (
    <div className={cx("flex gap-1.5", className)}>
      {widths.map((w, i) => (
        <div key={i} className={cx("skeleton-bar rounded-full", w)} />
      ))}
    </div>
  );
}

// Coach Messages (team.messages.tsx): on phones the list as its own screen; from
// lg the list column on the left and "Pick a conversation" beside it
function Inbox() {
  return (
    <>
      <div className="lg:hidden">
        <div className="mb-6 flex items-end justify-between gap-4">
          <Bar className="h-8 w-40" />
          <Box className="h-11 w-40" />
        </div>
        <Switch className="mb-6" />
        <Pills widths={["h-9 w-14", "h-9 w-28"]} className="mb-3 gap-2" />
        <Rows count={5} lead="avatar" />
      </div>

      <div className="hidden h-full lg:flex">
        <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="border-b border-line px-4 pt-4 pb-3">
            <div className="mb-3 flex h-9 items-center justify-between">
              <Bar className="h-6 w-32" />
              <Box className="h-9 w-24" />
            </div>
            <Switch className="mb-3" />
            <Box className="mb-3 h-9 w-full rounded-lg" />
            <Pills widths={["h-7 w-10", "h-7 w-24", "h-7 w-20", "h-7 w-20"]} />
          </div>
          <div className="divide-y divide-line overflow-hidden">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="skeleton-bar h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <Bar className={i % 2 ? "w-1/2" : "w-2/3"} />
                  <Bar className={cx("h-3", i % 3 ? "w-3/4" : "w-5/6")} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="mx-auto w-full max-w-2xl px-safe pt-10">
            <div className="mb-8 flex flex-col items-center gap-3">
              <Box className="h-12 w-12 rounded-2xl" />
              <Bar className="h-6 w-56" />
              <Bar className="w-96 max-w-full" />
            </div>
            {/* New message, with its people picker */}
            <Shell className="space-y-4 p-5">
              <Bar className="h-4 w-32" />
              <div className="space-y-2">
                <Bar className="h-3 w-full" />
                <Bar className="h-3 w-2/3" />
              </div>
              <Box className="h-10 w-full rounded-lg" />
              <Box className="h-40 w-full" />
              <Box className="h-10 w-40" />
            </Shell>
          </div>
        </div>
      </div>
    </>
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
    case "inbox":
      return <Inbox />;
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
