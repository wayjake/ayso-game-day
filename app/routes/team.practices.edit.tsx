import type { Route } from "./+types/team.practices.edit";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, practices } from "~/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { GameDatePicker } from "~/components/GameDateTimePickers";
import { PracticeDetailFields, readPracticeDetails } from "~/components/PracticeFormFields";
import { deletePractices } from "~/utils/practices.server";
import { describePractice } from "~/utils/schedule";
import { formatTimeRange } from "~/utils/dates";
import { notifyFamilies } from "~/utils/schedule.server";
import { getParentUserIds } from "~/utils/family.server";
import { usersWithPush } from "~/utils/messages.server";
import { Alert, Badge, Button, Card, Page, PageHeader, buttonClass, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { Sheet, SheetTitle } from "~/components/Sheet";
import { ArrowCounterClockwise, Bell, BellSlash, Check, Prohibit, Trash, UsersThree } from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

async function loadPractice(request: Request, params: { teamCode: string; practiceId: string }) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));
  const { team } = await requireTeamAccess(teamId, user.id);
  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.id, parseId(params.practiceId) ?? ""), eq(practices.teamId, teamId)))
    .limit(1);
  if (!practice) throw new Response("Practice not found", { status: 404 });
  return { user, team, practice };
}

// This practice and the later ones in its series
function laterInSeries(practice: typeof practices.$inferSelect) {
  return and(
    eq(practices.teamId, practice.teamId),
    eq(practices.seriesId, practice.seriesId!),
    gte(practices.practiceDate, practice.practiceDate)
  );
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { team, practice } = await loadPractice(request, params);
  const following = practice.seriesId
    ? (await db.select({ id: practices.id }).from(practices).where(laterInSeries(practice))).length
    : 0;
  // Who a cancel or restore notification would reach: parents on the app with notifications on
  const parents = await getParentUserIds(team.id);
  const withPush = (await usersWithPush(parents)).size;
  return data({ team, practice, following, reach: { parents: parents.length, withPush } });
}

const MAX_NOTICE_TITLE = 60;
const MAX_NOTICE_BODY = 240;

