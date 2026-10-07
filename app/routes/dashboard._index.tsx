import type { Route } from "./+types/dashboard._index";
import { redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { getLastTeamId } from "~/utils/last-team.server";
import { db, teams } from "~/db";
import { desc } from "drizzle-orm";

// /dashboard is a doorway, not a page: coaches almost always want their
// current team, so send them there and keep the all-teams list one click away.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  const userTeams = await db
    .select({ id: teams.id })
    .from(teams)
    .where(canAccessTeam(user.id))
    .orderBy(desc(teams.createdAt));

  const lastTeamId = await getLastTeamId(request);
  if (lastTeamId && userTeams.some((t) => t.id === lastTeamId)) {
    throw redirect(`/dashboard/team/${lastTeamId}`);
  }

  if (userTeams.length === 1) {
    throw redirect(`/dashboard/team/${userTeams[0].id}`);
  }

  throw redirect("/dashboard/teams");
}

export default function DashboardIndex() {
  return null;
}
