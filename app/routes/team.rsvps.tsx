import type { Route } from "./+types/team.rsvps";
import { Form, data, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getEventRsvps, getTeamEvent, getTeamPlayers, setRsvp } from "~/utils/schedule.server";
import { getParentUserIdsForPlayers, getUserNames } from "~/utils/family.server";
import { db, guardians } from "~/db";
import { eq } from "drizzle-orm";
import { sendPush } from "~/utils/push.server";
import { eventDayPhrase, eventPhrase, isRsvpStatus, RSVP_LABELS, type RsvpStatus, type ScheduleEvent } from "~/utils/schedule";
import { formatGameDate, formatGameTime, formatTimeRange, todayISO } from "~/utils/dates";
import { RsvpButtons } from "~/components/RsvpButtons";
import { Alert, Badge, Button, Card, Page, PageHeader, PlayerAvatar, cx } from "~/components/ui";
import { BellRinging } from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";
import { getTeamStaff } from "~/utils/team-access.server";
import { addJob, alertAssigned, askForVolunteers, deleteJob, getJob, getSignup, jobsByEvent, releaseSpot, remindHolders, takeSpot, teamFamilies, updateJob } from "~/utils/jobs.server";
import { readJobForm } from "~/utils/jobs";
import { StaffEventJobs } from "~/components/EventJobs";

