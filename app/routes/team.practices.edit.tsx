import type { Route } from "./+types/team.practices.edit";
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
import { Alert, Badge, Button, Card, Page, PageHeader, buttonClass, labelClass } from "~/components/ui";
import { ArrowCounterClockwise, Check, Prohibit, Trash, UsersThree } from "@phosphor-icons/react";

async function loadPractice(request: Request, params: { teamId: string; practiceId: string }) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.id, Number(params.practiceId)), eq(practices.teamId, teamId)))
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
  return data({ team, practice, following });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { team, practice } = await loadPractice(request, params);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const scheduleUrl = `/dashboard/team/${team.id}/games`;

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

  if (intent === "cancel" || intent === "restore") {
    const status = intent === "cancel" ? "cancelled" : "scheduled";
    await db.update(practices).set({ status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(practices.id, practice.id));
    await notifyFamilies(team.id, {
      title: intent === "cancel" ? "Practice cancelled" : "Practice is back on",
      body: describePractice(practice),
      tag: `practice-${practice.id}`,
    });
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
  return [{ title: "Edit practice - AYSO Game Day" }];
}

export default function EditPractice({ loaderData, actionData }: Route.ComponentProps) {
  const { team, practice, following } = loaderData;
  const base = `/dashboard/team/${team.id}`;
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
          <Form method="post">
            <input type="hidden" name="_action" value={cancelled ? "restore" : "cancel"} />
            <Button type="submit" variant="secondary" disabled={busy}>
              {cancelled ? <ArrowCounterClockwise size={18} /> : <Prohibit size={18} />}
              {cancelled ? "Restore practice" : "Cancel practice"}
            </Button>
          </Form>
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
          Cancelling keeps it on the schedule, crossed out, and notifies families. Deleting removes it quietly, along with its RSVPs.
        </p>
      </Card>
    </Page>
  );
}

function confirmDelete(what: string) {
  return window.confirm(`Delete ${what}? RSVPs for it are deleted too.`);
}
