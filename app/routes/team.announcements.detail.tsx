import type { Route } from "./+types/team.announcements.detail";
import { useEffect, useRef, useState } from "react";
import { Form, Link, data, useFetcher, useNavigation, useSearchParams } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import {
  familyNotesView,
  getAnnouncementTracker,
  handleNoteAction,
  remindAnnouncement,
  type RecipientState,
  type RecipientView,
} from "~/utils/announcements.server";
import { getConversationAccess, getThread, markRead, postMessage, setNeedsReply } from "~/utils/messages.server";
import { formatMessageDateTime, formatMessageTime } from "~/utils/dates";
import { FamilyNotes } from "~/components/FamilyNotes";
import { EmailToggle } from "~/components/EmailToggle";
import { Alert, Badge, Button, Card, Page, PageHeader, buttonClass, cx, inputClass } from "~/components/ui";
import {
  ArrowSquareOut,
  BellRinging,
  Check,
  CheckCircle,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  PaperPlaneRight,
  Warning,
  X,
} from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));
  const { team } = await requireTeamAccess(teamId, user.id);
  const tracker = await getAnnouncementTracker(parseId(params.announcementId), teamId, user.id);
  if (!tracker) throw new Response("Announcement not found", { status: 404 });

  // The family panel, opened with ?family=<email>
  const familyEmail = new URL(request.url).searchParams.get("family")?.toLowerCase() ?? null;
  const selected = familyEmail ? tracker.recipients.find((r) => r.familyEmail === familyEmail) ?? null : null;
  let panel = null;
  if (selected) {
    // A private copy: the sender's thread with this family (conversationId is set only for them).
    // A team chat copy: replies are in the thread under it, linked from the panel.
    const own = selected.mine && selected.conversationId ? selected.conversationId : null;
    const thread = own ? await getThread(own, user.id, 30) : [];
    if (own) await markRead(own, user.id, thread[thread.length - 1]?.id ?? null);
    panel = { recipient: selected, thread, notes: await familyNotesView(teamId, selected.familyEmail) };
  }

  return data({ team, me: user.id, ...tracker, panel });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  const notes = await handleNoteAction(formData, teamId, user.id);
  if (notes) return data(notes);

  if (intent === "remind") {
    const { reminded } = await remindAnnouncement(request, parseId(params.announcementId), teamId, user);
    return data({ ok: true, reminded });
  }

  if (intent === "reply" || intent === "done" || intent === "undone") {
    const found = await getConversationAccess(parseId(formData.get("conversationId")), user.id);
    if (!found || found.viewer !== "coach" || found.conversation.teamId !== teamId) {
      return data({ error: "Thread not found" }, { status: 404 });
    }
    if (intent === "reply") {
      const message = await postMessage(found.conversation, user, String(formData.get("body") ?? ""), {
        email: formData.get("alsoEmail") === "1",
      });
      if (!message) return data({ error: "Write a message first" }, { status: 400 });
      return data(message.emailError ? { error: `Saved, but the email didn't send: ${message.emailError}` } : { ok: true });
    }
    await setNeedsReply(found.conversation.id, intent === "undone");
    return data({ ok: true });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.announcement.subject ?? "Announcement"} - BenchTalk` }];
}

// ---------------------------------------------------------------------------

type Filter = "needs" | "quiet" | "replied" | "ack" | "all";

const stateLabel: Record<RecipientState, string> = {
  failed: "Didn't send",
  bounced: "Bounced",
  replied: "Replied",
  acknowledged: "Got it",
  opened: "Opened",
  delivered: "Delivered",
  sent: "Sent",
  pending: "Sending",
};

const stateTone: Record<RecipientState, "danger" | "success" | "primary" | "neutral" | "warning"> = {
  failed: "danger",
  bounced: "danger",
  replied: "success",
  acknowledged: "success",
  opened: "primary",
  delivered: "neutral",
  sent: "neutral",
  pending: "neutral",
};

function StateBadge({ r, opensTracked }: { r: RecipientView; opensTracked: boolean }) {
  // Opens are approximate (Apple Mail opens everything; many clients block the
  // pixel), so an email open reads as "probably"
  if (r.state === "opened") {
    return <Badge tone="primary">{r.seenInApp ? "Seen in app" : "Probably opened"}</Badge>;
  }
  if ((r.state === "delivered" || r.state === "sent") && !opensTracked) {
    return <Badge>{stateLabel[r.state]}</Badge>;
  }
  return <Badge tone={stateTone[r.state]}>{stateLabel[r.state]}</Badge>;
}

export default function AnnouncementTracker({ loaderData, actionData }: Route.ComponentProps) {
  const { team, me, announcement, senderName, recipients, stats, panel } = loaderData;
  const base = teamPath(team);
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const reminding = navigation.state === "submitting" && navigation.formData?.get("_action") === "remind";

  const opensTracked = stats.emailOpens > 0;
  const filter = (params.get("filter") as Filter | null) ?? (stats.needsYou > 0 ? "needs" : "all");
  const quietLabel = announcement.ask === "none" ? (opensTracked ? "Not opened" : "No response") : "Waiting";
  const isQuiet = (r: RecipientView) =>
    !["failed", "bounced"].includes(r.state) &&
    (announcement.ask === "ack" ? !r.acknowledgedAt && !r.repliedAt : announcement.ask === "reply" ? !r.repliedAt : !r.openedAt && !r.seenInApp && !r.repliedAt);

  const chips: { value: Filter; label: string; count: number; hidden?: boolean }[] = [
    { value: "needs", label: "Needs you", count: stats.needsYou },
    { value: "quiet", label: quietLabel, count: recipients.filter(isQuiet).length },
    { value: "replied", label: "Replied", count: stats.replied },
    { value: "ack", label: "Got it", count: stats.acknowledged, hidden: announcement.ask !== "ack" },
    { value: "all", label: "All", count: stats.total },
  ];
  const shown = recipients.filter((r) =>
    filter === "needs" ? r.needsYou
    : filter === "quiet" ? isQuiet(r)
    : filter === "replied" ? Boolean(r.repliedAt)
    : filter === "ack" ? Boolean(r.acknowledgedAt)
    : true
  );

  const linkFor = (r: RecipientView) => {
    const next = new URLSearchParams(params);
    next.set("family", r.familyEmail);
    return `?${next.toString()}`;
  };
  const closePanel = () => {
    const next = new URLSearchParams(params);
    next.delete("family");
    setParams(next, { preventScrollReset: true });
  };

  const responded = stats.responded;
  const pct = stats.total ? Math.round((responded / stats.total) * 100) : 0;

  return (
    <Page>
      <PageHeader
        back={{ to: `${base}/announcements`, label: "Announcements", className: "lg:hidden" }}
        title={announcement.subject}
        description={`Sent by ${senderName} · ${formatMessageDateTime(announcement.createdAt)} · ${stats.total} ${stats.total === 1 ? "family" : "families"}`}
      />

      {actionData && "reminded" in actionData && typeof actionData.reminded === "number" && (
        <Alert tone="success" className="mb-4">
          Reminder sent to {actionData.reminded} {actionData.reminded === 1 ? "family" : "families"}.
        </Alert>
      )}

      <div className={cx("grid gap-6", panel && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <div className="min-w-0">
          {/* Summary */}
          <Card className="mb-4 p-5" data-tour="tracker-summary">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="font-semibold">
                <span className="tabular">{responded}</span> of <span className="tabular">{stats.total}</span>{" "}
                {announcement.ask === "ack" ? "responded (Got it or a reply)" : announcement.ask === "reply" ? "replied" : "opened or replied"}
              </p>
              <span className="text-sm text-muted tabular">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <div><dt className="inline">Delivered </dt><dd className="inline font-semibold text-ink tabular">{stats.delivered}</dd></div>
              <div><dt className="inline">Opened </dt><dd className="inline font-semibold text-ink tabular">{opensTracked || stats.opened ? stats.opened : "?"}</dd></div>
              <div><dt className="inline">Replied </dt><dd className="inline font-semibold text-ink tabular">{stats.replied}</dd></div>
              {announcement.ask === "ack" && <div><dt className="inline">Got it </dt><dd className="inline font-semibold text-ink tabular">{stats.acknowledged}</dd></div>}
              {stats.bounced > 0 && <div><dt className="inline text-danger">Bounced </dt><dd className="inline font-semibold text-danger tabular">{stats.bounced}</dd></div>}
            </dl>
            {!opensTracked && stats.total > 0 && (
              <p className="mt-2 text-xs text-subtle">
                No email opens reported yet. Opens only show if open tracking is on for the sending domain, and even then they're approximate.
                Replies and “Got it” taps are exact.
              </p>
            )}
          </Card>

          {/* Filters */}
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Filter families" data-tour="tracker-filters">
            {chips.filter((c) => !c.hidden).map((c) => {
              const next = new URLSearchParams(params);
              next.set("filter", c.value);
              next.delete("family");
              return (
                <Link
                  key={c.value}
                  to={`?${next.toString()}`}
                  role="tab"
                  aria-selected={filter === c.value}
                  preventScrollReset
                  className={cx(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition",
                    filter === c.value ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:bg-surface-2",
                    c.value === "needs" && c.count > 0 && filter !== c.value && "ring-warning/50 text-warning"
                  )}
                >
                  {c.label}
                  <span className={cx("tabular", filter === c.value ? "text-white/70" : "text-muted")}>{c.count}</span>
                </Link>
              );
            })}
          </div>

          {/* Rows */}
          <Card className="divide-y divide-line overflow-hidden">
            {shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {filter === "needs" ? "Nothing needs you right now." : "No families here."}
              </p>
            ) : (
              shown.map((r) => (
                <Link
                  key={r.id}
                  to={linkFor(r)}
                  preventScrollReset
                  className={cx(
                    "flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2",
                    panel?.recipient.id === r.id && "bg-primary-soft hover:bg-primary-soft"
                  )}
                >
                  <span
                    aria-hidden
                    className={cx(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      r.needsYou ? "bg-warning" : r.state === "replied" || r.state === "acknowledged" ? "bg-success" : r.state === "opened" ? "bg-primary" : "bg-line-strong"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold">{r.familyLabel}</p>
                      <StateBadge r={r} opensTracked={opensTracked} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {r.lastReply ? `“${r.lastReply.replace(/\s+/g, " ")}”`
                        : r.needsYouReason ? r.needsYouReason
                        : r.state === "bounced" ? r.bounceReason
                        : r.acknowledgedAt ? `Got it from ${r.acknowledgedBy ?? "this family"} · ${formatMessageTime(r.acknowledgedAt)}`
                        : r.sentAt ? `Sent ${formatMessageTime(r.sentAt)}${r.remindedAt ? ` · reminded ${formatMessageTime(r.remindedAt)}` : ""}`
                        : r.error ?? "Sending…"}
                    </p>
                    {r.needsYouReason && r.lastReply && <p className="mt-0.5 text-xs font-semibold text-warning">{r.needsYouReason}</p>}
                  </div>
                </Link>
              ))
            )}
          </Card>

          {/* Replies to a reminder land in the sender's private threads, so only they send one */}
          {stats.awaiting > 0 && announcement.sentBy === me && (
            <Form method="post" className="mt-4">
              <input type="hidden" name="_action" value="remind" />
              <Button type="submit" variant="secondary" disabled={reminding} className="w-full sm:w-auto">
                <BellRinging size={18} />
                {reminding ? "Sending reminders…" : `Remind ${stats.awaiting} ${stats.awaiting === 1 ? "family" : "families"} who haven't responded`}
              </Button>
            </Form>
          )}

          <details className="mt-6 rounded-2xl bg-surface p-4 ring-1 ring-line">
            <summary className="cursor-pointer text-sm font-semibold">What was sent</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{announcement.body}</p>
          </details>
        </div>

        {panel && (
          <FamilyPanel
            key={panel.recipient.id}
            teamCode={team.code}
            me={me}
            senderName={senderName}
            panel={panel}
            opensTracked={opensTracked}
            onClose={closePanel}
          />
        )}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Family panel: their thread, a reply box, mark done, and notes. A sheet on