async function load(request: Request, params: { teamCode: string; eventType: string; eventId: string }) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));
  await requireTeamAccess(teamId, user.id);
  const event = await getTeamEvent(teamId, params.eventType, parseId(params.eventId));
  if (!event) throw new Response("Event not found", { status: 404 });
  return { user, teamId, event };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { teamId, event } = await load(request, params);
  const players = await getTeamPlayers(teamId);
  const answers = await getEventRsvps(event.type, event.id);
  const names = await getUserNames([...new Set(answers.map((a) => a.respondedBy))]);
  const linked = new Set(
    (await db.select({ playerId: guardians.playerId }).from(guardians).where(eq(guardians.teamId, teamId))).map((g) => g.playerId)
  );

  const families = await teamFamilies([teamId]);
  const familyOptions = [...new Map([...families.values()].map((f) => [f.key, f])).values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((f) => ({ value: `player:${f.playerIds[0]}`, label: f.label, playerIds: f.playerIds }));
  const staffOptions = (await getTeamStaff(teamId)).map((m) => ({ value: `staff:${m.userId}`, label: m.name || m.email.split("@")[0], userId: m.userId }));

  return data({
    event,
    jobs: (await jobsByEvent([teamId], families))[event.key] ?? [],
    familyOptions,
    staffOptions,
    today: todayISO(),
    players: players.map((p) => {
      const a = answers.find((x) => x.playerId === p.id);
      return {
        ...p,
        status: (a?.status ?? null) as RsvpStatus | null,
        note: a?.note ?? null,
        respondedBy: a ? names.get(a.respondedBy) ?? null : null,
        familyLinked: linked.has(p.id),
      };
    }),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, teamId, event } = await load(request, params);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "rsvp") {
    const playerId = parseId(formData.get("playerId"));
    const status = formData.get("status");
    const players = await getTeamPlayers(teamId);
    if (!playerId || !players.some((p) => p.id === playerId) || !isRsvpStatus(status)) {
      return data({ error: "Can't RSVP for that player" }, { status: 400 });
    }
    await setRsvp({ teamId, playerId, eventType: event.type, eventId: event.id, status, respondedBy: user.id });
    return data({ ok: true });
  }

  if (typeof intent === "string" && JOB_INTENTS.has(intent)) return jobAction(intent, formData, user.id, teamId, event);

  if (intent === "nudge") {
    const players = await getTeamPlayers(teamId);
    const answered = new Set((await getEventRsvps(event.type, event.id)).map((a) => a.playerId));
    const waiting = players.filter((p) => !answered.has(p.id)).map((p) => p.id);
    const parents = await getParentUserIdsForPlayers(waiting);
    await sendPush(parents, "team", {
      title: "Can you make it?",
      body: `RSVP for ${eventPhrase(event)} ${eventDayPhrase(event.date)} so the coaches can plan.`,
      url: "/family",
      tag: `nudge-${event.key}`,
    });
    return data({ nudged: parents.length });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

const JOB_INTENTS = new Set(["addJob", "editJob", "deleteJob", "assign", "unassign", "remindJob", "askJob"]);

// Staff managing an event's jobs. Past events can still be corrected, so the
// season's record stays right; only reminders need the event to be ahead.
async function jobAction(intent: string, formData: FormData, userId: string, teamId: string, event: ScheduleEvent) {
  if (intent === "addJob") {
    const parsed = readJobForm(formData);
    if ("error" in parsed) return data({ error: parsed.error }, { status: 400 });
    await addJob(teamId, event, parsed.values, userId);
    return data({ ok: true });
  }

  if (intent === "unassign") {
    const found = await getSignup(parseId(formData.get("signupId")));
    if (!found || found.job.teamId !== teamId || found.job.eventId !== event.id) return data({ error: "Already off it." }, { status: 400 });
    await releaseSpot(found.signup.id);
    return data({ ok: true });
  }

  const job = await getJob(teamId, parseId(formData.get("jobId")));
  if (!job || job.eventType !== event.type || job.eventId !== event.id) return data({ error: "That job is gone." }, { status: 404 });
  const upcoming = !event.cancelled && event.date >= todayISO();

  if (intent === "editJob") {
    const parsed = readJobForm(formData);
    if ("error" in parsed) return data({ error: parsed.error }, { status: 400 });
    await updateJob(job, parsed.values);
    return data({ ok: true });
  }
  if (intent === "deleteJob") {
    await deleteJob(job);
    return data({ ok: true });
  }

  const families = await teamFamilies([teamId]);
  if (intent === "assign") {
    const [kind, rawId] = String(formData.get("who") ?? "").split(":");
    const id = parseId(rawId);
    if (kind === "player" && id && families.has(id)) {
      const family = families.get(id)!;
      if (!(await takeSpot(job, { family, playerId: id }, userId, "coach"))) return data({ error: "It's full, or they're already on it." }, { status: 409 });
      if (upcoming) await alertAssigned(job, event, family);
      return data({ ok: true });
    }
    if (kind === "staff" && id && (await getTeamStaff(teamId)).some((m) => m.userId === id)) {
      if (!(await takeSpot(job, { userId: id }, userId, "coach"))) return data({ error: "It's full, or they're already on it." }, { status: 409 });
      return data({ ok: true });
    }
    return data({ error: "Pick a family or someone on staff." }, { status: 400 });
  }

  if (!upcoming) return data({ error: "This event is over or cancelled." }, { status: 400 });
  if (intent === "remindJob") {
    const reached = await remindHolders(job, event, families);
    return data({ message: reached === 0 ? "No one to remind: nobody on it has joined the app yet." : `Reminded ${reached} ${reached === 1 ? "person" : "people"}.` });
  }
  const asked = await askForVolunteers(job, event, families);
  return data({ message: asked === 0 ? "No one to ask: no other families have joined the app yet." : `Asked ${asked} ${asked === 1 ? "parent" : "parents"}.` });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Event - BenchTalk" }];
}

const order: (RsvpStatus | null)[] = ["yes", "maybe", "no", null];
const groupTitle = (s: RsvpStatus | null) => (s ? RSVP_LABELS[s] : "No reply yet");
const groupTone = { yes: "text-success", maybe: "text-warning", no: "text-danger" } as const;

export default function EventRsvps({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, players, today, jobs, familyOptions, staffOptions } = loaderData;
  const navigation = useNavigation();
  const nudging = navigation.state === "submitting" && navigation.formData?.get("_action") === "nudge";
  const past = event.date < today;
  const waitingLinked = players.filter((p) => !p.status && p.familyLinked).length;
  const time = event.type === "game" ? formatGameTime(event.time) : formatTimeRange(event.time, event.endTime);

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `${teamPath(params.teamCode)}/games`, label: "Schedule" }}
        title={event.type === "game" ? event.title : "Practice"}
        description={[formatGameDate(event.date), time, event.location].filter(Boolean).join(" · ")}
      />

      {event.cancelled && <Alert tone="warning" className="mb-6">This {event.type} is cancelled.</Alert>}
      {actionData && "nudged" in actionData && (
        <Alert tone="success" className="mb-6">
          {actionData.nudged === 0 ? "No one to remind: families without an answer haven't turned on notifications or joined yet." : `Reminded ${actionData.nudged} ${actionData.nudged === 1 ? "family" : "families"}.`}
        </Alert>
      )}

      {!past && !event.cancelled && waitingLinked > 0 && (
        <Form method="post" className="mb-6">
          <input type="hidden" name="_action" value="nudge" />
          <Button type="submit" variant="secondary" disabled={nudging}>
            <BellRinging size={18} />
            {nudging ? "Sending…" : `Remind ${waitingLinked} ${waitingLinked === 1 ? "family" : "families"} who haven't answered`}
          </Button>
        </Form>
      )}

      <StaffEventJobs jobs={jobs} families={familyOptions} staff={staffOptions} canRemind={!past && !event.cancelled} />

      <div className="space-y-6">
        {order.map((status) => {
          const group = players.filter((p) => p.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status ?? "none"}>
              <h2 className={cx("mb-2 text-sm font-semibold", status ? groupTone[status] : "text-muted")}>
                {groupTitle(status)} <span className="font-normal text-subtle tabular">{group.length}</span>
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {group.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:px-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <PlayerAvatar player={p} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{p.name}</div>
                          <div className="truncate text-xs text-muted">
                            {p.respondedBy ? `Answered by ${p.respondedBy}` : p.familyLinked ? "Family is on the app" : <Badge>Family not on the app</Badge>}
                          </div>
                        </div>
                      </div>
                      {!past && !event.cancelled && (
                        <div className="sm:w-72">
                          <RsvpButtons playerId={p.id} eventType={event.type} eventId={event.id} status={p.status} label={p.name} size="sm" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
