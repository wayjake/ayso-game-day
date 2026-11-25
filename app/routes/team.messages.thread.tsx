import type { Route } from "./+types/team.messages.thread";
import { useEffect, useState } from "react";
import { Link, data, useFetcher, useLocation, useSearchParams } from "react-router";
import { db, guardians, players, users } from "~/db";
import { and, eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import {
  type FamilyDelivery,
  familyDelivery,
  familyLabels,
  getConversationAccess,
  getReplies,
  getThread,
  latestMessageId,
  markRead,
  postMessage,
  toggleReaction,
  setNeedsReply,
} from "~/utils/messages.server";
import { familyNotesView, handleNoteAction } from "~/utils/announcements.server";
import { listFamilies } from "~/utils/parent-invites.server";
import { findFamily, getFamilyContext, getTeamChatContext } from "~/utils/family-context.server";
import { FamilyContext, TeamChatContext } from "~/components/FamilyContext";
import { MessageThread } from "~/components/MessageThread";
import { conversationChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { FamilyNotes } from "~/components/FamilyNotes";
import { EmailToggle } from "~/components/EmailToggle";
import { taskDraftFor } from "~/utils/tasks.server";
import { Button, cx } from "~/components/ui";
import { ArrowLeft, Check, NotePencil, SidebarSimple } from "@phosphor-icons/react";

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
  const messages = await getThread(conversation.id, user.id);
  const threadParam = new URL(request.url).searchParams.get("thread");
  const thread = threadParam ? await getReplies(conversation.id, Number(threadParam), user.id) : null;
  // Everything is on screen or summed up under its thread, so all of it counts as read
  await markRead(conversation.id, user.id, await latestMessageId(conversation.id));

  let title = "Team chat";
  let subtitle = "Every coach and family on the app";
  let familyEmail: string | null = null;
  let delivery: FamilyDelivery = { email: null, pushReady: false };

  if (conversation.kind === "direct") {
    const parent = conversation.parentUserId
      ? (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, conversation.parentUserId)).limit(1))[0]
      : undefined;
    familyEmail = conversation.familyEmail ?? parent?.email.toLowerCase() ?? null;
    const label = familyEmail ? (await familyLabels(conversation.teamId, [familyEmail])).get(familyEmail) : undefined;
    const kids = conversation.parentUserId
      ? (
          await db
            .select({ name: players.name })
            .from(guardians)
            .innerJoin(players, eq(guardians.playerId, players.id))
            .where(and(eq(guardians.userId, conversation.parentUserId), eq(guardians.teamId, conversation.teamId)))
        ).map((k) => k.name.split(" ")[0])
      : [];
    const kidNames = (kids.length ? kids : label?.kids ?? []).join(" & ") || "Family";
    delivery = await familyDelivery(conversation);
    title = parent?.name || label?.names[0] || parent?.email || familyEmail || "Family";
    subtitle = `${kidNames} · ${kids.length ? "private with the coaches" : "by email, not on the app yet"}`;
  }

  // The pane beside the thread on wide screens. Loaded on every poll along
  // with the thread, so RSVPs and announcement states stay current too.
  const family =
    conversation.kind === "direct"
      ? findFamily(await listFamilies(request, conversation.teamId), { email: familyEmail, parentUserId: conversation.parentUserId })
      : null;
  const context = family ? await getFamilyContext(conversation.teamId, family, familyEmail ?? family.email) : null;
  const teamContext = conversation.kind === "team" ? await getTeamChatContext(conversation.teamId) : null;

  // "Message" on the Tasks page: start the box with what this family still has to do
  const draft =
    new URL(request.url).searchParams.get("draft") === "tasks" && familyEmail
      ? await taskDraftFor(request, conversation.teamId, familyEmail, Boolean(conversation.parentUserId))
      : null;

  return data({
    me: user.id,
    teamId: conversation.teamId,
    context,
    teamContext,
    title,
    subtitle,
    kind: conversation.kind,
    messages,
    thread,
    realtime: isRealtimeConfigured()
      ? { channel: conversationChannel(conversation.teamId, conversation.id), name: user.name || user.email.split("@")[0] }
      : null,
    conversationId: conversation.id,
    needsReply: conversation.needsReply,
    familyEmail,
    delivery,
    notes: familyEmail ? await familyNotesView(conversation.teamId, familyEmail) : [],
    draft,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, conversation } = await access(request, Number(params.teamId), Number(params.conversationId));
  const formData = await request.formData();
  const intent = formData.get("_action");

  const notes = await handleNoteAction(formData, conversation.teamId, user.id);
  if (notes) return data(notes);

  if (intent === "done" || intent === "undone") {
    await setNeedsReply(conversation.id, intent === "undone");
    return data({ ok: true });
  }
  if (intent === "react") {
    await toggleReaction(conversation, user, Number(formData.get("messageId")), String(formData.get("emoji") ?? ""));
    return data({ ok: true });
  }
  if (intent !== "send") return data({ error: "Unknown action" }, { status: 400 });
  const message = await postMessage(conversation, user, String(formData.get("body") ?? ""), {
    email: formData.get("alsoEmail") === "1",
    replyTo: Number(formData.get("replyTo")) || null,
  });
  if (!message) return data({ error: "Write a message first" }, { status: 400 });
  if (message.emailError) return data({ error: `Sent in the app, but the email didn't go out: ${message.emailError}` });
  return data({ ok: true });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.title ?? "Messages"} - BenchTalk` }];
}

export default function CoachThread({ loaderData, params }: Route.ComponentProps) {
  const {
    me, title, subtitle, kind, messages, thread, realtime, needsReply, familyEmail, delivery, notes, conversationId, context, teamContext, teamId, draft,
  } = loaderData;
  // The draft is in the box now; drop it from the URL so a reload doesn't bring it back
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!searchParams.has("draft")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("draft");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [searchParams, setSearchParams]);
  const [showNotes, setShowNotes] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const location = useLocation();
  const done = useFetcher();
  const pending = done.formData?.get("_action");
  const flagged = pending ? pending === "undone" : needsReply;
  const hasDetails = Boolean(context || teamContext);

  return (
    // Phones: a page of its own, as before. lg: fills the pane beside the list. xl: plus the family details.
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:flex lg:min-h-0 lg:max-w-none lg:flex-1 lg:p-0">
      <div className="lg:flex lg:min-w-0 lg:flex-1 lg:flex-col">
        <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0 lg:static lg:mx-0 lg:shrink-0 lg:bg-surface lg:px-6">
          <div className="flex items-center gap-3">
            <Link
              to={`/dashboard/team/${params.teamId}/messages${location.search}`}
              className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
              aria-label="All messages"
            >
              <ArrowLeft size={20} weight="bold" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold leading-tight lg:text-lg">{title}</h1>
              <p className="truncate text-xs text-muted">{subtitle}</p>
            </div>
            {kind === "direct" && (
              <>
                <done.Form method="post">
                  <input type="hidden" name="_action" value={flagged ? "done" : "undone"} />
                  <Button type="submit" size="sm" variant={flagged ? "secondary" : "ghost"} title={flagged ? "Clear from Needs reply" : "Flag as needing a reply"}>
                    <Check size={16} weight="bold" />
                    <span className="hidden sm:inline">{flagged ? "Mark done" : "Done"}</span>
                  </Button>
                </done.Form>
                {familyEmail && (
                  // Notes live in the details pane on wide screens
                  <Button
                    size="sm"
                    variant={showNotes ? "secondary" : "ghost"}
                    onClick={() => setShowNotes((v) => !v)}
                    aria-expanded={showNotes}
                    aria-controls="thread-notes"
                    className={cx(showDetails && hasDetails && "xl:hidden")}
                  >
                    <NotePencil size={16} />
                    <span className="hidden sm:inline">Notes</span>
                    {notes.length > 0 && <span className="tabular text-muted">{notes.length}</span>}
                  </Button>
                )}
              </>
            )}
            {hasDetails && (
              <span className="hidden xl:block">
              <Button
                size="icon-sm"
                variant={showDetails ? "secondary" : "ghost"}
                onClick={() => {
                  setShowDetails((v) => !v);
                  setShowNotes(false);
                }}
                aria-pressed={showDetails}
                title={showDetails ? "Hide details" : "Show details"}
              >
                <SidebarSimple size={18} mirrored />
                <span className="sr-only">{showDetails ? "Hide details" : "Show details"}</span>
              </Button>
              </span>
            )}
          </div>
          {showNotes && familyEmail && (
            <div id="thread-notes" className="mt-3 max-h-[50dvh] overflow-y-auto rounded-xl bg-surface p-3 ring-1 ring-line">
              <FamilyNotes notes={notes} familyEmail={familyEmail} meId={me} />
            </div>
          )}
        </div>
        <MessageThread
          layout="pane"
          messages={messages}
          thread={thread}
          realtime={realtime}
          meId={me}
          emptyText={kind === "team" ? "No messages yet. Post something for every family on the team." : "No messages yet."}
          placeholder={kind === "team" ? "Message every family on the app" : "Message this family"}
          widthClass="max-w-2xl"
          initialDraft={draft}
          showEmailDetails
          composerExtra={
            delivery.email ? (
              <EmailToggle email={delivery.email} pushReady={delivery.pushReady} conversationId={conversationId} />
            ) : null
          }
        />
      </div>

      {hasDetails && showDetails && (
        <aside
          aria-label={kind === "team" ? "About the team chat" : "About this family"}
          className="hidden min-h-0 w-[320px] shrink-0 overflow-y-auto border-l border-line bg-surface xl:block"
        >
          {context && <FamilyContext family={context} teamId={teamId} meId={me} showNotes={!showNotes} />}
          {teamContext && <TeamChatContext context={teamContext} teamId={teamId} />}
        </aside>
      )}
    </div>
  );
}
