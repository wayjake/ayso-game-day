import type { Route } from "./+types/team";
import { Outlet, NavLink } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { lastTeamCookie } from "~/utils/last-team.server";
import { TeamSwitcher } from "~/components/TeamSwitcher";

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
    { label: "Overview", to: base, end: true },
    { label: "Games", to: `${base}/games`, end: false },
    { label: "Roster", to: `${base}/roster`, end: false },
    { label: "Settings", to: `${base}/settings`, end: false },
  ];

  return (
    <>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
            <TeamSwitcher team={team} />
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]">
                {team.format}
              </span>
              {team.ageGroup && (
                <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                  {team.ageGroup}
                </span>
              )}
              {team.season && (
                <span className="text-sm text-[var(--muted)]">{team.season}</span>
              )}
            </div>
          </div>

          <nav className="-mb-px mt-2 flex gap-1 overflow-x-auto" aria-label="Team">
            {tabs.map((tab) => (
              <NavLink
                key={tab.label}
                to={tab.to}
                end={tab.end}
                prefetch="intent"
                className={({ isActive }) =>
                  `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border)]"
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <Outlet />
    </>
  );
}
