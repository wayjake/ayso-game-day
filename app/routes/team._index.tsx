import type { Route } from "./+types/team._index";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games, players, assignments } from "~/db";
import { eq, and, gte, count } from "drizzle-orm";
import { addDays, formatGameDate, formatGameTime, formatTimeRange, relativeGameDay, todayISO } from "~/utils/dates";
import { Card, CardHeader, DateTile, EmptyState, HomeAwayBadge, Page, PlayerAvatar, buttonClass, cx } from "~/components/ui";
import { getEvents, getRsvps } from "~/utils/schedule.server";
import { countRsvps, type RsvpCounts } from "~/utils/schedule";
import { listCoachConversations } from "~/utils/messages.server";
import { countUnmatched } from "~/utils/inbound-email.server";
import { listFamilies } from "~/utils/parent-invites.server";
import { getAnnouncementTracker, listAnnouncements } from "~/utils/announcements.server";
import {
  AddressBook,
  ChatCircleDots,
  CheckCircle,
  EnvelopeSimple,
  Megaphone,
  UserPlus,
  CalendarBlank,
  CalendarPlus,
  CaretRight,
  Clock,
  MapPin,
  PencilSimple,
  Play,
  Plus,
  Printer,
  SoccerBall,
  UsersThree,
} from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);

  // Next few games; the first one gets the spotlight
  const today = todayISO();
  const upcomingGames = await db
    .select({
      id: games.id,
      opponent: games.opponent,
      gameDate: games.gameDate,
      gameTime: games.gameTime,
      field: games.field,
      homeAway: games.homeAway,
    })
    .from(games)
    .where(and(eq(games.teamId, teamId), gte(games.gameDate, today)))
    .orderBy(games.gameDate, games.gameTime)
    .limit(5);

  // Which quarters of the next game already have players on the field
  const nextGame = upcomingGames[0];
  let plannedQuarters: number[] = [];
  if (nextGame) {
    const rows = await db
      .selectDistinct({ quarter: assignments.quarter })
      .from(assignments)
      .where(and(eq(assignments.gameId, nextGame.id), eq(assignments.isSittingOut, false)));
    plannedQuarters = rows.map((r) => r.quarter).filter((q): q is number => q !== null);
  }

  const roster = await db
    .select({
      id: players.id,
      name: players.name,
      jerseyNumber: players.jerseyNumber,
      profilePicture: players.profilePicture,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);

  const [gameCount] = await db
    .select({ count: count() })
    .from(games)
    .where(eq(games.teamId, teamId));

  // The next two weeks of games and practices, with how many have answered
  const rosterIds = roster.map((p) => p.id);
  const [events, answers] = await Promise.all([
    getEvents([teamId], { from: today, to: addDays(today, 13) }),
    getRsvps([teamId]),
  ]);
  const schedule = events
    .filter((e) => !e.cancelled)
    .slice(0, 6)
    .map((e) => ({
      key: e.key,
      type: e.type,
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      endTime: e.endTime,
      location: e.location,
      counts: countRsvps(rosterIds, answers.filter((a) => a.eventType === e.type && a.eventId === e.id)),
    }));

  // What's waiting on the coach
  const [conversations, unmatched, families, announcements] = await Promise.all([
    listCoachConversations(teamId, user.id),
    countUnmatched(user, teamId),
    listFamilies(null, teamId),
    listAnnouncements(teamId),
  ]);
  const needsReply = conversations
    .filter((c) => c.needsReply)
    .map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, preview: c.lastMessagePreview, at: c.lastMessageAt }));

  // Announcements from the last two weeks that asked for something and
  // haven't heard back from everyone, counted the way the tracker does
  const recentAsks = announcements.filter(
    (a) => a.ask !== "none" && a.createdAt.slice(0, 10) >= addDays(today, -14)
  );
  const waiting = (
    await Promise.all(
      recentAsks.map(async (a) => {
        const tracker = await getAnnouncementTracker(a.id, teamId, user.id);
        return tracker && tracker.stats.awaiting > 0
          ? { id: a.id, subject: a.subject, ask: a.ask, awaiting: tracker.stats.awaiting, total: tracker.stats.total }
          : null;
      })
    )
  ).filter((a) => a !== null);

  const withEmail = new Set(families.flatMap((f) => f.kids.map((k) => k.id)));
  const todo = {
    needsReply,
    waiting,
    unmatched,
    notJoined: families.filter((f) => f.status !== "joined").length,
    familyCount: families.length,
    missingEmail: roster.filter((p) => !withEmail.has(p.id)).length,
  };

  return data({
    team,
    today,
    upcomingGames,
    plannedQuarters,
    roster,
    totalGames: gameCount?.count || 0,
    schedule,
    todo,
  });
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: `${data?.team.name ?? "Team"} - BenchTalk` },
    { name: "description", content: "Team management dashboard" },
  ];
}

