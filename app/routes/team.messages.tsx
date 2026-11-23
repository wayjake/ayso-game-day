import type { Route } from "./+types/team.messages";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, guardians, players, users } from "~/db";
import { and, eq } from "drizzle-orm";
import { getOrCreateDirectConversation, listCoachConversations } from "~/utils/messages.server";
import { vapidPublicKey } from "~/utils/push.server";
import { ConversationList } from "~/components/ConversationList";
import { PushToggle } from "~/components/PushToggle";
import { Card, CardHeader, EmptyState, Page, PageHeader, buttonClass, inputClass } from "~/components/ui";
import { AddressBook, PaperPlaneTilt } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const conversations = await listCoachConversations(teamId, user.id);

  // Families on the app, to start a private thread with
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, kid: players.name })
    .from(guardians)
    .innerJoin(users, eq(guardians.userId, users.id))
    .innerJoin(players, eq(guardians.playerId, players.id))
    .where(eq(guardians.teamId, teamId))
    .orderBy(players.name);
  const parents = new Map<number, { userId: number; label: string; kids: string[] }>();
  for (const r of rows) {
    const p = parents.get(r.userId) ?? { userId: r.userId, label: r.name || r.email, kids: [] };
    p.kids.push(r.kid.split(" ")[0]);
    parents.set(r.userId, p);
  }

  return data({ team, conversations, parents: [...parents.values()], vapidPublicKey: vapidPublicKey() });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();

  if (formData.get("_action") === "startDirect") {
    const parentUserId = Number(formData.get("parentUserId"));
    const [linked] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(and(eq(guardians.teamId, teamId), eq(guardians.userId, parentUserId)))
      .limit(1);
    if (!linked) return data({ error: "That family isn't on this team" }, { status: 400 });
    const conversation = await getOrCreateDirectConversation(teamId, parentUserId);
    return redirect(`/dashboard/team/${teamId}/messages/${conversation.id}`);
  }
  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Messages - AYSO Game Day" }];
}

export default function TeamMessages({ loaderData }: Route.ComponentProps) {
  const { team, conversations, parents, vapidPublicKey } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  return (
    <Page width="narrow">
      <PageHeader
        title="Messages"
        description="Team chat reaches every family on the app. Private threads are between one family and all of this team's coaches."
      />

      <ConversationList items={conversations} hrefFor={(id) => `${base}/messages/${id}`} />

      <Card className="mt-6 p-5">
        <CardHeader title="Message a family" className="mb-3" />
        {parents.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<AddressBook size={24} />}
            title="No families on the app yet"
            action={<Link to={`${base}/families`} className={buttonClass()}>Invite families</Link>}
          >
            Invite parents from your contacts and they can RSVP and message you.
          </EmptyState>
        ) : (
          <Form method="post" className="flex gap-2">
            <input type="hidden" name="_action" value="startDirect" />
            <label htmlFor="parentUserId" className="sr-only">Family</label>
            <select id="parentUserId" name="parentUserId" required className={inputClass}>
              {parents.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.label} ({p.kids.join(" & ")})
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass({ className: "shrink-0" })}>
              <PaperPlaneTilt size={18} />
              Open
            </button>
          </Form>
        )}
      </Card>

      <Card className="mt-6 p-5">
        <CardHeader title="Notifications on this device" className="mb-1" />
        <p className="mb-4 text-sm text-muted">Get new messages and "can't make it" RSVPs as push notifications.</p>
        <PushToggle vapidPublicKey={vapidPublicKey} />
      </Card>
    </Page>
  );
}
