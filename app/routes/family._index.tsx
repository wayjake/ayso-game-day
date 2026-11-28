import type { Route } from "./+types/family._index";
import { teamPath } from "~/utils/team-path";
import { Link, data, useSearchParams } from "react-router";
import { db, pushSubscriptions } from "~/db";
import { eq } from "drizzle-orm";
import { requireParent, getCoachUserIds } from "~/utils/family.server";
import { getEvents, getRsvps, getTeamEvent, setRsvp } from "~/utils/schedule.server";
import { eventDayPhrase, eventPhrase, isRsvpStatus, type ScheduleEvent } from "~/utils/schedule";
import type { JobView } from "~/utils/jobs";
import { sendPush, isPushConfigured } from "~/utils/push.server";
import { formatGameDate, formatGameTime, formatTimeRange, relativeGameDay, todayISO } from "~/utils/dates";
import { RsvpButtons } from "~/components/RsvpButtons";
import { getFamilyMoney, type FamilyTeamMoney } from "~/utils/ledger.server";
import { familySharesByGame } from "~/utils/billing.server";
import { formatCents } from "~/utils/money";
import { MoneyCard } from "~/components/money";
import { familyTasks } from "~/utils/tasks.server";
import { alertJobGivenBack, getJob, getSignup, jobsByEvent, releaseSpot, takeSpot, teamFamilies } from "~/utils/jobs.server";
import { FamilyEventJobs } from "~/components/EventJobs";
import { getTournaments } from "~/utils/tournaments.server";
import { tournamentDates } from "~/utils/tournaments";
import { Alert, Badge, Card, DateTile, EmptyState, HomeAwayBadge, PlayerAvatar, buttonClass, cx } from "~/components/ui";
import { Bell, CalendarBlank, CaretRight, Clock, Coins, ListChecks, MapPin, Note, Sneaker, SoccerBall, Trophy } from "@phosphor-icons/react";
import { navMotion } from "~/utils/nav-motion";
import { parseId } from "~/utils/ids";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids, teamIds } = await requireParent(request);
  const today = todayISO();
  const events = await getEvents(teamIds, { from: today });
  const answers = await getRsvps(teamIds, kids.map((k) => k.playerId));
  const families = await teamFamilies(teamIds);
  const allJobs = await jobsByEvent(teamIds, families);
  const jobs = Object.fromEntries(events.filter((e) => allJobs[e.key]).map((e) => [e.key, allJobs[e.key]]));
  // Their kids and the kids' siblings: a spot held under any of them is theirs
  const myPlayerIds = [...new Set(kids.flatMap((k) => families.get(k.playerId)?.playerIds ?? [k.playerId]))];
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
    openTasks: (await familyTasks(kids)).filter((t) => t.state === "open").length,
    money: summarizeMoney(await getFamilyMoney(user.id, kids)),
    shares: await familySharesByGame(kids),
    jobs,
    myPlayerIds,
    tournaments: (await getTournaments(teamIds, { from: today })).map((t) => ({ id: t.id, teamId: t.teamId, name: t.name, startDate: t.startDate, endDate: t.endDate, location: t.location, notes: t.notes })),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user, kids } = await requireParent(request);
  const formData = await request.formData();

  const intent = formData.get("_action");
  if (intent === "volunteer" || intent === "giveBack") return jobAction(intent, formData, user.id, kids);
  if (intent !== "rsvp") return data({ error: "Unknown action" }, { status: 400 });

  const playerId = parseId(formData.get("playerId"));
  const eventType = formData.get("eventType");
  const eventId = parseId(formData.get("eventId"));
  const status = formData.get("status");

  // Only your own kids, only their team's events, only upcoming ones
  const kid = kids.find((k) => k.playerId === playerId);
  if (!kid || !eventId || !isRsvpStatus(status) || (eventType !== "game" && eventType !== "practice")) {
    return data({ error: "Can't RSVP for that" }, { status: 400 });
  }
  const event = await getTeamEvent(kid.teamId, eventType, eventId);
  if (!event || event.cancelled || event.date < todayISO()) {
    return data({ error: "That event can't take RSVPs" }, { status: 400 });
  }

  const previous = await setRsvp({ teamId: kid.teamId, playerId: kid.playerId, eventType, eventId, status, respondedBy: user.id });

  // Coaches hear about it when someone drops out
  if (status === "no" && previous !== "no") {
    await sendPush(await getCoachUserIds(kid.teamId), "dropouts", {
      title: `${kid.name.split(" ")[0]} can't make it`,
      body: `${kid.name} is out for ${eventPhrase(event)} ${eventDayPhrase(event.date)}.`,
      url: teamPath(kid.teamCode, `rsvps/${event.type}/${event.id}`),
      tag: `rsvp-${event.key}`,
    });
  }

  return data({ ok: true });
}