// phones and narrow desktops, a sticky column beside the list from xl (it
// sits in the Messages pane, beside the announcements list).

type Panel = NonNullable<Route.ComponentProps["loaderData"]["panel"]>;

function FamilyPanel({
  teamCode,
  me,
  senderName,
  panel,
  opensTracked,
  onClose,
}: {
  teamCode: string;
  me: string;
  senderName: string;
  panel: Panel;
  opensTracked: boolean;
  onClose: () => void;
}) {
  const { recipient: r, thread, notes } = panel;
  const reply = useFetcher<{ error?: string; ok?: boolean }>();
  const done = useFetcher();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const sending = reply.state !== "idle";

  useEffect(() => {
    if (reply.state === "idle" && reply.data?.ok) setDraft("");
  }, [reply.state, reply.data]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [thread.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pendingDone = done.formData?.get("_action");
  const needsReply = pendingDone ? pendingDone === "undone" : r.needsReply;

  const timeline: [string, string | null][] = [
    ["Sent", r.sentAt],
    ["Delivered", r.deliveredAt],
    [r.seenInApp && !r.openedAt ? "Seen in app" : "Opened", r.openedAt],
    [
      `Got it${r.acknowledgedBy ? ` from ${r.acknowledgedBy}` : ""}${r.acknowledgedVia === "email" ? " (email link)" : r.acknowledgedVia === "app" ? " (in the app)" : ""}`,
      r.acknowledgedAt,
    ],
    ["Replied", r.repliedAt],
    ["Bounced", r.bouncedAt],
  ];

  return (
    <>
      {/* Phone backdrop */}
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-30 bg-ink/30 xl:hidden" />
      <aside
        aria-label={r.familyLabel}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col rounded-t-2xl bg-surface shadow-2xl ring-1 ring-line xl:sticky xl:top-4 xl:inset-auto xl:z-auto xl:max-h-[calc(100dvh-14rem)] xl:rounded-2xl xl:shadow-card"
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{r.familyLabel}</h2>
            <p className="truncate text-xs text-muted">
              {r.familyEmail} · {r.onApp ? "On the app" : "Email only"}
              {r.sentToEmail !== r.familyEmail && <span className="text-warning"> · test copy went to {r.sentToEmail}</span>}
            </p>
          </div>
          <StateBadge r={r} opensTracked={opensTracked} />
          <button type="button" onClick={onClose} className="tap -mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* What happened to the email */}
          <ol className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs">
            {timeline.filter(([, at]) => at).map(([label, at]) => (
              <li key={label} className={cx("flex items-center gap-1", label === "Bounced" ? "text-danger" : "text-muted")}>
                {label === "Bounced" ? <Warning size={12} weight="bold" /> : label === "Opened" ? <EnvelopeSimpleOpen size={12} /> : <Check size={12} weight="bold" />}
                {label} {formatMessageTime(at!)}
              </li>
            ))}
            {r.bounceReason && <li className="w-full text-danger">{r.bounceReason}. Fix their email in Contacts.</li>}
            {r.error && <li className="w-full text-danger">{r.error}</li>}
          </ol>

          {r.inTeamChat ? (
            <div className="space-y-2 px-4 py-3 text-sm">
              {r.lastReply ? (
                <p className="whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3 py-2 text-ink">{r.lastReply}</p>
              ) : (
                <p className="text-muted">No reply from this family yet.</p>
              )}
              <p className="text-muted">This went to every family, so replies are in the team chat, under the announcement.</p>
              {r.conversationId && r.messageId && (
                <Link
                  to={teamPath(teamCode, `messages/${r.conversationId}?thread=${r.messageId}`)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  <ArrowSquareOut size={16} />
                  Open the replies
                </Link>
              )}
            </div>
          ) : !r.mine && (
            <p className="px-4 py-3 text-sm text-muted">
              What this family writes back goes to {senderName}'s private messages with them, so only {senderName} sees it.
            </p>
          )}

          {/* Thread */}
          {r.mine && <>
          <ol ref={listRef} className="space-y-2 px-4 py-3">
            {thread.map((m) => {
              const mine = m.senderId === me;
              return (
                <li key={m.id} className={cx("flex flex-col", m.senderIsCoach ? "items-end" : "items-start")}>
                  <span className="mb-0.5 px-1 text-[11px] font-medium text-muted">
                    {mine ? "You" : m.senderName}
                    {m.viaEmail && " · by email"}
                    {" · "}
                    {formatMessageTime(m.createdAt)}
                  </span>
                  <div
                    className={cx(
                      "max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      m.senderIsCoach ? "bg-primary text-white" : "bg-surface-2 text-ink"
                    )}
                  >
                    {m.announcement ? <strong className="block">{m.announcement.subject}</strong> : null}
                    {m.announcement ? m.body.slice(m.announcement.subject.length).trim() : m.body}
                  </div>
                  {m.fullEmail && (
                    <details className="mt-1 max-w-[90%] text-xs text-muted">
                      <summary className="cursor-pointer px-1">Show the full email</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-sans">{m.fullEmail}</pre>
                    </details>
                  )}
                  {m.emailedTo && <span className="mt-0.5 px-1 text-[11px] text-subtle">Emailed to {m.emailedTo}</span>}
                </li>
              );
            })}
          </ol>

          {/* Reply + done */}
          <div className="border-t border-line px-4 py-3">
            {reply.data?.error && <p className="mb-2 text-sm text-danger">{reply.data.error}</p>}
            <reply.Form method="post">
              <input type="hidden" name="_action" value="reply" />
              <input type="hidden" name="conversationId" value={r.conversationId ?? ""} />
              <EmailToggle email={r.familyEmail} pushReady={r.pushReady} conversationId={r.conversationId ?? ""} />
              <div className="flex items-end gap-2">
                <label htmlFor="panel-reply" className="sr-only">Reply</label>
                <textarea
                  id="panel-reply"
                  name="body"
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                  placeholder="Reply to this family"
                  className={cx(inputClass, "resize-y text-[16px] sm:text-sm")}
                />
                <Button type="submit" size="icon" disabled={!draft.trim() || sending || !r.conversationId} aria-label="Send reply">
                  <PaperPlaneRight size={18} weight="fill" />
                </Button>
              </div>
            </reply.Form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs text-muted">
                {r.pushReady ? <CheckCircle size={14} /> : <EnvelopeSimple size={14} />}
                {r.pushReady ? "They'll get a notification" : r.onApp ? "On the app, notifications off" : "Not on the app yet"}
              </p>
              <div className="flex items-center gap-1">
                {r.conversationId && (
                  <done.Form method="post">
                    <input type="hidden" name="_action" value={needsReply ? "done" : "undone"} />
                    <input type="hidden" name="conversationId" value={r.conversationId} />
                    <Button type="submit" variant={needsReply ? "secondary" : "ghost"} size="sm">
                      <Check size={16} weight="bold" />
                      {needsReply ? "Mark done" : "Done"}
                    </Button>
                  </done.Form>
                )}
                {r.conversationId && (
                  <Link to={teamPath(teamCode, `messages/${r.conversationId}`)} className="tap flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Open full thread">
                    <ArrowSquareOut size={18} />
                  </Link>
                )}
              </div>
            </div>
          </div>
          </>}

          <div className="border-t border-line px-4 py-4">
            <FamilyNotes notes={notes} familyEmail={r.familyEmail} meId={me} />
          </div>
        </div>
      </aside>
    </>
  );
}
