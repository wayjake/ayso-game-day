import type { Route } from "./+types/family.messages";
import { Link, data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { db, teams } from "~/db";
import { inArray } from "drizzle-orm";
import { listParentConversations } from "~/utils/messages.server";
import { ConversationList } from "~/components/ConversationList";
import { buttonClass } from "~/components/ui";
import { navMotion } from "~/utils/nav-motion";
import { Plus } from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  const teamIds = [...new Set(kids.map((k) => k.teamId))];
  // Links to a staff member they haven't written to yet carry the team's code
  const codes = new Map((await db.select({ id: teams.id, code: teams.code }).from(teams).where(inArray(teams.id, teamIds))).map((t) => [t.id, t.code]));
  const teamList = [...new Map(kids.map((k) => [k.teamId, { teamId: k.teamId, teamCode: codes.get(k.teamId) ?? "", teamName: k.teamName }])).values()];
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
        Team chat and channels are where the team talks. Message a coach or team manager on their own, or start a group with other families: only the people in it see it.
      </p>
      <ConversationList items={loaderData.conversations} hrefFor={(id) => `/family/messages/${id}`} sections />
    </div>
  );
}
