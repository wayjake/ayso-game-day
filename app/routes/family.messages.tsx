import type { Route } from "./+types/family.messages";
import { data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { listParentConversations } from "~/utils/messages.server";
import { getTeamForUser } from "~/utils/team-access.server";
import { ConversationList } from "~/components/ConversationList";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  const teamList = [...new Map(kids.map((k) => [k.teamId, { teamId: k.teamId, teamName: k.teamName }])).values()];
  // On teams they also coach they're staff, not a family: no private threads with their fellow staff here
  const coached = new Set<number>();
  for (const t of teamList) if (await getTeamForUser(t.teamId, user.id)) coached.add(t.teamId);
  const conversations = await listParentConversations(user.id, teamList, coached);
  return data({ conversations });
}

export default function FamilyMessages({ loaderData }: Route.ComponentProps) {
  return (
    <div className="pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Messages</h1>
      <p className="mt-1 mb-6 text-muted">
        Team chat goes to every family and coach. Message a coach or team manager on their own: only the two of you see it.
      </p>
      <ConversationList items={loaderData.conversations} hrefFor={(id) => `/family/messages/${id}`} />
    </div>
  );
}
