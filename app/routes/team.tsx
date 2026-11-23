import type { Route } from "./+types/team";
import { Outlet, NavLink } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { lastTeamCookie } from "~/utils/last-team.server";
import { TeamSwitcher } from "~/components/TeamSwitcher";
import { Badge } from "~/components/ui";
import { coachConversationIds, totalUnread } from "~/utils/messages.server";
import { CalendarBlank, ChatsCircle, Gear, House, UsersThree } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Owners and invited coaches both get in; role tells child routes which one
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const unread = await totalUnread(await coachConversationIds(teamId), user.id);

  return data(
    {
      team,
      role,
      unread,
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
  const { team, unread } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  const tabs = [
    { label: "Overview", to: base, end: true, icon: House, badge: 0 },
    { label: "Schedule", to: `${base}/games`, end: false, icon: CalendarBlank, badge: 0 },
    { label: "Roster", to: `${base}/roster`, end: false, icon: UsersThree, badge: 0 },
    { label: "Messages", to: `${base}/messages`, end: false, icon: ChatsCircle, badge: unread },
    { label: "Settings", to: `${base}/settings`, end: false, icon: Gear, badge: 0 },
  ];

  return (
    <>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-4">
            <TeamSwitcher team={team} />
            <div className="flex items-center gap-1.5">
              <Badge tone="primary">{team.format}</Badge>
              {team.ageGroup && <Badge>{team.ageGroup}</Badge>}
              {team.season && <span className="ml-1 text-sm text-muted">{team.season}</span>}
            </div>
          </div>

          {/* Equal columns with the icon over the label on phones, so all five always fit */}
          <nav className="-mb-px mt-2 grid grid-cols-5 sm:flex sm:gap-1" aria-label="Team">
            {tabs.map(({ label, to, end, icon: Icon, badge }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 whitespace-nowrap border-b-2 px-1 pt-2 pb-2.5 text-xs font-semibold transition sm:flex-row sm:gap-2 sm:px-3 sm:pb-3 sm:text-sm ${
                    isActive
                      ? "border-primary text-ink"
                      : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon size={18} weight={isActive ? "fill" : "regular"} className={isActive ? "text-primary" : ""} />
                      {badge > 0 && (
                        <span aria-hidden className="absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white tabular sm:hidden">
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
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <Outlet />
    </>
  );
}
