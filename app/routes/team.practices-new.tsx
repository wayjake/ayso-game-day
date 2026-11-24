import type { Route } from "./+types/team.practices-new";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, practices } from "~/db";
import { GameDatePicker } from "~/components/GameDateTimePickers";
import { PracticeDetailFields, readPracticeDetails } from "~/components/PracticeFormFields";
import { MAX_SERIES_PRACTICES, describePractice, describeSeries, seriesDates } from "~/utils/practices.server";
import { notifyFamilies } from "~/utils/schedule.server";
import { addDays, dayOfWeek, todayISO } from "~/utils/dates";
import { Alert, Card, Page, PageHeader, buttonClass, labelClass, cx } from "~/components/ui";
import { ArrowsClockwise, CalendarBlank, Sneaker } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(parseInt(params.teamId), user.id);
  return data({ team });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();

  const details = readPracticeDetails(formData);
  if ("error" in details) return data({ error: details.error }, { status: 400 });

  const repeat = formData.get("repeat") === "weekly";
  const startDate = String(formData.get("startDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return data({ error: repeat ? "Pick the first week's date" : "Pick a date" }, { status: 400 });
  }

  let dates = [startDate];
  let weekdays: number[] = [];
  if (repeat) {
    const endDate = String(formData.get("endDate") ?? "");
    weekdays = formData.getAll("weekday").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (weekdays.length === 0) return data({ error: "Pick at least one day of the week" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return data({ error: "Pick the last date for this schedule" }, { status: 400 });
    if (endDate < startDate) return data({ error: "The last date must be after the first" }, { status: 400 });
    dates = seriesDates(startDate, endDate, weekdays);
    if (dates.length === 0) return data({ error: "None of those days fall between the two dates" }, { status: 400 });
    if (dates.length > MAX_SERIES_PRACTICES) {
      return data({ error: `That's more than ${MAX_SERIES_PRACTICES} practices. Pick a shorter range.` }, { status: 400 });
    }
  }

  const seriesId = repeat ? crypto.randomUUID() : null;
  await db.insert(practices).values(
    dates.map((practiceDate) => ({ teamId, seriesId, practiceDate, ...details.values, createdBy: user.id }))
  );

  await notifyFamilies(teamId, repeat
    ? { title: "Practice schedule posted", body: `${describeSeries(weekdays, dates, details.values.startTime, details.values.endTime)}. Tap to RSVP.`, tag: `practices-${seriesId}` }
    : { title: "Practice added", body: `${describePractice({ practiceDate: startDate, ...details.values })}. Tap to RSVP.` });

  return redirect(`/dashboard/team/${teamId}/games`);
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Add practice - BenchTalk" }];
}

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const choiceClass =
  "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm font-medium transition hover:bg-surface-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30";

export default function NewPractice({ loaderData, actionData }: Route.ComponentProps) {
  const { team } = loaderData;
  const scheduleUrl = `/dashboard/team/${team.id}/games`;
  const [repeat, setRepeat] = useState<"once" | "weekly">("weekly");
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const today = todayISO();

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: scheduleUrl, label: "Schedule" }}
        title="Add practice"
        description="Families get a notification and can RSVP right away."
      />

      {actionData?.error && <Alert className="mb-6">{actionData.error}</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <fieldset>
            <legend className={labelClass}>How often</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className={choiceClass}>
                <input type="radio" name="repeat" value="weekly" checked={repeat === "weekly"} onChange={() => setRepeat("weekly")} className="h-4 w-4 accent-primary" />
                <ArrowsClockwise size={18} />
                Every week
              </label>
              <label className={choiceClass}>
                <input type="radio" name="repeat" value="once" checked={repeat === "once"} onChange={() => setRepeat("once")} className="h-4 w-4 accent-primary" />
                <CalendarBlank size={18} />
                Just once
              </label>
            </div>
          </fieldset>

          {repeat === "weekly" && (
            <fieldset>
              <legend className={labelClass}>On these days</legend>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((d) => (
                  <label
                    key={d.value}
                    className={cx(choiceClass, "min-h-11 justify-center px-0 text-xs sm:text-sm [&>input]:sr-only")}
                  >
                    <input type="checkbox" name="weekday" value={d.value} defaultChecked={d.value === 2 || d.value === 4} />
                    {d.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className={cx("grid grid-cols-1 gap-6", repeat === "weekly" && "md:grid-cols-2 md:gap-4")}>
            <div>
              <label htmlFor="startDate" className={labelClass}>{repeat === "weekly" ? "Starting" : "Date"}</label>
              <GameDatePicker id="startDate" name="startDate" required defaultValue={today} />
            </div>
            {repeat === "weekly" && (
              <div>
                <label htmlFor="endDate" className={labelClass}>Through</label>
                <GameDatePicker id="endDate" name="endDate" required defaultValue={addDays(today, 8 * 7 - dayOfWeek(today))} />
              </div>
            )}
          </div>

          <PracticeDetailFields defaults={{ startTime: "17:30", endTime: "19:00" }} />

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to={scheduleUrl} className={buttonClass({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
            <button type="submit" disabled={saving} className={buttonClass({ size: "lg" })}>
              <Sneaker size={20} weight="bold" />
              {saving ? "Adding…" : repeat === "weekly" ? "Add practices" : "Add practice"}
            </button>
          </div>
        </Form>
      </Card>
    </Page>
  );
}
