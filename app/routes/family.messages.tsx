import type { Route } from "./+types/family.messages";
import { Link, data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { listParentConversations } from "~/utils/messages.server";
import { ConversationList } from "~/components/ConversationList";
import { buttonClass } from "~/components/ui";
import { navMotion } from "~/utils/nav-motion";
import { Plus } from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  const teamList = [...new Map(kids.map((k) => [k.teamId, { teamId: k.teamId, teamName: k.teamName }])).values()];
  const conversations = await listParentConversations(user.id, teamList);
  return data({ conversations });
}

export default function FamilyMessages({ loaderData }: Route.ComponentProps) {
  return (
    <div className="pt-6 sm:pt-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">Messages</h1>
        <Link to="/family/messages/new" {...navMotion("push")} className={buttonClass({ size: "sm" })}>
          <Plus size={16} weight="bold" />
          New
        </Link>
      </div>
      <p className="mt-1 mb-6 text-muted">
        Team chat goes to every family and coach. Message a coach or team manager on their own, or start a group with other families: only the people in it see it.
      </p>
      <ConversationList items={loaderData.conversations} hrefFor={(id) => `/family/messages/${id}`} />
    </div>
  );
}
