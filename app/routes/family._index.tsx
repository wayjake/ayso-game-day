import type { Route } from "./+types/family._index";
import { Link, data, useSearchParams } from "react-router";
import { db, pushSubscriptions } from "~/db";
import { eq } from "drizzle-orm";
import { requireParent, getCoachUserIds } from "~/utils/family.server";
import { getEvents, getRsvps, getTeamEvent, setRsvp } from "~/utils/schedule.server";
import { eventDayPhrase, eventPhrase, isRsvpStatus, type ScheduleEvent } from "~/utils/schedule";
import { sendPush, isPushConfigured } from "~/utils/push.server";
import { formatGameDate, formatGameTime, formatTimeRange, relativeGameDay, todayISO } from "~/utils/dates";
import { RsvpButtons } from "~/components/RsvpButtons";
import { FamilyTodo } from "~/components/FamilyTodo";
import { familyTasks } from "~/utils/tasks.server";
import { setFamilyDone } from "~/utils/tasks.core";
import { Alert, Badge, Card, DateTile, EmptyState, HomeAwayBadge, PlayerAvatar, buttonClass, cx } from "~/components/ui";
import { Bell, CalendarBlank, Clock, MapPin, Note, Sneaker, SoccerBall } from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids, teamIds } = await requireParent(request);
  const today = todayISO();
  const events = await getEvents(teamIds, { from: today });
  const answers = await getRsvps(teamIds, kids.map((k) => k.playerId));
  const [sub] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id))
    .limit(1);

  return data({
    kids,
    events,
    answers,
    today,
    firstName: (user.name || "").split(" ")[0],
    suggestPush: isPushConfigured() && !sub,
    tasks: await familyTasks(kids),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user, kids } = await requireParent(request);
  const formData = await request.formData();

  // Checking a task off (or taking it back), only for your own kids on that task's team
  if (formData.get("_action") === "task") {
    const playerIds = formData.getAll("playerId").map(Number);
    const mine = kids.filter((k) => playerIds.includes(k.playerId));
    const teamId = mine[0]?.teamId;
    if (mine.length === 0 || mine.length !== playerIds.length || mine.some((k) => k.teamId !== teamId)) {
      return data({ error: "Can't update that task" }, { status: 400 });
    }
    const result = await setFamilyDone(db, {
      teamId,
      taskId: Number(formData.get("taskId")),
      playerIds,
      done: formData.get("done") === "1",
      by: user.id,
      via: "app",
    });
    if (!result.task || result.playerIds.length === 0) return data({ error: "That task isn't there anymore" }, { status: 400 });
    return data({ ok: true });
  }

  if (formData.get("_action") !== "rsvp") return data({ error: "Unknown action" }, { status: 400 });

  const playerId = Number(formData.get("playerId"));
  const eventType = formData.get("eventType");
  const eventId = Number(formData.get("eventId"));
  const status = formData.get("status");

  // Only your own kids, only their team's events, only upcoming ones
  const kid = kids.find((k) => k.playerId === playerId);
  if (!kid || !isRsvpStatus(status) || (eventType !== "game" && eventType !== "practice")) {
    return data({ error: "Can't RSVP for that" }, { status: 400 });
  }
  const event = await getTeamEvent(kid.teamId, eventType, eventId);
  if (!event || event.cancelled || event.date < todayISO()) {
    return data({ error: "That event can't take RSVPs" }, { status: 400 });
  }

  const previous = await setRsvp({ teamId: kid.teamId, playerId, eventType, eventId, status, respondedBy: user.id });

  // Coaches hear about it when someone drops out
  if (status === "no" && previous !== "no") {
    await sendPush(await getCoachUserIds(kid.teamId), "dropouts", {
      title: `${kid.name.split(" ")[0]} can't make it`,
      body: `${kid.name} is out for ${eventPhrase(event)} ${eventDayPhrase(event.date)}.`,
      url: `/dashboard/team/${kid.teamId}/rsvps/${event.type}/${event.id}`,
      tag: `rsvp-${event.key}`,
    });
  }

  return data({ ok: true });
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function FamilySchedule({ loaderData }: Route.ComponentProps) {
  const { kids, events, answers, today, firstName, suggestPush, tasks } = loaderData;
  const [params] = useSearchParams();
  const multipleTeams = new Set(kids.map((k) => k.teamId)).size > 1;

  return (
    <div className="pt-6 sm:pt-8">
      {params.get("welcome") && (
        <Alert tone="success" className="mb-5">
          Welcome{firstName ? `, ${firstName}` : ""}! You're linked to {kids.map((k) => k.name.split(" ")[0]).join(" & ")}. Tap Going or Can't go on each event so the coaches can plan.
        </Alert>
      )}

      <h1 className="font-display text-3xl font-bold tracking-tight">Schedule</h1>
      <p className="mt-1 text-muted">
        {multipleTeams ? "Upcoming games and practices for your players." : `${kids[0].teamName}: upcoming games and practices.`}
      </p>

      <FamilyTodo items={tasks} today={today} showTeam={multipleTeams} className="mt-5" />

      {suggestPush && (
        <Card className="mt-5 flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Bell size={22} weight="fill" />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <strong className="font-semibold">Get notified</strong>
            <span className="block text-muted">about new messages and schedule changes.</span>
          </p>
          <Link to="/family/settings" className={buttonClass({ size: "sm", variant: "secondary" })}>
            Set up
          </Link>
        </Card>
      )}

      {events.length === 0 ? (
        <Card className="mt-6">
          <EmptyState icon={<CalendarBlank size={24} />} title="Nothing scheduled yet">
            New games and practices show up here as soon as the coach adds them.
          </EmptyState>
        </Card>
      ) : (
        <ul className="mt-6 space-y-3">
          {events.map((event) => (
            <EventCard
              key={event.key}
              event={event}
              kids={kids.filter((k) => k.teamId === event.teamId)}
              answers={answers}
              today={today}
              showTeam={multipleTeams}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function mapsUrl(location: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function EventCard({
  event,
  kids,
  answers,
  today,
  showTeam,
}: {
  event: ScheduleEvent;
  kids: LoaderData["kids"];
  answers: LoaderData["answers"];
  today: string;
  showTeam: boolean;
}) {
  const soon = relativeGameDay(event.date, today);
  const isGame = event.type === "game";
  const time = isGame ? formatGameTime(event.time) : formatTimeRange(event.time, event.endTime);

  return (
    <li>
      <Card className={cx("overflow-hidden", event.cancelled && "opacity-70")}>
        <div className="flex gap-4 p-4">
          <DateTile iso={event.date} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cx("flex items-center gap-1 text-xs font-bold uppercase tracking-wider", isGame ? "text-brand" : "text-pitch")}>
                {isGame ? <SoccerBall size={14} weight="fill" /> : <Sneaker size={14} weight="fill" />}
                {isGame ? "Game" : "Practice"}
              </span>
              {showTeam && <span className="text-xs text-muted">· {kids[0]?.teamName}</span>}
              {isGame && <HomeAwayBadge homeAway={event.homeAway} />}
              {event.cancelled && <Badge tone="danger">Cancelled</Badge>}
              {!event.cancelled && (soon === "Today" || soon === "Tomorrow") && <Badge tone="primary">{soon}</Badge>}
            </div>
            <h2 className={cx("mt-0.5 font-display text-xl font-bold leading-tight tracking-tight", event.cancelled && "line-through")}>
              {isGame ? event.title : formatGameDate(event.date, { weekday: "long" })}
            </h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {isGame && <span>{formatGameDate(event.date, { weekday: "long" })}</span>}
              <span className="flex items-center gap-1.5">
                <Clock size={16} className="text-subtle" />
                {time || "Time TBD"}
              </span>
              {event.location && (
                <a href={mapsUrl(event.location)} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-1.5 underline decoration-line-strong underline-offset-2 hover:text-ink">
                  <MapPin size={16} className="shrink-0 text-subtle" />
                  <span className="break-words">{event.location}</span>
                </a>
              )}
            </div>
            {event.notes && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
                <Note size={16} className="mt-0.5 shrink-0 text-subtle" />
                <span className="whitespace-pre-line">{event.notes}</span>
              </p>
            )}
          </div>
        </div>

        {!event.cancelled && kids.length > 0 && (
          <div className="space-y-3 border-t border-line bg-surface-2/50 p-4">
            {kids.map((kid) => {
              const answer = answers.find((a) => a.playerId === kid.playerId && a.eventType === event.type && a.eventId === event.id);
              return (
                <div key={kid.playerId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2 sm:w-40">
                    <PlayerAvatar player={kid} size="sm" />
                    <span className="truncate text-sm font-semibold">{kid.name.split(" ")[0]}</span>
                  </div>
                  <div className="flex-1">
                    <RsvpButtons
                      playerId={kid.playerId}
                      eventType={event.type}
                      eventId={event.id}
                      status={answer?.status ?? null}
                      label={kid.name}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </li>
  );
}
