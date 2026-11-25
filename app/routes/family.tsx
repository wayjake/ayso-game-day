import type { Route } from "./+types/family";
import { useCallback, useEffect, useState } from "react";
import { Form, Link, NavLink, Outlet, data, useMatches, useNavigation, useSearchParams } from "react-router";
import { db, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";
import { requireParent } from "~/utils/family.server";
import { parentConversationIds, totalUnread } from "~/utils/messages.server";
import { getNotifyPrefs, vapidPublicKey } from "~/utils/push.server";
import { detectPlatform } from "~/utils/pwa";
import { navMotion } from "~/utils/nav-motion";
import { usePush } from "~/hooks/usePush";
import type { FamilyContext } from "~/hooks/useFamily";
import { AppMark } from "~/components/AppMark";
import { InstallSheet } from "~/components/InstallSheet";
import { NotificationsMenu } from "~/components/NotificationsMenu";
import { NotifyPrompt } from "~/components/NotifyPrompt";
import { buttonClass, cx } from "~/components/ui";
import { CalendarCheck, ChatsCircle, ClipboardText, GearSix, ImagesSquare, SignOut } from "@phosphor-icons/react";

// The family app: what parents see. Built phone-first, since most open it from
// a notification or their Home Screen.

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids, teamIds } = await requireParent(request);
  const [coaching] = await db.select({ id: teams.id }).from(teams).where(canAccessTeam(user.id)).limit(1);
  const unread = await totalUnread(await parentConversationIds(user.id, teamIds), user.id);

  return data({
    user: { id: user.id, name: user.name, email: user.email },
    kids,
    unread,
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
  const { unread, isCoach } = loaderData;
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
    },
    {
      label: "Settings",
      to: "/family/settings",
      end: false,
      icon: GearSix,
      badge: 0,
    },
  ];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="vt-topbar sticky top-0 z-30 border-b border-line bg-surface/95 pt-[var(--safe-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <Link to="/family" aria-label="Schedule">
            <AppMark />
          </Link>

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Family">
            {tabs.map(({ label, to, end, icon: Icon, badge }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                {...navMotion("tab")}
                className={(state) =>
                  cx(
                    "relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition",
                    lit(state) ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                  )
                }
              >
                <Icon size={18} />
                {label}
                {badge > 0 && <UnreadDot count={badge} />}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <NotificationsMenu push={push} onInstall={openInstall} />
            {isCoach && (
              <Link to="/dashboard" className={buttonClass({ variant: "ghost", size: "sm" })}>
                <ClipboardText size={18} />
                <span className="hidden md:inline">Coach view</span>
              </Link>
            )}
            <Form action="/user/logout" method="post" className="hidden sm:block">
              <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })} aria-label="Log out">
                <SignOut size={18} />
              </button>
            </Form>
          </div>
        </div>
      </header>

      <main id="main" className={cx("mx-auto w-full max-w-3xl px-4", inThread ? "pb-0" : "pb-28 sm:pb-16")}>
        <Outlet context={{ push, openInstall } satisfies FamilyContext} />
      </main>

      {install && (
        <InstallSheet platform={loaderData.platform} openOnLoad={install.openOnLoad} onClose={() => setInstall(null)} />
      )}
      {/* Once per phone, as soon as it can say yes (on iPhone: first launch from the Home Screen) */}
      <NotifyPrompt push={push} />

      {/* Phone tab bar */}
      {!inThread && (
        <nav
          className="vt-tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
          aria-label="Family"
        >
          {tabs.map(({ label, to, end, icon: Icon, badge }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              prefetch="intent"
              {...navMotion("tab")}
              className={(state) =>
                cx(
                  "group relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors duration-150",
                  lit(state) ? "text-primary" : "text-muted",
                )
              }
            >
              {(state) => (
                <>
                  <span className="relative transition-transform duration-150 ease-out group-active:scale-85">
                    <Icon size={24} weight={lit(state) ? "fill" : "regular"} />
                    {badge > 0 && <UnreadDot count={badge} className="absolute -top-1.5 -right-3" />}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function UnreadDot({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular",
        className,
      )}
    >
      <span className="sr-only">, </span>
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}
