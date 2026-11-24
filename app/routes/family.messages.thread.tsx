import type { Route } from "./+types/family.messages.thread";
import { Link, data, redirect } from "react-router";
import { db, teams } from "~/db";
import { eq } from "drizzle-orm";
import { requireParent } from "~/utils/family.server";
import { getConversationAccess, getThread, markRead, postMessage } from "~/utils/messages.server";
import { acknowledgeFromThread, acknowledgedMessageIds } from "~/utils/announcements.server";
import { MessageThread } from "~/components/MessageThread";
import { ArrowLeft } from "@phosphor-icons/react";

async function access(request: Request, conversationId: number) {
  const { user } = await requireParent(request);
  const found = await getConversationAccess(conversationId, user.id);
  if (!found) throw new Response("Conversation not found", { status: 404 });
  // Coaching this team too: use the coach view of the thread
  if (found.viewer === "coach") {
    throw redirect(`/dashboard/team/${found.conversation.teamId}/messages/${found.conversation.id}`);
  }
  return { user, conversation: found.conversation };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, conversation } = await access(request, Number(params.conversationId));
  const messages = await getThread(conversation.id);
  await markRead(conversation.id, user.id, messages[messages.length - 1]?.id ?? 0);
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);

  return data({
    me: user.id,
    kind: conversation.kind,
    teamName: team?.name ?? "Team",
    messages,
    // Announcements in their private thread can be answered with "Got it"
    acknowledged: conversation.kind === "direct" ? await acknowledgedMessageIds(conversation.id) : null,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, conversation } = await access(request, Number(params.conversationId));
  const formData = await request.formData();
  if (formData.get("_action") === "ack" && conversation.kind === "direct") {
    await acknowledgeFromThread(Number(formData.get("messageId")), conversation.id);
    return data({ ok: true });
  }
  if (formData.get("_action") !== "send") return data({ error: "Unknown action" }, { status: 400 });
  const message = await postMessage(conversation, user, String(formData.get("body") ?? ""));
  if (!message) return data({ error: "Write a message first" }, { status: 400 });
  return data({ ok: true });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.kind === "team" ? "Team chat" : "Coaches"} - AYSO Game Day` }];
}

export default function FamilyThread({ loaderData }: Route.ComponentProps) {
  const { me, kind, teamName, messages, acknowledged } = loaderData;
  return (
    <div>
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <Link to="/family/messages" className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="All messages">
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-semibold leading-tight">{kind === "team" ? "Team chat" : "Coaches"}</h1>
          <p className="truncate text-xs text-muted">
            {kind === "team" ? `${teamName} · every family and coach can see this` : `${teamName} · only you and the coaches`}
          </p>
        </div>
      </div>
      <MessageThread
        messages={messages}
        meId={me}
        emptyText={kind === "team" ? "No messages yet. Say hi to the team." : "Questions about practice, playing time, anything? Message the coaches here."}
        placeholder={kind === "team" ? "Message the team" : "Message the coaches"}
        acknowledged={acknowledged ?? undefined}
      />
    </div>
  );
}
