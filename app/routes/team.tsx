import type { Route } from "./+types/team";
import { Outlet } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Owners and invited coaches both get in; role tells child routes which one
  const { team, role } = await requireTeamAccess(teamId, user.id);

  return data({
    team,
    role,
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