export default function TeamOverview({ loaderData }: Route.ComponentProps) {
  const { team, today, upcomingGames, plannedQuarters, roster, totalGames, schedule, todo } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const [nextGame, ...laterGames] = upcomingGames;
  const plannedCount = plannedQuarters.length;
  const isGameDay = nextGame ? relativeGameDay(nextGame.gameDate, today) === "Today" : false;
  const nextGameRsvps = nextGame ? schedule.find((e) => e.key === `game-${nextGame.id}`) : undefined;
  // The hero already covers the next game
  const comingUp = schedule.filter((e) => e !== nextGameRsvps);

  return (
    <Page className="space-y-6">
      {/* Next game */}
      {nextGame ? (
        <Card className="relative overflow-hidden">
          <PitchArt className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[42%] [mask-image:linear-gradient(to_right,transparent,black_40%)] md:block" />
          <div className="relative p-5 sm:p-7 md:max-w-[58%]">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-primary">Next game</span>
              <span className="text-line-strong">/</span>
              <span className="font-medium text-ink">{relativeGameDay(nextGame.gameDate, today)}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">vs {nextGame.opponent}</h1>
              <HomeAwayBadge homeAway={nextGame.homeAway} />
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <CalendarBlank size={16} />
                {formatGameDate(nextGame.gameDate)}
              </span>
              {nextGame.gameTime && (
                <span className="flex items-center gap-1.5">
                  <Clock size={16} />
                  {formatGameTime(nextGame.gameTime)}
                </span>
              )}
              {nextGame.field && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={16} />
                  {nextGame.field}
                </span>
              )}
            </div>

            {/* Lineup progress, one segment per quarter */}
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="font-medium">Lineup</span>
                <span className="text-muted tabular">
                  {plannedCount === 4 ? "Ready" : plannedCount === 0 ? "Not started" : `${plannedCount} of 4 quarters`}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((q) => {
                  const done = plannedQuarters.includes(q);
                  return (
                    <div key={q}>
                      <div className={`h-1.5 rounded-full ${done ? "bg-success" : "bg-surface-2 ring-1 ring-inset ring-line"}`} />
                      <div className={`mt-1 text-xs font-medium tabular ${done ? "text-success" : "text-subtle"}`}>Q{q}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {nextGameRsvps && (
              <Link
                to={`${base}/rsvps/game/${nextGame.id}`}
                className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:underline"
              >
                <span className="font-medium">RSVPs</span>
                <RsvpSummary counts={nextGameRsvps.counts} />
              </Link>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              {/* On the day, the sideline view leads; before that, planning does */}
              {isGameDay && plannedCount > 0 && (
                <Link to={`${base}/games/${nextGame.id}/game-day`} className={buttonClass({ size: "lg" })}>
                  <Play size={20} weight="fill" />
                  Game day
                </Link>
              )}
              <Link
                to={`${base}/games/${nextGame.id}/lineup`}
                className={buttonClass({ variant: isGameDay && plannedCount > 0 ? "secondary" : "primary", size: "lg" })}
              >
                <SoccerBall size={20} weight="bold" />
                {plannedCount === 0 ? "Plan lineup" : "Open lineup"}
              </Link>
              {!isGameDay && plannedCount > 0 && (
                <Link to={`${base}/games/${nextGame.id}/game-day`} className={buttonClass({ variant: "secondary", size: "lg" })}>
                  <Play size={20} weight="fill" className="text-primary" />
                  Game day
                </Link>
              )}
              <a
                href={`${base}/games/${nextGame.id}/game-card`}
                target="_blank"
                rel="noopener"
                className={buttonClass({ variant: "ghost", size: "lg" })}
              >
                <Printer size={20} />
                Game card
              </a>
              <Link to={`${base}/games/${nextGame.id}/edit`} className={buttonClass({ variant: "ghost", size: "lg" })}>
                <PencilSimple size={20} />
                Edit
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<CalendarPlus size={24} />}
            title="No upcoming games"
            action={
              <Link to={`${base}/games/new`} className={buttonClass({ size: "lg" })}>
                <Plus size={18} weight="bold" />
                Schedule game
              </Link>
            }
          >
            {totalGames > 0 ? "Every scheduled game is in the past." : "Schedule a game to start planning lineups."}
          </EmptyState>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <NeedsYou base={base} todo={todo} className="lg:col-span-2" />

        {/* Games and practices with who's coming */}
        <Card className="p-5 sm:p-6 lg:col-span-3">
          <CardHeader
            title="Next two weeks"
            actions={
              <>
                <Link to={`${base}/games/new`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <Plus size={16} weight="bold" />
                  Schedule
                </Link>
                {totalGames > 0 && (
                  <Link to={`${base}/games`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    Full schedule
                  </Link>
                )}
              </>
            }
          />
          {comingUp.length > 0 ? (
            <ul className="mt-3 -mx-2">
              {comingUp.map((e) => (
                <li key={e.key}>
                  <Link
                    to={`${base}/rsvps/${e.type}/${e.id}`}
                    className="group flex items-center gap-4 rounded-xl px-2 py-2.5 transition hover:bg-surface-2"
                  >
                    <DateTile iso={e.date} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{e.title}</div>
                      <div className="truncate text-sm text-muted">
                        {[formatTimeRange(e.time, e.endTime) || formatGameTime(e.time), e.location].filter(Boolean).join(" · ") || "Time TBD"}
                      </div>
                    </div>
                    <RsvpSummary counts={e.counts} compact className="hidden sm:flex" />
                    <CaretRight size={16} className="text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{nextGame ? "Nothing else in the next two weeks." : "Nothing scheduled in the next two weeks."}</p>
          )}
        </Card>
      </div>

        {/* Roster */}
        <Card className="p-5 sm:p-6">
          <CardHeader
            title="Roster"
            count={roster.length}
            actions={
              <>
                <Link to={`${base}/roster/new-player`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <Plus size={16} weight="bold" />
                  Add player
                </Link>
                {roster.length > 0 && (
                  <Link to={`${base}/roster`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    Manage
                  </Link>
                )}
              </>
            }
          />
          {roster.length > 0 ? (
            <div className="mt-3 -mx-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {roster.map((player) => (
                <Link
                  key={player.id}
                  to={`${base}/roster/player/${player.id}/edit`}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition hover:bg-surface-2"
                >
                  <PlayerAvatar player={player} size="sm" />
                  <span className="truncate font-medium">{player.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              className="py-8"
              icon={<UsersThree size={24} />}
              title="No players yet"
              action={
                <Link to={`${base}/roster`} className={buttonClass({ variant: "secondary" })}>
                  Add or import players
                </Link>
              }
            >
              Add them one at a time, or import a roster from a photo or file.
            </EmptyState>
          )}
        </Card>
    </Page>
  );
}

// Half-pitch line drawing that fades into the card
function PitchArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 300" preserveAspectRatio="xMaxYMid slice" aria-hidden>
      <rect width="400" height="300" fill="var(--color-pitch)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 80} width="40" height="300" fill="var(--color-pitch-dark)" />
      ))}
      <g fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="3">
        <line x1="80" y1="0" x2="80" y2="300" />
        <circle cx="80" cy="150" r="58" />
        <rect x="290" y="70" width="110" height="160" />
        <rect x="350" y="110" width="50" height="80" />
        <path d="M290 112 A 40 40 0 0 0 290 188" />
      </g>
      <circle cx="80" cy="150" r="4" fill="white" fillOpacity="0.55" />
    </svg>
  );
}

// "9 going · 1 maybe · 2 can't · 3 no answer", or chips when compact
function RsvpSummary({ counts, compact = false, className }: { counts: RsvpCounts; compact?: boolean; className?: string }) {
  const parts = [
    { n: counts.yes, label: "going", tone: "text-success" },
    { n: counts.maybe, label: "maybe", tone: "text-warning" },
    { n: counts.no, label: "can't", tone: "text-danger" },
    { n: counts.none, label: "no answer", tone: "text-subtle" },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <span className={cx("flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm tabular", compact && "shrink-0 text-xs", className)}>
      {parts.map((p) => (
        <span key={p.label} className="whitespace-nowrap">
          <strong className={p.tone}>{p.n}</strong> <span className="text-muted">{p.label}</span>
        </span>
      ))}
    </span>
  );
}

type Todo = Route.ComponentProps["loaderData"]["todo"];

// Everything waiting on the coach, each linking to where it gets done
function NeedsYou({ base, todo, className }: { base: string; todo: Todo; className?: string }) {
  const items: { key: string; icon: React.ReactNode; title: React.ReactNode; detail?: string; to: string }[] = [
    ...todo.needsReply.slice(0, 4).map((c) => ({
      key: `reply-${c.id}`,
      icon: <ChatCircleDots size={18} weight="fill" className="text-warning" />,
      title: <>Reply to {c.title}</>,
      detail: c.preview ?? c.subtitle,
      to: `${base}/messages/${c.id}`,
    })),
    ...(todo.needsReply.length > 4
      ? [{
          key: "reply-more",
          icon: <ChatCircleDots size={18} className="text-warning" />,
          title: <>{todo.needsReply.length - 4} more waiting on a reply</>,
          to: `${base}/messages?filter=needs-reply`,
        }]
      : []),
    ...todo.waiting.map((a) => ({
      key: `ann-${a.id}`,
      icon: <Megaphone size={18} weight="fill" className="text-primary" />,
      title: <>{a.subject}</>,
      detail: `${a.awaiting} of ${a.total} ${a.total === 1 ? "family hasn't" : "families haven't"} ${a.ask === "ack" ? "said Got it" : "replied"}`,
      to: `${base}/announcements/${a.id}`,
    })),
    ...(todo.unmatched > 0
      ? [{
          key: "unmatched",
          icon: <EnvelopeSimple size={18} weight="fill" className="text-warning" />,
          title: <>{todo.unmatched} {todo.unmatched === 1 ? "email" : "emails"} to sort</>,
          detail: "Came in by email from an address we don't know",
          to: `${base}/messages`,
        }]
      : []),
    ...(todo.notJoined > 0
      ? [{
          key: "invite",
          icon: <UserPlus size={18} weight="bold" className="text-primary" />,
          title: <>{todo.notJoined} of {todo.familyCount} families aren't on the app</>,
          detail: "They get messages by email but can't RSVP",
          to: `${base}/families`,
        }]
      : []),
    ...(todo.missingEmail > 0
      ? [{
          key: "missing",
          icon: <AddressBook size={18} className="text-muted" />,
          title: <>{todo.missingEmail} {todo.missingEmail === 1 ? "player has" : "players have"} no family email</>,
          detail: "Add one so their family gets messages",
          to: `${base}/families`,
        }]
      : []),
  ];

  return (
    <Card className={cx("p-5 sm:p-6", className)}>
      <CardHeader title="Needs you" count={items.length || undefined} />
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <CheckCircle size={18} weight="fill" className="text-success" />
          You're all caught up.
        </p>
      ) : (
        <ul className="mt-3 -mx-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface-2">
                <span className="mt-0.5 shrink-0">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  {item.detail && <span className="block truncate text-sm text-muted">{item.detail}</span>}
                </span>
                <CaretRight size={16} className="mt-1 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
