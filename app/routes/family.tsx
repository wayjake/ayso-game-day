import type { Route } from "./+types/family";
import { useCallback, useEffect, useState, useRef } from "react";
import { Link, NavLink, Outlet, data, useMatches, useNavigation, useSearchParams } from "react-router";
import { db, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";
import { requireParent } from "~/utils/family.server";
import { parentConversationIds, totalUnread } from "~/utils/messages.server";
import { familyTasks } from "~/utils/tasks.server";
import { getNotifyPrefs, vapidPublicKey } from "~/utils/push.server";
import { detectPlatform } from "~/utils/pwa";
import { navMotion } from "~/utils/nav-motion";
import { TabTransition, type TransitionTab } from "~/components/TabTransition";
import { usePush } from "~/hooks/usePush";
import { AppMark } from "~/components/AppMark";
import { InstallSheet } from "~/components/InstallSheet";
import { AccountMenu } from "~/components/AccountMenu";
import { NotificationsMenu } from "~/components/NotificationsMenu";
import { NotifyPrompt } from "~/components/NotifyPrompt";
import { buttonClass, cx } from "~/components/ui";
import { PushContext } from "~/hooks/usePushContext";
import { CalendarCheck, ChatsCircle, ClipboardText, Coins, GearSix, ImagesSquare, ListChecks } from "@phosphor-icons/react";
import { PullToRefresh } from "~/components/PullToRefresh";

// The family app: what parents see. Built phone-first, since most open it from
// a notification or their Home Screen.

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids, teamIds } = await requireParent(request);
  const [coaching] = await db.select({ id: teams.id }).from(teams).where(canAccessTeam(user.id)).limit(1);
  const [unread, openTasks] = await Promise.all([
    parentConversationIds(user.id, teamIds).then((ids) => totalUnread(ids, user.id)),
    familyTasks(kids).then((tasks) => tasks.filter((t) => t.state === "open").length),
  ]);

  return data({
    user: { id: user.id, name: user.name, email: user.email },
    kids,
    unread,
    openTasks,
    isCoach: Boolean(coaching),
    vapidPublicKey: vapidPublicKey(),
    notifyPrefs: await getNotifyPrefs(user.id),
    platform: detectPlatform(request.headers.get("user-agent") ?? "", 0),
  });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "BenchTalk" }];
}