export async function action({ request, params }: Route.ActionArgs) {
  const { team, practice } = await loadPractice(request, params);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const scheduleUrl = `${teamPath(team)}/games`;

  if (intent === "update") {
    const details = readPracticeDetails(formData);
    if ("error" in details) return data({ error: details.error }, { status: 400 });
    const practiceDate = String(formData.get("practiceDate") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(practiceDate)) return data({ error: "Pick a date" }, { status: 400 });

    const applyToSeries = practice.seriesId && formData.get("applyToSeries") === "on";
    if (applyToSeries) {
      // Time, place and notes for the rest of the series; the date only moves this one
      await db
        .update(practices)
        .set({ ...details.values, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(laterInSeries(practice));
    }
    await db
      .update(practices)
      .set({ practiceDate, ...details.values, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(practices.id, practice.id));

    const updated = { practiceDate, ...details.values };
    const moved =
      practice.practiceDate !== updated.practiceDate ||
      practice.startTime !== updated.startTime ||
      practice.endTime !== updated.endTime ||
      practice.location !== updated.location;
    if (moved && practice.status === "scheduled") {
      await notifyFamilies(team.id, applyToSeries
        ? { title: "Practice schedule changed", body: `Upcoming practices are now ${[formatTimeRange(updated.startTime, updated.endTime), updated.location].filter(Boolean).join(" at ")}.` }
        : { title: "Practice changed", body: `Now ${describePractice(updated)} (was ${describePractice(practice)}).`, tag: `practice-${practice.id}` });
    }
    return redirect(scheduleUrl);
  }

  // Families are only told when the coach chose to, with the text they saw and edited
  if (intent === "cancel" || intent === "restore") {
    const notify = formData.get("notify") === "1";
    const title = String(formData.get("title") ?? "").trim().replace(/\s+/g, " ");
    const body = String(formData.get("body") ?? "").trim();
    if (notify && (!title || !body)) return data({ error: "Write a title and a message, or untick Notify families" }, { status: 400 });
    if (title.length > MAX_NOTICE_TITLE || body.length > MAX_NOTICE_BODY) {
      return data({ error: `Keep the title under ${MAX_NOTICE_TITLE} characters and the message under ${MAX_NOTICE_BODY}` }, { status: 400 });
    }
    const status = intent === "cancel" ? "cancelled" : "scheduled";
    await db.update(practices).set({ status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(practices.id, practice.id));
    if (notify) await notifyFamilies(team.id, { title, body, tag: `practice-${practice.id}` });
    return redirect(scheduleUrl);
  }

  if (intent === "delete" || intent === "deleteSeries") {
    const ids =
      intent === "deleteSeries" && practice.seriesId
        ? (await db.select({ id: practices.id }).from(practices).where(laterInSeries(practice))).map((p) => p.id)
        : [practice.id];
    await deletePractices(team.id, ids);
    return redirect(scheduleUrl);
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit practice - BenchTalk" }];
}

export default function EditPractice({ loaderData, actionData }: Route.ComponentProps) {
  const { team, practice, following, reach } = loaderData;
  const [statusSheet, setStatusSheet] = useState(false);
  const base = `${teamPath(team)}`;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const cancelled = practice.status === "cancelled";

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `${base}/games`, label: "Schedule" }}
        title="Edit practice"
        description={describePractice(practice)}
        actions={
          <Link to={`${base}/rsvps/practice/${practice.id}`} className={buttonClass({ variant: "secondary" })}>
            <UsersThree size={18} />
            RSVPs
          </Link>
        }
      />

      {actionData?.error && <Alert className="mb-6">{actionData.error}</Alert>}
      {cancelled && <Alert tone="warning" className="mb-6">This practice is cancelled. Families see it crossed out.</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <input type="hidden" name="_action" value="update" />
          <div>
            <label htmlFor="practiceDate" className={labelClass}>Date</label>
            <GameDatePicker id="practiceDate" name="practiceDate" required defaultValue={practice.practiceDate} />
          </div>

          <PracticeDetailFields defaults={practice} />

          {practice.seriesId && following > 1 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-4 text-sm">
              <input type="checkbox" name="applyToSeries" className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                <span className="font-semibold">Also change the {following - 1} later practices in this series</span>
                <span className="block text-muted">Updates time, location and notes. Their dates stay the same.</span>
              </span>
            </label>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to={`${base}/games`} className={buttonClass({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
            <button type="submit" disabled={busy} className={buttonClass({ size: "lg" })}>
              <Check size={20} weight="bold" />
              Save
            </button>
          </div>
        </Form>
      </Card>

      <Card className="mt-6 space-y-4 p-5 sm:p-6">
        <h2 className="text-base font-semibold">
          {cancelled ? "Restore or remove" : "Cancel or remove"}
          {practice.seriesId && <Badge className="ml-2">Weekly series</Badge>}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setStatusSheet(true)}>
            {cancelled ? <ArrowCounterClockwise size={18} /> : <Prohibit size={18} />}
            {cancelled ? "Restore practice" : "Cancel practice"}
          </Button>
          <Form method="post" onSubmit={(e) => !confirmDelete("this practice") && e.preventDefault()}>
            <input type="hidden" name="_action" value="delete" />
            <Button type="submit" variant="danger-soft" disabled={busy}>
              <Trash size={18} />
              Delete
            </Button>
          </Form>
          {practice.seriesId && following > 1 && (
            <Form method="post" onSubmit={(e) => !confirmDelete(`this and the ${following - 1} later practices`) && e.preventDefault()}>
              <input type="hidden" name="_action" value="deleteSeries" />
              <Button type="submit" variant="danger-soft" disabled={busy}>
                <Trash size={18} />
                Delete this and {following - 1} later
              </Button>
            </Form>
          )}
        </div>
        <p className="text-sm text-muted">
          Cancelling keeps it on the schedule, crossed out, and you choose whether to notify families. Deleting removes it quietly, along with its RSVPs.
        </p>
      </Card>

      {statusSheet && (
        <StatusSheet
          restoring={cancelled}
          summary={describePractice(practice)}
          reach={reach}
          busy={busy}
          onClose={() => setStatusSheet(false)}
        />
      )}
    </Page>
  );
}

function confirmDelete(what: string) {
  return window.confirm(`Delete ${what}? RSVPs for it are deleted too.`);
}

// Cancelling or restoring: whether to tell families, and exactly what they'll
// see, before anything happens. The notification is a push to every parent on
// the app with notifications on (the "team" kind, which they can't turn off).
function StatusSheet({
  restoring,
  summary,
  reach,
  busy,
  onClose,
}: {
  restoring: boolean;
  summary: string;
  reach: { parents: number; withPush: number };
  busy: boolean;
  onClose: () => void;
}) {
  const [notify, setNotify] = useState(reach.withPush > 0);
  const [title, setTitle] = useState(restoring ? "Practice is back on" : "Practice cancelled");
  const [body, setBody] = useState(restoring ? `Practice on ${summary} is back on.` : `Practice on ${summary} is cancelled.`);
  const missing = reach.parents - reach.withPush;
  const verb = restoring ? "Restore" : "Cancel";

  return (
    <Sheet labelledBy="practice-status-title" onClose={onClose}>
      {(close) => (
        <Form method="post">
          <input type="hidden" name="_action" value={restoring ? "restore" : "cancel"} />
          <input type="hidden" name="notify" value={notify ? "1" : "0"} />
          <SheetTitle
            id="practice-status-title"
            icon={
              <span
                className={cx(
                  "grid size-14 shrink-0 place-items-center rounded-2xl",
                  restoring ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
                )}
                aria-hidden
              >
                {restoring ? <ArrowCounterClockwise size={28} weight="bold" /> : <Prohibit size={28} weight="bold" />}
              </span>
            }
            title={`${verb} this practice?`}
            subtitle={summary}
          />
          <p className="mt-4 text-sm text-muted">
            {restoring ? "It goes back on the schedule as normal." : "It stays on the schedule, crossed out, so families can see it's off."}
          </p>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              disabled={reach.withPush === 0}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Notify families</span>
              <span className="block text-sm text-muted">
                {reach.withPush === 0
                  ? "No parents have notifications on yet, so nobody would get it."
                  : `A notification to ${reach.withPush} ${reach.withPush === 1 ? "parent" : "parents"} with notifications on.${missing > 0 ? ` ${missing} without them will only see it on the schedule.` : ""}`}
              </span>
            </span>
          </label>

          {notify && (
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="notice-title" className={labelClass}>Title</label>
                <input
                  id="notice-title"
                  name="title"
                  required
                  maxLength={60}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="notice-body" className={labelClass}>Message</label>
                <textarea
                  id="notice-body"
                  name="body"
                  required
                  rows={3}
                  maxLength={240}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className={cx(inputClass, "h-auto min-h-20 py-2.5 leading-relaxed")}
                />
                <p className={hintClass}>{240 - body.length} characters left</p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Preview</p>
                <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3 ring-1 ring-line" aria-label="How the notification will look">
                  <img src="/icons/app-192.png" alt="" className="size-9 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{title.trim() || "Title"}</p>
                      <span className="shrink-0 text-xs text-subtle">now</span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-ink">{body.trim() || "Message"}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Button type="submit" size="lg" variant={restoring ? "primary" : "danger"} disabled={busy || (notify && (!title.trim() || !body.trim()))}>
              {notify ? <Bell size={18} weight="fill" /> : <BellSlash size={18} />}
              {busy ? "Saving…" : notify ? `${verb} and notify families` : `${verb} without notifying`}
            </Button>
            <Button variant="secondary" size="lg" onClick={close}>
              {restoring ? "Keep it cancelled" : "Keep the practice"}
            </Button>
          </div>
        </Form>
      )}
    </Sheet>
  );
}

