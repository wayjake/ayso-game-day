import type { Route } from "./+types/dashboard";
import { Outlet, Link, Form } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams } from "~/db";
import { desc } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  // All teams this user can open, for the team switcher
  const userTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      format: teams.format,
      ageGroup: teams.ageGroup,
      season: teams.season,
    })
    .from(teams)
    .where(canAccessTeam(user.id))
    .orderBy(desc(teams.createdAt));

  return data({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      teamName: user.teamName,
    },
    teams: userTeams,
  });
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
      {/* Top navigation */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <nav className="container mx-auto px-4 sm:px-6 max-w-[1600px] flex items-center justify-between h-14">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--accent)] text-white text-xs">AY</span>
            <span>AYSO Game Day</span>
          </Link>

          {/* User menu */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-[var(--muted)]">{user.email}</span>
            <Form action="/user/logout" method="post">
              <button
                type="submit"
                className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
              >
                Logout
              </button>
            </Form>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
