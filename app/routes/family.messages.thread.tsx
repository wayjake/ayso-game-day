import type { Route } from "./+types/family.messages.thread";
import { Link, data, redirect } from "react-router";
import { db, teams, users } from "~/db";
import { eq } from "drizzle-orm";
import { requireParent } from "~/utils/family.server";
import { getConversationAccess, getReplies, getThread, latestMessageId, markRead, postMessage, toggleReaction } from "~/utils/messages.server";
import { acknowledgeFromThread, acknowledgedMessageIds } from "~/utils/announcements.server";
import { MessageThread } from "~/components/MessageThread";
import { StaffBadge } from "~/components/StaffBadge";
import { conversationChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { getStaffRoles } from "~/utils/team-access.server";
import type { StaffRole } from "~/utils/team-roles";
import { ArrowLeft } from "@phosphor-icons/react";

async function access(request: Request, conversationId: number) {
  const { user } = await requireParent(request);
  const found = await getConversationAccess(conversationId, user.id);
  if (!found) throw new Response("Conversation not found", { status: 404 });
  // Coaching this team too: use the coach view of the thread
  if (found.viewer === "coach") {
    throw redirect(`/dashboard/team/${found.conversation.teamId}/messages/${found.conversation.id}`);
  }
  return { user, conversation: found.conversation, canPost: found.canPost };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, conversation, canPost } = await access(request, Number(params.conversationId));
  const messages = await getThread(conversation.id, user.id);
  const threadParam = new URL(request.url).searchParams.get("thread");
  const thread = threadParam ? await getReplies(conversation.id, Number(threadParam), user.id) : null;
  // Everything is on screen or summed up under its thread, so all of it counts as read
  await markRead(conversation.id, user.id, await latestMessageId(conversation.id));
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);

  // A private thread is with one staff member: show who, and their role
  let staff: { name: string; firstName: string; role: StaffRole | null } | null = null;
  if (conversation.kind === "direct" && conversation.staffUserId) {
    const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, conversation.staffUserId)).limit(1);
    const name = person?.name || person?.email.split("@")[0] || "Coach";
    staff = { name, firstName: name.split(" ")[0], role: (await getStaffRoles(conversation.teamId)).get(conversation.staffUserId) ?? null };
  }

  return data({
    me: user.id,
    kind: conversation.kind,
    teamName: team?.name ?? "Team",
    staff,
    canPost,
    messages,
    thread,
    realtime: isRealtimeConfigured()
      ? { channel: conversationChannel(conversation), name: user.name || user.email.split("@")[0] }
      : null,
    // Announcements in their private thread can be answered with "Got it"
    acknowledged: conversation.kind === "direct" ? await acknowledgedMessageIds(conversation.id) : null,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, conversation, canPost } = await access(request, Number(params.conversationId));
  const formData = await request.formData();
  if (formData.get("_action") === "ack" && conversation.kind === "direct") {
    await acknowledgeFromThread(Number(formData.get("messageId")), conversation.id);
    return data({ ok: true });
  }
  // Their staff member has left the team: the history stays, but nobody's there to read new messages
  if (!canPost) return data({ error: "They're no longer on the team staff" }, { status: 403 });
  if (formData.get("_action") === "react") {
    await toggleReaction(conversation, user, Number(formData.get("messageId")), String(formData.get("emoji") ?? ""));
    return data({ ok: true });
  }
  if (formData.get("_action") !== "send") return data({ error: "Unknown action" }, { status: 400 });
  const message = await postMessage(conversation, user, String(formData.get("body") ?? ""), {
    replyTo: Number(formData.get("replyTo")) || null,
  });
  if (!message) return data({ error: "Write a message first" }, { status: 400 });
  return data({ ok: true });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.kind === "team" ? "Team chat" : data?.staff?.name ?? "Messages"} - BenchTalk` }];
}

export default function FamilyThread({ loaderData }: Route.ComponentProps) {
  const { me, kind, teamName, staff, canPost, messages, thread, realtime, acknowledged } = loaderData;
  const direct = kind === "direct" && staff;
  return (
    <div>
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <Link to="/family/messages" className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="All messages">
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 font-semibold leading-tight">
            <span className="truncate">{direct ? staff.name : "Team chat"}</span>
            {direct && staff.role && <StaffBadge role={staff.role} short />}
          </h1>
          <p className="truncate text-xs text-muted">
            {direct
              ? `${teamName} · private: only you and ${staff.firstName}`
              : `${teamName} · every family and coach can see this`}
          </p>
        </div>
      </div>
      <MessageThread
        messages={messages}
        thread={thread}
        realtime={realtime}
        meId={me}
        emptyText={
          direct
            ? `Questions about practice, playing time, anything? Only ${staff.firstName} sees what you write here.`
            : "No messages yet. Say hi to the team."
        }
        placeholder={direct ? `Message ${staff.firstName}` : "Message the team"}
        acknowledged={acknowledged ?? undefined}
        readOnly={canPost ? null : `${staff?.firstName ?? "They"} is no longer on the team staff, so you can't send messages here.`}
      />
    </div>
  );
}
