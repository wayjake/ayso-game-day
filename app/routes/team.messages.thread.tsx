import type { Route } from "./+types/team.messages.thread";
import { Link, data } from "react-router";
import { db, guardians, players, users } from "~/db";
import { and, eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import { getConversationAccess, getThread, markRead, postMessage } from "~/utils/messages.server";
import { MessageThread } from "~/components/MessageThread";
import { ArrowLeft } from "@phosphor-icons/react";

async function access(request: Request, teamId: number, conversationId: number) {
  const user = await getUser(request);
  const found = await getConversationAccess(conversationId, user.id);
  if (!found || found.viewer !== "coach" || found.conversation.teamId !== teamId) {
    throw new Response("Conversation not found", { status: 404 });
  }
  return { user, conversation: found.conversation };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, conversation } = await access(request, Number(params.teamId), Number(params.conversationId));
  const messages = await getThread(conversation.id);
  await markRead(conversation.id, user.id, messages[messages.length - 1]?.id ?? 0);

  let title = "Team chat";
  let subtitle = "Every coach and family on the app";
  if (conversation.kind === "direct" && conversation.parentUserId) {
    const [parent] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, conversation.parentUserId)).limit(1);
    const kids = await db
      .select({ name: players.name })
      .from(guardians)
      .innerJoin(players, eq(guardians.playerId, players.id))
      .where(and(eq(guardians.userId, conversation.parentUserId), eq(guardians.teamId, conversation.teamId)));
    title = parent?.name || parent?.email || "Family";
    subtitle = `${kids.map((k) => k.name.split(" ")[0]).join(" & ") || "Family"} · private with the coaches`;
  }

  return data({ me: user.id, title, subtitle, kind: conversation.kind, messages });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, conversation } = await access(request, Number(params.teamId), Number(params.conversationId));
  const formData = await request.formData();
  if (formData.get("_action") !== "send") return data({ error: "Unknown action" }, { status: 400 });
  const message = await postMessage(conversation, user, String(formData.get("body") ?? ""));
  if (!message) return data({ error: "Write a message first" }, { status: 400 });
  return data({ ok: true });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.title ?? "Messages"} - AYSO Game Day` }];
}

export default function CoachThread({ loaderData, params }: Route.ComponentProps) {
  const { me, title, subtitle, kind, messages } = loaderData;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
      <div className="sticky top-0 z-20 -mx-4 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
        <Link
          to={`/dashboard/team/${params.teamId}/messages`}
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="All messages"
        >
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-semibold leading-tight">{title}</h1>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      <MessageThread
        messages={messages}
        meId={me}
        emptyText={kind === "team" ? "No messages yet. Post something for every family on the team." : "No messages yet."}
        placeholder={kind === "team" ? "Message every family" : "Message this family"}
        widthClass="max-w-2xl"
      />
    </div>
  );
}
