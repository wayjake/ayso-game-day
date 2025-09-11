import type { Route } from "./+types/dashboard";
import { Outlet, Link, Form, useLocation } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams } from "~/db";
import { eq } from "drizzle-orm";
import { Breadcrumbs, type BreadcrumbItem } from "~/components/Breadcrumbs";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  
  // Get all teams for this user for breadcrumb generation
  const userTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      format: teams.format,
      ageGroup: teams.ageGroup,
    })
    .from(teams)
    .where(eq(teams.coachId, user.id));
  
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
  const { user, teams } = loaderData;
  const location = useLocation();

  // Generate breadcrumbs based on current path
  const generateBreadcrumbs = (): BreadcrumbItem[] => {
    const path = location.pathname;
    const breadcrumbs: BreadcrumbItem[] = [];
    
    // Always start with Dashboard
    if (path === "/dashboard") {
      breadcrumbs.push({ label: "Dashboard", isActive: true });
    } else {
      breadcrumbs.push({ label: "Dashboard", href: "/dashboard" });
    }
    
    // Check for team-specific routes
    const teamMatch = path.match(/\/dashboard\/team\/(\d+)/);
    if (teamMatch) {
      const teamId = teamMatch[1];
      const currentTeam = teams.find(t => t.id === parseInt(teamId));
      
      if (currentTeam) {
        if (path === `/dashboard/team/${teamId}`) {
          breadcrumbs.push({ label: currentTeam.name, isActive: true });
        } else {
          breadcrumbs.push({ label: currentTeam.name, href: `/dashboard/team/${teamId}` });
          
          // Add sub-page breadcrumbs
          if (path.includes("/roster")) {
            if (path.includes("/new-player")) {
              breadcrumbs.push({ label: "Roster", href: `/dashboard/team/${teamId}/roster` });
              breadcrumbs.push({ label: "Add Player", isActive: true });
            } else {
              breadcrumbs.push({ label: "Roster", isActive: true });
            }
          } else if (path.includes("/games")) {
            breadcrumbs.push({ label: "Games", isActive: true });
          } else if (path.includes("/rotations")) {
            breadcrumbs.push({ label: "Rotations", isActive: true });
          }
        }
      }
    } else if (path.includes("/teams")) {
      breadcrumbs.push({ label: "Teams", isActive: true });
    }
    
    return breadcrumbs;
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
      {/* Top navigation */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-50">
        <nav className="container mx-auto px-4 sm:px-6 max-w-7xl flex items-center justify-between h-14">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--accent)] text-white text-xs">AY</span>
            <span>AYSO Game Day</span>
          </Link>
          
          {/* User menu */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-sm">
              <div className="font-medium">{user.teamName || 'Coach'}</div>
              <div className="text-[var(--muted)]">{user.email}</div>
            </div>
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

      {/* Main content */}
      <main className="flex-1">
        <div className="container mx-auto px-4 sm:px-6 pt-3 max-w-7xl">
          <Breadcrumbs items={generateBreadcrumbs()} />
        </div>
        <Outlet />
      </main>
    </div>
  );
}