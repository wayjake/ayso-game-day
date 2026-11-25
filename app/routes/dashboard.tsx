import type { Route } from "./+types/dashboard";
import { Outlet, Link, Form, useMatches } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams } from "~/db";
import { desc } from "drizzle-orm";
import { SignOut } from "@phosphor-icons/react";
import { AppMark } from "~/components/AppMark";
import { buttonClass, cx } from "~/components/ui";
import { PullToRefresh } from "~/components/PullToRefresh";

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
  // Routes with handle.workspace (Messages) fill the window on desktop and
  // scroll inside their own panes, so this layout becomes a fixed-height column
  const workspace = useMatches().some((m) => (m.handle as { workspace?: boolean } | undefined)?.workspace);

  return (
    <div className={cx("min-h-dvh bg-canvas text-ink", workspace && "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised"
      >
        Skip to content
      </a>
      <header className="relative z-30 shrink-0 border-b border-line bg-surface pt-[var(--safe-top)]">
        <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-safe">
          <Link to="/" aria-label="BenchTalk home">
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

      <PullToRefresh />

      <main id="main" className={cx(workspace && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col")}>
        <Outlet />
      </main>
    </div>
  );
}
