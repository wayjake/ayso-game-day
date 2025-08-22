import type { Route } from "./+types/team";
import { Outlet } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams } from "~/db";
import { eq, and } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details and verify ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  return data({
    team,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
}

export default function TeamLayout({ loaderData }: Route.ComponentProps) {
  return <Outlet />;
}