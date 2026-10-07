import type { Route } from "./+types/dashboard";
import { Outlet, Link, Form } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams } from "~/db";
import { desc } from "drizzle-orm";
import { SignOut } from "@phosphor-icons/react";
import { AppMark } from "~/components/AppMark";
import { buttonClass } from "~/components/ui";

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
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/dashboard" aria-label="AYSO Game Day home">
            <AppMark />
          </Link>

          <div className="flex items-center gap-1">
            <span className="hidden px-2 text-sm text-muted sm:block">{user.email}</span>
            <Form action="/user/logout" method="post">
              <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
                <SignOut size={18} />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </Form>
          </div>
        </nav>
      </header>

      <main id="main">
        <Outlet />
      </main>
    </div>
  );
}