type LoaderData = Route.ComponentProps["loaderData"];

// Taking an open spot on a volunteer job, or giving back your own. Only your
// kids' teams, only upcoming events that aren't cancelled.
async function jobAction(intent: "volunteer" | "giveBack", formData: FormData, userId: string, kids: { playerId: string; teamId: string }[]) {
  const upcoming = async (teamId: string, job: { eventType: "game" | "practice"; eventId: string }) => {
    const event = await getTeamEvent(teamId, job.eventType, job.eventId);
    return event && !event.cancelled && event.date >= todayISO() ? event : null;
  };

  if (intent === "volunteer") {
    const kid = kids.find((k) => k.playerId === parseId(formData.get("playerId")));
    const job = kid ? await getJob(kid.teamId, parseId(formData.get("jobId"))) : null;
    if (!kid || !job || job.mode !== "volunteer") return data({ error: "You can't sign up for that one." }, { status: 400 });
    if (!(await upcoming(kid.teamId, job))) return data({ error: "That event is over or cancelled." }, { status: 400 });
    const family = (await teamFamilies([kid.teamId])).get(kid.playerId);
    if (!family) return data({ error: "You can't sign up for that one." }, { status: 400 });
    const ok = await takeSpot(job, { family, playerId: kid.playerId }, userId, "app");
    return ok ? data({ ok: true }) : data({ error: "Someone just took the last spot, or your family's already on it." }, { status: 409 });
  }

  const found = await getSignup(parseId(formData.get("signupId")));
  const teamKids = found ? kids.filter((k) => k.teamId === found.job.teamId) : [];
  const families = found ? await teamFamilies([found.job.teamId]) : new Map();
  const mine = found?.signup.playerId && teamKids.some((k) => families.get(k.playerId)?.playerIds.includes(found.signup.playerId!));
  if (!found || !mine) return data({ error: "That isn't yours to give back." }, { status: 400 });
  const event = await upcoming(found.job.teamId, found.job);
  if (!event) return data({ error: "That event is over or cancelled." }, { status: 400 });
  await releaseSpot(found.signup.id);
  await alertJobGivenBack(found.job, event, families.get(found.signup.playerId!)?.label ?? "A family", userId);
  return data({ ok: true });
}

// One line for the Schedule page: shown once the team has money on the app
function summarizeMoney(teams: FamilyTeamMoney[]) {
  const active = teams.filter((t) => t.history.length > 0 || t.pending.length > 0);
  if (active.length === 0) return null;
  return {
    owed: active.reduce((a, t) => a + t.owed, 0),
    dueBack: active.reduce((a, t) => a + t.dueBack, 0),
    pending: active.reduce((a, t) => a + t.pending.length, 0),
  };
}

