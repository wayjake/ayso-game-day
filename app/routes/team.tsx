import type { Route } from "./+types/team";
import { Outlet, NavLink } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { lastTeamCookie } from "~/utils/last-team.server";
import { TeamSwitcher } from "~/components/TeamSwitcher";
import { Badge } from "~/components/ui";
import { CalendarBlank, Gear, House, UsersThree } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Owners and invited coaches both get in; role tells child routes which one
  const { team, role } = await requireTeamAccess(teamId, user.id);

  return data(
    {
      team,
      role,
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
  const { team } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  const tabs = [
    { label: "Overview", to: base, end: true, icon: House },
    { label: "Games", to: `${base}/games`, end: false, icon: CalendarBlank },
    { label: "Roster", to: `${base}/roster`, end: false, icon: UsersThree },
    { label: "Settings", to: `${base}/settings`, end: false, icon: Gear },
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

          <nav className="-mb-px mt-2 flex gap-1 overflow-x-auto" aria-label="Team">
            {tabs.map(({ label, to, end, icon: Icon }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                prefetch="intent"
                className={({ isActive }) =>
                  `flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pt-2 pb-3 text-sm font-semibold transition ${
                    isActive
                      ? "border-primary text-ink"
                      : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} weight={isActive ? "fill" : "regular"} className={isActive ? "text-primary" : ""} />
                    {label}
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
