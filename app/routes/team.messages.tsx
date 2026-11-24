import type { Route } from "./+types/team.messages";
import { Form, Link, data, redirect, useNavigation, useSearchParams } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getOrCreateFamilyConversation, listCoachConversations } from "~/utils/messages.server";
import { listFamilies } from "~/utils/parent-invites.server";
import { familyLabel } from "~/utils/announcements.server";
import { assignUnmatched, dismissUnmatched, listUnmatched } from "~/utils/inbound-email.server";
import { vapidPublicKey } from "~/utils/push.server";
import { formatMessageTime } from "~/utils/dates";
import { stripQuotedReply } from "~/utils/email-reply";
import { ConversationList } from "~/components/ConversationList";
import { MessagesTabs } from "~/components/MessagesTabs";
import { PushToggle } from "~/components/PushToggle";
import { Badge, Button, Card, CardHeader, EmptyState, Page, PageHeader, buttonClass, cx, inputClass } from "~/components/ui";
import { AddressBook, EnvelopeSimple, PaperPlaneTilt, Question } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const conversations = await listCoachConversations(teamId, user.id);

  // Every family with an email, on the app or not, to start a private thread with
  const families = (await listFamilies(request, teamId)).map((f) => ({
    email: f.email,
    label: familyLabel(f),
    onApp: f.status === "joined",
  }));

  const unmatched = (await listUnmatched(user, teamId)).map((u) => ({
    ...u,
    preview: stripQuotedReply(u.text ?? "").body.slice(0, 280),
  }));

  return data({ team, conversations, families, unmatched, vapidPublicKey: vapidPublicKey() });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "startDirect" || intent === "assign") {
    const email = String(formData.get("familyEmail") ?? "").toLowerCase();
    const family = (await listFamilies(null, teamId)).find((f) => f.email === email);
    if (!family) return data({ error: "That family isn't on this team" }, { status: 400 });

    if (intent === "assign") {
      const conversation = await assignUnmatched(user, teamId, Number(formData.get("inboundId")), family.email);
      if (!conversation) return data({ error: "That email is already sorted" }, { status: 404 });
      return redirect(`/dashboard/team/${teamId}/messages/${conversation.id}`);
    }
    const conversation = await getOrCreateFamilyConversation(teamId, family.email, family.userIds[0]);
    return redirect(`/dashboard/team/${teamId}/messages/${conversation.id}`);
  }

  if (intent === "dismiss") {
    await dismissUnmatched(user, teamId, Number(formData.get("inboundId")));
    return data({ ok: true });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Messages - BenchTalk" }];
}

export default function TeamMessages({ loaderData }: Route.ComponentProps) {
  const { team, conversations, families, unmatched, vapidPublicKey } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const needsReplyCount = conversations.filter((c) => c.needsReply).length;
  const filter = params.get("filter") === "needs-reply" ? "needs-reply" : "all";
  const shown = filter === "needs-reply" ? conversations.filter((c) => c.needsReply) : conversations;

  return (
    <Page width="narrow">
      <PageHeader
        title="Messages"
        actions={
          <Link to={`${base}/announcements/new`} className={buttonClass({ variant: "secondary" })}>
            <PaperPlaneTilt size={18} />
            Announcement
          </Link>
        }
      />
      <MessagesTabs teamId={team.id} needsReply={needsReplyCount} />

      <div className="mb-3 flex gap-2" role="tablist" aria-label="Filter conversations">
        {[
          { value: "all", label: "All", to: "?" },
          { value: "needs-reply", label: `Needs reply${needsReplyCount ? ` · ${needsReplyCount}` : ""}`, to: "?filter=needs-reply" },
        ].map((f) => (
          <Link
            key={f.value}
            to={f.to}
            role="tab"
            aria-selected={filter === f.value}
            preventScrollReset
            className={cx(
              "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold ring-1 transition",
              filter === f.value ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:bg-surface-2"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState className="py-10" title="You're all caught up">
            Nothing is waiting on a reply.
          </EmptyState>
        </Card>
      ) : (
        <ConversationList items={shown} hrefFor={(id) => `${base}/messages/${id}`} />
      )}

      {unmatched.length > 0 && (
        <Card className="mt-6 p-5">
          <CardHeader title={`Emails to sort · ${unmatched.length}`} className="mb-1" />
          <p className="mb-4 text-sm text-muted">
            These came in by email but don't clearly belong to a family, usually because they were sent from a different address. Choose
            the family and they'll move into that family's thread.
          </p>
          <ul className="space-y-3">
            {unmatched.map((u) => (
              <li key={u.id} className="rounded-xl p-3 ring-1 ring-line">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="truncate font-semibold">{u.fromName || u.fromEmail}</p>
                  <span className="text-xs text-subtle">{formatMessageTime(u.receivedAt)}</span>
                </div>
                <p className="truncate text-xs text-muted">
                  {u.fromEmail}
                  {u.subject ? ` · ${u.subject}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {!u.authPassed && <Badge tone="warning">Sender not verified</Badge>}
                  {u.isAutoReply && <Badge>Auto-reply</Badge>}
                </div>
                {u.preview && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-ink">{u.preview}</p>}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Form method="post" className="flex flex-1 gap-2">
                    <input type="hidden" name="_action" value="assign" />
                    <input type="hidden" name="inboundId" value={u.id} />
                    <label htmlFor={`assign-${u.id}`} className="sr-only">Family</label>
                    <select id={`assign-${u.id}`} name="familyEmail" required className={inputClass} defaultValue="">
                      <option value="" disabled>Which family?</option>
                      {families.map((f) => (
                        <option key={f.email} value={f.email}>{f.label}</option>
                      ))}
                    </select>
                    <Button type="submit" size="md" className="shrink-0" disabled={navigation.state !== "idle"}>Move</Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="_action" value="dismiss" />
                    <input type="hidden" name="inboundId" value={u.id} />
                    <Button type="submit" variant="ghost" className="w-full sm:w-auto">Ignore</Button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6 p-5">
        <CardHeader title="Message a family" className="mb-3" />
        {families.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<AddressBook size={24} />}
            title="No family emails yet"
            action={<Link to={`${base}/contacts`} className={buttonClass()}>Add contacts</Link>}
          >
            Add a parent's email to a player's contacts to message them.
          </EmptyState>
        ) : (
          <>
            <Form method="post" className="flex gap-2">
              <input type="hidden" name="_action" value="startDirect" />
              <label htmlFor="familyEmail" className="sr-only">Family</label>
              <select id="familyEmail" name="familyEmail" required className={inputClass}>
                {families.map((f) => (
                  <option key={f.email} value={f.email}>
                    {f.label}
                    {f.onApp ? "" : " · email"}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClass({ className: "shrink-0" })}>
                <PaperPlaneTilt size={18} />
                Open
              </button>
            </Form>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <EnvelopeSimple size={14} />
              Families not on the app get your messages by email and can reply by email.
            </p>
          </>
        )}
      </Card>

      <Card className="mt-6 p-5">
        <CardHeader title="Notifications on this device" className="mb-1" />
        <p className="mb-4 text-sm text-muted">Get new messages, email replies and "can't make it" RSVPs as push notifications.</p>
        <PushToggle vapidPublicKey={vapidPublicKey} />
      </Card>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-subtle">
        <Question size={14} />
        New to announcements? Tap ? at the top for a quick tour.
      </p>
    </Page>
  );
}
