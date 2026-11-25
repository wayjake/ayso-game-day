import type { Route } from "./+types/family.messages.with";
import { redirect } from "react-router";
import { requireParent } from "~/utils/family.server";
import { getOrCreateDirectConversation } from "~/utils/messages.server";
import { getCoachUserIds } from "~/utils/family.server";

// Opens the family's private thread with one staff member, making it the
// first time. Linked from the Messages list for staff they haven't written to.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, teamIds } = await requireParent(request);
  const teamId = Number(params.teamId);
  const staffId = Number(params.staffId);
  const staff = teamIds.includes(teamId) ? await getCoachUserIds(teamId) : [];
  // Only someone on that team's staff, and never themselves (a parent who is also on the staff)
  if (!staff.includes(staffId) || staffId === user.id) {
    throw new Response("Not found", { status: 404 });
  }
  const conversation = await getOrCreateDirectConversation(teamId, user.id, staffId);
  return redirect(`/family/messages/${conversation.id}`);
}
