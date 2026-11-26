import type { Route } from "./+types/team";
import { Outlet, NavLink, useFetcher, useLocation, useNavigation } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { lastTeamCookie } from "~/utils/last-team.server";
import { TeamSwitcher } from "~/components/TeamSwitcher";
import { Badge, cx } from "~/components/ui";
import { coachConversationIds, totalUnread } from "~/utils/messages.server";
import { navMotion } from "~/utils/nav-motion";
import { TabTransition, type TransitionTab } from "~/components/TabTransition";
import { useEffect, useRef, useState } from "react";
import { countTasksToConfirm } from "~/utils/tasks.server";
import { countPendingClaims } from "~/utils/ledger.server";
import { AddressBook, Archive, CalendarBlank, ChatsCircle, Coins, Gear, House, ImagesSquare, ListChecks, UsersThree } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Owners and invited coaches both get in; role tells child routes which one
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const [unread, tasksToConfirm, paymentsToConfirm] = await Promise.all([
    coachConversationIds(teamId, user.id).then((ids) => totalUnread(ids, user.id)),
    countTasksToConfirm(teamId),
    countPendingClaims(teamId),
  ]);

  return data(
    {
      team,
      role,
      unread,
      tasksToConfirm,
      paymentsToConfirm,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    },
    // Remember this team so /dashboard lands here next time
    { headers: { "Set-Cookie": await lastTeamCookie.serialize(team.id) } }
  );
}

