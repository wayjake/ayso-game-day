import type { Route } from "./+types/family.messages.thread";
import { useState } from "react";
import { Link, data, redirect } from "react-router";
import { db, teams, users } from "~/db";
import { eq } from "drizzle-orm";
import { requireParent } from "~/utils/family.server";
import {
  getConversationAccess,
  getReplies,
  getThread,
  groupSubtitle,
  groupTitle,
  deleteMessage,
  postMessage,
  toggleReaction,
} from "~/utils/messages.server";
import { groupView, handleGroupAction } from "~/utils/groups.server";
import { GroupPanel, type GroupInfo } from "~/components/GroupPanel";
import { channelView, handleChannelAction } from "~/utils/channels.server";
import { ChannelPanel } from "~/components/ChannelPanel";
import type { ChannelInfo } from "~/utils/channels";
import { Button } from "~/components/ui";
import { acknowledgeFromThread, acknowledgedMessageIds } from "~/utils/announcements.server";
import { MessageThread } from "~/components/MessageThread";
import { getReadReceipts, markConversationRead } from "~/utils/read-receipts.server";
import { StaffBadge } from "~/components/StaffBadge";
import { conversationChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { getStaffRoles } from "~/utils/team-access.server";
import type { StaffRole } from "~/utils/team-roles";
import { ArrowLeft, Info, UsersThree } from "@phosphor-icons/react";
import { navMotion } from "~/utils/nav-motion";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

async function access(request: Request, conversationId: string | null) {
  const { user } = await requireParent(request);
  const found = await getConversationAccess(conversationId, user.id);
  if (!found) throw new Response("Conversation not found", { status: 404 });
  // Coaching this team too: use the coach view of the thread
  if (found.viewer === "coach") {
    const [team] = await db.select({ code: teams.code }).from(teams).where(eq(teams.id, found.conversation.teamId)).limit(1);
    throw redirect(teamPath(team ?? "", `messages/${found.conversation.id}`));
  }
  return { user, conversation: found.conversation, canPost: found.canPost, canReply: found.canReply };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, conversation, canPost, canReply } = await access(request, parseId(params.conversationId));
  // In the team chat, a family's email reply shows as its trimmed text only:
  // the whole email (signature, quoted history) is for the staff
  const forFamilies = <T extends { fullEmail: string | null }>(m: T) => (conversation.kind !== "direct" ? { ...m, fullEmail: null } : m);
  const messages = (await getThread(conversation.id, user.id)).map(forFamilies);
  const threadParam = new URL(request.url).searchParams.get("thread");
  const replies = threadParam ? await getReplies(conversation.id, parseId(threadParam), user.id) : null;
  const thread = replies ? { root: forFamilies(replies.root), replies: replies.replies.map(forFamilies) } : null;
  // Everything is on screen or summed up under its thread, so all of it counts as read
  await markConversationRead(conversation, user.id);
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, conversation.teamId)).limit(1);

  // A private thread is with one staff member: show who, and their role
  let staff: { name: string; firstName: string; role: StaffRole | null } | null = null;
  if (conversation.kind === "direct" && conversation.staffUserId) {
    const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, conversation.staffUserId)).limit(1);
    const name = person?.name || person?.email.split("@")[0] || "Coach";
    staff = { name, firstName: name.split(" ")[0], role: (await getStaffRoles(conversation.teamId)).get(conversation.staffUserId) ?? null };
  }

  const group: GroupInfo | null = conversation.kind === "group" ? await groupView(conversation, user.id) : null;
  const channel: ChannelInfo | null = conversation.kind === "channel" ? await channelView(conversation, { id: user.id, side: "parent" }) : null;

  return data({
    me: user.id,
    receipts: await getReadReceipts(conversation),
    kind: conversation.kind,
    teamName: team?.name ?? "Team",
    staff,
    group,
    groupTitle: group ? groupTitle(group.name, group.members, user.id) : null,
    groupSubtitle: group ? groupSubtitle(group.members) : null,
    canPost,
    canReply,
    channel,
    messages,
    thread,
    realtime: isRealtimeConfigured()
      ? { channel: conversationChannel(conversation), name: user.name || user.email.split("@")[0] }
      : null,
    // Announcements (in their private thread or the team chat) can be answered with "Got it"
    acknowledged: await acknowledgedMessageIds(conversation, user.id),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, conversation, canPost, canReply } = await access(request, parseId(params.conversationId));
  const formData = await request.formData();
  const channeled = await handleChannelAction(formData, conversation, { id: user.id, side: "parent" });
  if (channeled) {
    if ("left" in channeled) return redirect("/family/messages");
    return data(channeled, { status: "error" in channeled ? 400 : 200 });
  }
  const grouped = await handleGroupAction(formData, conversation, user);
  if (grouped) {
    if ("left" in grouped) return redirect("/family/messages");
    return data(grouped, { status: "error" in grouped ? 400 : 200 });
  }
  if (formData.get("_action") === "ack") {
    await acknowledgeFromThread(parseId(formData.get("messageId")), conversation, user.id);
    return data({ ok: true });
  }
  // Your own messages can be deleted even once the thread is read-only
  if (formData.get("_action") === "delete") {
    const deleted = await deleteMessage(conversation, user.id, parseId(formData.get("messageId")));
    return deleted ? data({ ok: true }) : data({ error: "That message can't be deleted" }, { status: 400 });
  }
  // Their staff member has left the team (or the channel is archived): the history stays, but nobody's there to read new messages
  if (!canReply) {
    const why = conversation.kind === "channel" ? "This channel is archived" : "They're no longer on the team staff";
    return data({ error: why }, { status: 403 });
  }
  if (formData.get("_action") === "react") {
    await toggleReaction(conversation, user, parseId(formData.get("messageId")), String(formData.get("emoji") ?? ""));
    return data({ ok: true });
  }
  if (formData.get("_action") !== "send") return data({ error: "Unknown action" }, { status: 400 });
  // "Only staff post": families reply in threads but don't start messages
  const replyTo = parseId(formData.get("replyTo"));
  if (!replyTo && !canPost) return data({ error: "Only staff post in this channel" }, { status: 403 });
  const message = await postMessage(conversation, user, String(formData.get("body") ?? ""), { replyTo });
  if (!message) return data({ error: "Write a message first" }, { status: 400 });
  return data({ ok: true });
}