export default function FamilyLayout({ loaderData }: Route.ComponentProps) {
  const { unread, openTasks, isCoach, user } = loaderData;
  const audience = isCoach ? "coach" : "family";
  // A chat thread takes the whole screen on phones, with its own back link
  const inThread = useMatches().some((m) => m.id === "routes/family.messages.thread");

  const push = usePush(loaderData.vapidPublicKey, loaderData.notifyPrefs);

  // Light the tapped tab straight away, not once its page has loaded: while a
  // navigation is under way the link it's heading to (isPending) is the lit one
  const navigating = Boolean(useNavigation().location);
  const lit = ({ isActive, isPending }: { isActive: boolean; isPending: boolean }) =>
    navigating ? isPending : isActive;

  // Just signed in (?install=1): on a phone that isn't running the installed
  // app, start with how to add it to the Home Screen. The session cookie is
  // already set, so the app opens signed in. The sheet comes with the page and
  // its own script decides whether to open it, so it slides up right away
  // instead of after hydration; elsewhere it closes itself unseen.
  const [searchParams, setSearchParams] = useSearchParams();
  const justSignedIn = searchParams.has("install");
  const [install, setInstall] = useState<{ openOnLoad: boolean } | null>(justSignedIn ? { openOnLoad: true } : null);
  const openInstall = useCallback(() => setInstall({ openOnLoad: false }), []);
  useEffect(() => {
    if (!justSignedIn) return;
    // Drop the flag so a reload or the back button doesn't bring it up again
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("install");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [justSignedIn, setSearchParams]);

  const tabs = [
    {
      label: "Schedule",
      to: "/family",
      end: true,
      icon: CalendarCheck,
      badge: 0,
    },
    {
      label: "To do",
      to: "/family/todo",
      end: false,
      icon: ListChecks,
      badge: openTasks,
      badgeText: "open",
    },
    {
      label: "Finances",
      to: "/family/finances",
      end: false,
      icon: Coins,
      badge: 0,
    },
    {
      label: "Feed",
      to: "/family/feed",
      end: false,
      icon: ImagesSquare,
      badge: 0,
    },
    {
      label: "Messages",
      to: "/family/messages",
      end: false,
      icon: ChatsCircle,
      badge: unread,
      badgeText: "unread",
    },
    {
      label: "Settings",
      to: "/family/settings",
      end: false,
      icon: GearSix,
      badge: 0,
    },
  ];

  // What each tab's page looks like while it loads (see TabTransition)
  const frame = "mx-auto w-full max-w-3xl px-safe pt-6 sm:pt-8";
  const turns: TransitionTab[] = [
    { to: "/family", end: true, skeleton: "events", frame },
    { to: "/family/todo", skeleton: "people", frame },
    { to: "/family/finances", skeleton: "overview", frame },
    { to: "/family/feed", skeleton: "feed", frame },
    { to: "/family/messages", skeleton: "chats", frame },
    { to: "/family/settings", skeleton: "form", frame },
  ];
  const topBar = useRef<HTMLElement>(null);

  return (
    <PushContext.Provider value={{ push, openInstall, audience }}>
      <div className="min-h-dvh bg-canvas text-ink">
        <header ref={topBar} className="vt-topbar sticky top-0 z-30 border-b border-line bg-surface/95 pt-[var(--safe-top)] backdrop-blur">
          {/* Wider than the page from lg, so six labelled tabs fit beside the logo and menus */}
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-safe lg:max-w-5xl">
            <Link to="/family" aria-label="Schedule">
              <AppMark />
            </Link>

            <nav className="hidden items-center gap-1 sm:flex" aria-label="Family">
              {tabs.map(({ label, to, end, icon: Icon, badge, badgeText }) => (
                <NavLink
                  key={label}
                  to={to}
                  end={end}
                  prefetch="intent"
                  aria-label={label}
                  title={label}
                  {...navMotion("tab")}
                  className={(state) =>
                    cx(
                      "relative flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition",
                      lit(state) ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                    )
                  }
                >
                  <Icon size={18} />
                  {/* Icons only until there's room for six labels */}
                  <span className="hidden lg:inline">{label}</span>
                  {badge > 0 && <UnreadDot count={badge} label={badgeText} />}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-1">
              <NotificationsMenu push={push} onInstall={openInstall} audience={audience} />
              {isCoach && (
                <Link to="/dashboard" className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <ClipboardText size={18} />
                  <span className="hidden whitespace-nowrap xl:inline">Coach view</span>
                </Link>
              )}
              <AccountMenu me={user} settingsTo="/family/settings" />
            </div>
          </div>
        </header>

        <PullToRefresh />

        <main id="main" className={cx("mx-auto w-full max-w-3xl px-safe", inThread ? "pb-0" : "pb-28 sm:pb-16")}>
          <Outlet />
        </main>
        <TabTransition tabs={turns} below={topBar} />

        {install && (
          <InstallSheet platform={loaderData.platform} openOnLoad={install.openOnLoad} onClose={() => setInstall(null)} />
        )}
        {/* Once per phone, as soon as it can say yes (on iPhone: first launch from the Home Screen) */}
        <NotifyPrompt push={push} audience={audience} />

        {/* Phone tab bar */}
        {!inThread && (
          <nav
            className="vt-tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur sm:hidden"
            aria-label="Family"
          >
            {tabs.map(({ label, to, end, icon: Icon, badge, badgeText }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                {...navMotion("tab")}
                className={(state) =>
                  cx(
                    "group relative flex h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] font-semibold transition-colors duration-150 min-[400px]:text-xs",
                    lit(state) ? "text-primary" : "text-muted",
                  )
                }
              >
                {(state) => (
                  <>
                    <span className="relative transition-transform duration-150 ease-out group-active:scale-85">
                      <Icon size={24} weight={lit(state) ? "fill" : "regular"} />
                      {badge > 0 && <UnreadDot count={badge} label={badgeText} className="absolute -top-1.5 -right-3" />}
                    </span>
                    {/* Six across: a big Text Size setting shortens a label rather than overflowing */}
                    <span className="max-w-full truncate">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </PushContext.Provider>
  );
}

function UnreadDot({ count, label = "unread", className }: { count: number; label?: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular",
        className,
      )}
    >
      <span className="sr-only">, </span>
      {count > 99 ? "99+" : count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}