export default function TeamLayout({ loaderData }: Route.ComponentProps) {
  const { team, role, unread, tasksToConfirm, paymentsToConfirm } = loaderData;
  const location = useLocation();
  // Light the tapped tab straight away (see family.tsx): mid-navigation, the pending link is the lit one
  const pending = useNavigation().location;
  const under = (pathname: string, also?: string[]) => Boolean(also?.some((path) => pathname.startsWith(path)));
  const lit = (matched: boolean, isPending: boolean, also?: string[]) =>
    pending ? isPending || under(pending.pathname, also) : matched || under(location.pathname, also);
  const base = `/dashboard/team/${team.id}`;

  const tabs = [
    { label: "Overview", to: base, end: true, icon: House, badge: 0 },
    { label: "Schedule", to: `${base}/games`, end: false, icon: CalendarBlank, badge: 0, tour: "tab-schedule" },
    { label: "Roster", to: `${base}/roster`, end: false, icon: UsersThree, badge: 0 },
    { label: "Families", to: `${base}/families`, end: false, icon: AddressBook, badge: 0 },
    { label: "Tasks", to: `${base}/tasks`, end: false, icon: ListChecks, badge: tasksToConfirm, badgeText: "to confirm" },
    { label: "Finances", to: `${base}/finances`, end: false, icon: Coins, badge: paymentsToConfirm, badgeText: "payments to confirm" },
    // Announcements live under Messages, so keep the tab lit there too
    { label: "Messages", to: `${base}/messages`, end: false, icon: ChatsCircle, badge: unread, badgeText: "unread", tour: "tab-messages", also: [`${base}/announcements`] },
    { label: "Feed", to: `${base}/feed`, end: false, icon: ImagesSquare, badge: 0 },
    { label: "Settings", to: `${base}/settings`, end: false, icon: Gear, badge: 0 },
  ];

  // What each tab's page looks like while it loads (see TabTransition)
  const wide = "mx-auto w-full max-w-7xl px-safe pt-6 pb-16 sm:pt-8";
  const narrow = "mx-auto w-full max-w-2xl px-safe pt-6 pb-16 sm:pt-8";
  // Messages: the list pane on phones, the whole two-pane workspace from lg (team.messages.tsx)
  const inbox = "mx-auto w-full max-w-2xl px-safe pt-6 sm:pt-8 lg:h-full lg:max-w-none lg:p-0";
  const turns: TransitionTab[] = [
    { to: base, end: true, skeleton: "overview", frame: wide },
    { to: `${base}/games`, skeleton: "events", frame: wide },
    { to: `${base}/roster`, skeleton: "people", frame: wide },
    { to: `${base}/families`, skeleton: "people", frame: wide },
    { to: `${base}/tasks`, skeleton: "people", frame: wide },
    { to: `${base}/finances`, skeleton: "overview", frame: wide },
    { to: `${base}/messages`, also: [`${base}/announcements`], skeleton: "inbox", frame: inbox },
    { to: `${base}/feed`, skeleton: "feed", frame: narrow },
    { to: `${base}/settings`, skeleton: "form", frame: narrow },
  ];
  const tabRow = useRef<HTMLDivElement>(null);

  // Nine tabs don't fit a phone, so the row scrolls sideways: keep the lit tab in view
  const tabNav = useRef<HTMLElement>(null);
  const litPath = (pending ?? location).pathname;
  useEffect(() => {
    const nav = tabNav.current;
    const active = nav?.querySelector<HTMLElement>("[data-lit]")?.closest<HTMLElement>("a");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [litPath]);
  // Something waiting in a tab scrolled out of view: a dot on that side of the row
  const [offscreen, setOffscreen] = useState({ left: false, right: false });
  useEffect(() => {
    const nav = tabNav.current;
    if (!nav) return;
    const check = () => {
      const box = nav.getBoundingClientRect();
      const next = { left: false, right: false };
      nav.querySelectorAll<HTMLElement>("[data-badge]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right <= box.left + 8) next.left = true;
        if (r.left >= box.right - 8) next.right = true;
      });
      setOffscreen((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    check();
    nav.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      nav.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [unread, tasksToConfirm, paymentsToConfirm]);

  return (
    <>
      <div ref={tabRow} className="shrink-0 border-b border-line bg-surface">
        <div className="px-safe">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-4">
            <TeamSwitcher team={team} />
            <div className="flex items-center gap-1.5">
              <Badge tone="primary">{team.format}</Badge>
              {team.ageGroup && <Badge>{team.ageGroup}</Badge>}
              {team.season && <span className="ml-1 text-sm text-muted">{team.season}</span>}
            </div>
          </div>

          {/* Icon over the label on phones, in a row that scrolls sideways (nine tabs don't fit);
              a dot at either edge says a tab with something waiting is scrolled out of view */}
          <div className="bleed-x relative -mb-px mt-2 lg:mx-0 lg:w-fit">
          <nav ref={tabNav} className="no-scrollbar flex overflow-x-auto px-safe lg:gap-1 lg:overflow-visible lg:px-0" aria-label="Team" data-tour="team-tabs">
            {tabs.map(({ label, to, end, icon: Icon, badge, badgeText, tour, also }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                data-tour={tour}
                {...navMotion("tab")}
                className={({ isActive: matched, isPending }) => {
                  const isActive = lit(matched, isPending, also);
                  return `flex min-w-[4.25rem] shrink-0 flex-col items-center gap-1 whitespace-nowrap border-b-2 px-1.5 pt-2 pb-2.5 text-[11px] font-semibold transition lg:min-w-0 lg:flex-row lg:gap-2 lg:px-3 lg:pb-3 lg:text-sm ${
                    isActive
                      ? "border-primary text-ink"
                      : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                  }`;
                }}
              >
                {({ isActive: matched, isPending }) => {
                  const isActive = lit(matched, isPending, also);
                  return (
                  <>
                    {isActive && <span data-lit hidden />}
                    <span className="relative" {...(badge > 0 ? { "data-badge": "" } : {})}>
                      <Icon size={18} weight={isActive ? "fill" : "regular"} className={isActive ? "text-primary" : ""} />
                      {badge > 0 && (
                        <span aria-hidden className="absolute -top-1.5 -right-2.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white tabular lg:hidden">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </span>
                    {label}
                    {badge > 0 && (
                      <span aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular lg:inline-flex">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                    {badge > 0 && <span className="sr-only"> ({badge} {badgeText})</span>}
                  </>
                  );
                }}
              </NavLink>
            ))}
          </nav>
          {offscreen.left && <EdgeDot side="left" />}
          {offscreen.right && <EdgeDot side="right" />}
          </div>
        </div>
      </div>

      {team.archivedAt && <ArchivedBanner teamId={team.id} isOwner={role === "owner"} />}

      <Outlet />
      <TabTransition tabs={turns} below={tabRow} />
    </>
  );
}

// A tab with a badge is scrolled out of view on this side of the tab row
function EdgeDot({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none absolute top-0 bottom-0 flex w-6 items-start pt-2.5 lg:hidden",
        side === "left" ? "left-0 justify-start bg-gradient-to-r from-surface pl-1" : "right-0 justify-end bg-gradient-to-l from-surface pr-1",
      )}
    >
      <span className="h-2 w-2 rounded-full bg-brand" />
    </span>
  );
}

// Inside an archived team: everything works, but say where you are and how to undo it
function ArchivedBanner({ teamId, isOwner }: { teamId: number; isOwner: boolean }) {
  const fetcher = useFetcher();
  return (
    <div className="shrink-0 border-b border-line bg-warning-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-safe py-2.5 text-sm">
        <Archive size={18} className="shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Archived team.</span>{" "}
          <span className="text-muted">It's hidden from the team switcher and your team list. Everything still works.</span>
        </p>
        {isOwner && (
          <fetcher.Form method="post" action={`/dashboard/team/${teamId}/settings`}>
            <input type="hidden" name="_action" value="unarchive" />
            <button
              type="submit"
              disabled={fetcher.state !== "idle"}
              className="tap font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              {fetcher.state !== "idle" ? "Restoring…" : "Unarchive"}
            </button>
          </fetcher.Form>
        )}
      </div>
    </div>
  );
}

