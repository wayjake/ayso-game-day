import type { Route } from "./+types/family";
import { Form, Link, NavLink, Outlet, data, useMatches } from "react-router";
import { db, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";
import { requireParent } from "~/utils/family.server";
import { parentConversationIds, totalUnread } from "~/utils/messages.server";
import { AppMark } from "~/components/AppMark";
import { buttonClass, cx } from "~/components/ui";
import { CalendarCheck, ChatsCircle, ClipboardText, GearSix, SignOut } from "@phosphor-icons/react";

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
  });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "AYSO Game Day" }];
}

export default function FamilyLayout({ loaderData }: Route.ComponentProps) {
  const { unread, isCoach } = loaderData;
  // A chat thread takes the whole screen on phones, with its own back link
  const inThread = useMatches().some((m) => m.id === "routes/family.messages.thread");

  const tabs = [
    { label: "Schedule", to: "/family", end: true, icon: CalendarCheck, badge: 0 },
    { label: "Messages", to: "/family/messages", end: false, icon: ChatsCircle, badge: unread },
    { label: "Settings", to: "/family/settings", end: false, icon: GearSix, badge: 0 },
  ];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
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
                className={({ isActive }) =>
                  cx(
                    "relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition",
                    isActive ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
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
        <Outlet />
      </main>

      {/* Phone tab bar */}
      {!inThread && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
          aria-label="Family"
        >
          {tabs.map(({ label, to, end, icon: Icon, badge }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              prefetch="intent"
              className={({ isActive }) =>
                cx(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold",
                  isActive ? "text-primary" : "text-muted"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon size={24} weight={isActive ? "fill" : "regular"} />
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
        className
      )}
    >
      <span className="sr-only">, </span>
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}