export function meta({ data }: Route.MetaArgs) {
  const title =
    data?.kind === "team" ? "Team chat" : data?.kind === "group" ? data.groupTitle : data?.channel ? `#${data.channel.name}` : data?.staff?.name;
  return [{ title: `${title ?? "Messages"} - BenchTalk` }];
}

export default function FamilyThread({ loaderData }: Route.ComponentProps) {
  const { me, kind, teamName, staff, canPost, canReply, channel, messages, thread, realtime, acknowledged, group, groupTitle, groupSubtitle, receipts } =
    loaderData;
  const direct = kind === "direct" && staff;
  const [showPeople, setShowPeople] = useState(false);
  return (
    <div>
      <div className="sticky top-[calc(3.5rem+var(--safe-top))] z-20 bleed-x flex items-center gap-3 border-b border-line bg-canvas/95 px-safe py-3 backdrop-blur">
        <Link to="/family/messages" {...navMotion("back")} className="tap -ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="All messages">
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 items-center gap-2 font-semibold leading-tight">
            <span className="truncate">{group ? groupTitle : channel ? `# ${channel.name}` : direct ? staff.name : "Team chat"}</span>
            {direct && staff.role && <StaffBadge role={staff.role} short />}
          </h1>
          <p className="truncate text-xs text-muted">
            {group
              ? `${teamName} · ${groupSubtitle} · only they can see it`
              : channel
                ? `${teamName} · ${channel.topic ?? channel.summary}`
                : direct
                ? `${teamName} · private: only you and ${staff.firstName}`
                : `${teamName} · every family and coach can see this`}
          </p>
        </div>
        {group && (
          <Button
            size="sm"
            variant={showPeople ? "secondary" : "ghost"}
            onClick={() => setShowPeople((v) => !v)}
            aria-expanded={showPeople}
            aria-controls="group-people"
          >
            <UsersThree size={16} />
            <span className="tabular">{group.members.length}</span>
            <span className="sr-only">people</span>
          </Button>
        )}
        {channel && (
          <Button
            size="sm"
            variant={showPeople ? "secondary" : "ghost"}
            onClick={() => setShowPeople((v) => !v)}
            aria-expanded={showPeople}
            aria-controls="channel-about"
          >
            <Info size={16} />
            <span className="sr-only">About this channel</span>
          </Button>
        )}
      </div>
      {showPeople && channel && (
        <div id="channel-about" className="mt-3 max-h-[60dvh] overflow-y-auto rounded-xl bg-surface p-3 ring-1 ring-line" data-no-pull>
          <ChannelPanel channel={channel} meId={me} />
        </div>
      )}
      {showPeople && group && (
        <div id="group-people" className="mt-3 max-h-[60dvh] overflow-y-auto rounded-xl bg-surface p-3 ring-1 ring-line" data-no-pull>
          <GroupPanel group={group} meId={me} />
        </div>
      )}
      <MessageThread
        messages={messages}
        thread={thread}
        realtime={realtime}
        meId={me}
        receipts={receipts}
        canDelete={kind === "direct"}
        emptyText={
          group
            ? "No messages yet. Only the people in this group see what's written here."
            : channel
              ? `No messages yet in #${channel.name}.`
              : direct
              ? `Questions about practice, playing time, anything? Only ${staff.firstName} sees what you write here.`
              : "No messages yet. Say hi to the team."
        }
        placeholder={group ? "Message the group" : channel ? `Message #${channel.name}` : direct ? `Message ${staff.firstName}` : "Message the team"}
        acknowledged={acknowledged ?? undefined}
        readOnly={
          canReply
            ? null
            : channel
              ? "This channel is archived."
              : `${staff?.firstName ?? "They"} is no longer on the team staff, so you can't send messages here.`
        }
        postNote={canPost ? null : "Only staff post here. You can react and reply in a thread."}
      />
    </div>
  );
}