export default function FamilySchedule({ loaderData }: Route.ComponentProps) {
  const { kids, events, answers, today, firstName, suggestPush, openTasks, money, shares, jobs, myPlayerIds, tournaments } = loaderData;
  // A tournament card sits above its first day's events; one already under way, at the top
  const items = [
    ...tournaments.map((t) => ({ kind: "tournament" as const, date: t.startDate < today ? today : t.startDate, time: "", tournament: t })),
    ...events.map((event) => ({ kind: "event" as const, date: event.date, time: event.time ?? "99", event })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
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
        {multipleTeams ? "Upcoming games and practices for your players." : `${kids[0].teamName}: upcoming games and practices.`}{" "}
        <Link to="/family/settings#calendar" className="font-medium text-primary hover:underline">
          Add to your calendar
        </Link>
      </p>

      {money && <MoneyCard {...money} className="mt-5" />}

      {openTasks > 0 && (
        <Link
          to="/family/todo"
          {...navMotion("tab")}
          className="mt-5 flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line transition hover:ring-line-strong"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
            <ListChecks size={22} weight="bold" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">To do</span>
            <span className="block text-sm text-muted">
              {openTasks === 1 ? "1 thing the coaches need from you" : `${openTasks} things the coaches need from you`}
            </span>
          </span>
          <CaretRight size={18} className="shrink-0 text-subtle" />
        </Link>
      )}

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

      {items.length === 0 ? (
        <Card className="mt-6">
          <EmptyState icon={<CalendarBlank size={24} />} title="Nothing scheduled yet">
            New games and practices show up here as soon as the coach adds them.
          </EmptyState>
        </Card>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((item) =>
            item.kind === "tournament" ? (
              <TournamentCard
                key={`t-${item.tournament.id}`}
                tournament={item.tournament}
                teamName={multipleTeams ? kids.find((k) => k.teamId === item.tournament.teamId)?.teamName : undefined}
                games={events.filter((e) => e.tournament?.id === item.tournament.id).length}
              />
            ) : (
              <EventCard
                key={item.event.key}
                event={item.event}
                kids={kids.filter((k) => k.teamId === item.event.teamId)}
                answers={answers}
                today={today}
                showTeam={multipleTeams}
                shares={shares[item.event.key]}
                jobs={jobs[item.event.key] ?? []}
                myPlayerIds={myPlayerIds}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}

// The whole tournament as one card; its games follow as their own cards
function TournamentCard({
  tournament,
  teamName,
  games,
}: {
  tournament: { name: string; startDate: string; endDate: string; location: string | null; notes: string | null };
  teamName?: string;
  games: number;
}) {
  return (
    <li>
      <Card className="flex gap-4 p-4 ring-warning/30">
        <DateTile iso={tournament.startDate} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-warning">
              <Trophy size={14} weight="fill" />
              Tournament
            </span>
            {teamName && <span className="text-xs text-muted">· {teamName}</span>}
          </div>
          <h2 className="mt-0.5 font-display text-xl font-bold leading-tight tracking-tight">{tournament.name}</h2>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{tournamentDates(tournament)}</span>
            {tournament.location && (
              <a href={mapsUrl(tournament.location)} target="_blank" rel="noopener" className="pointer-coarse:min-h-11 flex min-w-0 items-center gap-1.5 underline decoration-line-strong underline-offset-2 hover:text-ink">
                <MapPin size={16} className="shrink-0 text-subtle" />
                <span className="break-words">{tournament.location}</span>
              </a>
            )}
            {games > 0 && <span>{games === 1 ? "1 game" : `${games} games`}, below</span>}
          </div>
          {tournament.notes && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
              <Note size={16} className="mt-0.5 shrink-0 text-subtle" />
              <span className="whitespace-pre-line">{tournament.notes}</span>
            </p>
          )}
        </div>
      </Card>
    </li>
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
  shares,
  jobs,
  myPlayerIds,
}: {
  event: ScheduleEvent;
  kids: LoaderData["kids"];
  answers: LoaderData["answers"];
  today: string;
  showTeam: boolean;
  shares?: { name: string; cents: number }[];
  jobs: JobView[];
  myPlayerIds: string[];
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
                <a href={mapsUrl(event.location)} target="_blank" rel="noopener" className="pointer-coarse:min-h-11 flex min-w-0 items-center gap-1.5 underline decoration-line-strong underline-offset-2 hover:text-ink">
                  <MapPin size={16} className="shrink-0 text-subtle" />
                  <span className="break-words">{event.location}</span>
                </a>
              )}
            </div>
            {event.tournament && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
                <Trophy size={16} className="shrink-0 text-subtle" />
                Part of {event.tournament.name}
              </p>
            )}
            {event.notes && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
                <Note size={16} className="mt-0.5 shrink-0 text-subtle" />
                <span className="whitespace-pre-line">{event.notes}</span>
              </p>
            )}
            {shares?.map((sh) => (
              <Link key={sh.name} to="/family/finances" {...navMotion("tab")} className="mt-1.5 flex items-center gap-1.5 text-sm text-muted hover:underline">
                <Coins size={16} className="shrink-0 text-subtle" />
                Your share of {sh.name}: <span className="font-semibold text-ink">{formatCents(sh.cents)}</span>
              </Link>
            ))}
          </div>
        </div>

        <FamilyEventJobs jobs={jobs} myPlayerIds={myPlayerIds} signUpAs={kids[0]?.playerId ?? null} canChange={!event.cancelled && event.date >= today} />

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
