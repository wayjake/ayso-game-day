import type { Route } from "./+types/dashboard._index";
import { redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { activeTeams, canAccessTeam } from "~/utils/team-access.server";
import { getLastTeamId } from "~/utils/last-team.server";
import { isParent } from "~/utils/family.server";
import { db, teams } from "~/db";
import { desc } from "drizzle-orm";

// /dashboard is a doorway, not a page: coaches almost always want their
// current team, so send them there and keep the all-teams list one click away.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  const userTeams = await db
    .select({ id: teams.id, archived: teams.archivedAt })
    .from(teams)
    .where(canAccessTeam(user.id))
    .orderBy(desc(teams.createdAt));
  // Archived teams never get the doorway, even the last one opened
  const active = userTeams.filter((t) => !t.archived);

  const lastTeamId = await getLastTeamId(request);
  if (lastTeamId && active.some((t) => t.id === lastTeamId)) {
    throw redirect(`/dashboard/team/${lastTeamId}`);
  }

  // Parents who don't coach anything belong in the family app
  if (userTeams.length === 0 && (await isParent(user.id))) {
    throw redirect("/family");
  }

  if (active.length === 1) {
    throw redirect(`/dashboard/team/${active[0].id}`);
  }

  throw redirect("/dashboard/teams");
}

export default function DashboardIndex() {
  return null;
}
