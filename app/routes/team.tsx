import type { Route } from "./+types/team";
import { Outlet, NavLink, useFetcher, useLocation, useNavigation } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { lastTeamCookie } from "~/utils/last-team.server";
import { TeamSwitcher } from "~/components/TeamSwitcher";
import { Badge } from "~/components/ui";
import { coachConversationIds, totalUnread } from "~/utils/messages.server";
import { parseToursSeen } from "~/utils/tours";
import { HelpButton, TourProvider } from "~/components/Tour";
import { navMotion } from "~/utils/nav-motion";
import { Archive, CalendarBlank, ChatsCircle, Gear, House, ImagesSquare, UsersThree } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Owners and invited coaches both get in; role tells child routes which one
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const unread = await totalUnread(await coachConversationIds(teamId, user.id), user.id);

  return data(
    {
      team,
      role,
      unread,
      toursSeen: parseToursSeen(user.toursSeen),
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
  const { team, role, unread, toursSeen } = loaderData;
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
    // Families and Tasks hang off the Roster page
    { label: "Roster", to: `${base}/roster`, end: false, icon: UsersThree, badge: 0, also: [`${base}/families`, `${base}/tasks`] },
    // Announcements live under Messages, so keep the tab lit there too
    { label: "Messages", to: `${base}/messages`, end: false, icon: ChatsCircle, badge: unread, tour: "tab-messages", also: [`${base}/announcements`] },
    { label: "Feed", to: `${base}/feed`, end: false, icon: ImagesSquare, badge: 0 },
    { label: "Settings", to: `${base}/settings`, end: false, icon: Gear, badge: 0 },
  ];

  return (
    <TourProvider teamId={team.id} initialSeen={toursSeen}>
      <div className="shrink-0 border-b border-line bg-surface">
        <div className="px-safe">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-4">
            <TeamSwitcher team={team} />
            <div className="flex items-center gap-1.5">
              <Badge tone="primary">{team.format}</Badge>
              {team.ageGroup && <Badge>{team.ageGroup}</Badge>}
              {team.season && <span className="ml-1 text-sm text-muted">{team.season}</span>}
            </div>
            <HelpButton className="ml-auto" />
          </div>

          {/* Equal columns with the icon over the label on phones, so all six always fit */}
          <nav className="-mb-px mt-2 grid grid-cols-6 sm:flex sm:w-fit sm:gap-1" aria-label="Team" data-tour="team-tabs">
            {tabs.map(({ label, to, end, icon: Icon, badge, tour, also }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                data-tour={tour}
                {...navMotion("tab")}
                className={({ isActive: matched, isPending }) => {
                  const isActive = lit(matched, isPending, also);
                  return `flex flex-col items-center gap-1 whitespace-nowrap border-b-2 px-0.5 pt-2 pb-2.5 text-[11px] font-semibold transition sm:flex-row sm:gap-2 sm:px-3 sm:pb-3 sm:text-sm ${
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
                    <span className="relative">
                      <Icon size={18} weight={isActive ? "fill" : "regular"} className={isActive ? "text-primary" : ""} />
                      {badge > 0 && (
                        <span aria-hidden className="absolute -top-1.5 -right-2.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white tabular sm:hidden">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </span>
                    {label}
                    {badge > 0 && (
                      <span aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular sm:inline-flex">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                    {badge > 0 && <span className="sr-only"> ({badge} unread)</span>}
                  </>
                  );
                }}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {team.archivedAt && <ArchivedBanner teamId={team.id} isOwner={role === "owner"} />}

      <Outlet />
    </TourProvider>
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

