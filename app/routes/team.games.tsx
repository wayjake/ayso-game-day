import type { Route } from "./+types/team.games";
import { Link, data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, games, practices, players, rsvps } from "~/db";
import { eq, and, gte, asc } from "drizzle-orm";
import { formatGameDate, formatGameTime, formatTimeRange, relativeGameDay, todayISO } from "~/utils/dates";
import { countRsvps, type RsvpCounts } from "~/utils/schedule";
import { gameNotesText } from "~/utils/game-notes";
import { Badge, Card, CardHeader, DateTile, EmptyState, HomeAwayBadge, Page, PageHeader, buttonClass } from "~/components/ui";
import {
  ArrowsClockwise,
  CalendarPlus,
  Sneaker,
  UsersThree,
  Clock,
  MapPin,
  Note,
  PencilSimple,
  Coins,
  Play,
  Plus,
  Printer,
  SoccerBall,
} from "@phosphor-icons/react";

import { expensesByGame } from "~/utils/billing.server";
import { formatCents } from "~/utils/money";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get all games for this team
  const teamGames = await db
    .select({
      id: games.id,
      opponent: games.opponent,
      gameDate: games.gameDate,
      gameTime: games.gameTime,
      field: games.field,
      homeAway: games.homeAway,
      notes: games.notes,
    })
    .from(games)
    .where(eq(games.teamId, teamId))
    .orderBy(games.gameDate);
  
  // Only upcoming practices: past ones are noise on this page
  const today = todayISO();
  const teamPractices = await db
    .select()
    .from(practices)
    .where(and(eq(practices.teamId, teamId), gte(practices.practiceDate, today)))
    .orderBy(asc(practices.practiceDate), asc(practices.startTime));

  // Who's coming, per event
  const playerIds = (await db.select({ id: players.id }).from(players).where(eq(players.teamId, teamId))).map((p) => p.id);
  const answers = await db
    .select({ playerId: rsvps.playerId, eventType: rsvps.eventType, eventId: rsvps.eventId, status: rsvps.status })
    .from(rsvps)
    .where(eq(rsvps.teamId, teamId));
  const counts: Record<string, RsvpCounts> = {};
  const keys = [...teamGames.map((g) => `game-${g.id}`), ...teamPractices.map((p) => `practice-${p.id}`)];
  for (const key of keys) {
    counts[key] = countRsvps(playerIds, answers.filter((a) => `${a.eventType}-${a.eventId}` === key));
  }

  return data({
    team,
    games: teamGames,
    practices: teamPractices,
    counts,
    today,
    expenses: await expensesByGame(teamId),
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Schedule - BenchTalk" },
    { name: "description", content: "Games, practices and RSVPs for your team" },
  ];
}

type GameRow = Route.ComponentProps["loaderData"]["games"][number];
type PracticeRow = Route.ComponentProps["loaderData"]["practices"][number];

type UpcomingItem = { kind: "game"; date: string; time: string | null; game: GameRow } | { kind: "practice"; date: string; time: string | null; practice: PracticeRow };

export default function TeamGames({ loaderData }: Route.ComponentProps) {
  const { team, games, practices, counts, today, expenses } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  // Separate upcoming and past games; most recent past game first
  const upcomingGames = games.filter((game) => game.gameDate >= today);
  const pastGames = games.filter((game) => game.gameDate < today).reverse();

  // Games and practices together, in date order
  const upcoming: UpcomingItem[] = [
    ...upcomingGames.map((game) => ({ kind: "game" as const, date: game.gameDate, time: game.gameTime, game })),
    ...practices.map((practice) => ({ kind: "practice" as const, date: practice.practiceDate, time: practice.startTime, practice })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));

  const practiceLink = (
    <Link to={`${base}/practices/new`} className={buttonClass({ variant: "secondary" })}>
      <Sneaker size={18} weight="bold" />
      Add practice
    </Link>
  );

  const scheduleLink = (label: string, variant: "primary" | "secondary" = "primary") => (
    <Link to={`${base}/games/new`} className={buttonClass({ variant })}>
      <Plus size={18} weight="bold" />
      {label}
    </Link>
  );

  // Empty states: the game is the main action, a practice sits beside it
  const emptyActions = (gameLabel: string) => (
    <div className="flex flex-wrap justify-center gap-2">
      {scheduleLink(gameLabel)}
      {practiceLink}
    </div>
  );

  return (
    <Page>
      <PageHeader
        title="Schedule"
        description={
          <>
            Your {team.format} games and practices. Families RSVP to each one from their phones.{" "}
            <Link to="/dashboard/account#calendar" className="font-medium text-primary hover:underline">
              Add to your calendar
            </Link>
          </>
        }
        actions={
          <>
            {practiceLink}
            {scheduleLink("Schedule game", "secondary")}
          </>
        }
      />

      {games.length === 0 && practices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarPlus size={24} />}
            title="Nothing scheduled yet"
            action={emptyActions("Schedule your first game")}
          >
            Schedule a game to start planning lineups and rotations, or add your practices.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Upcoming games */}
          <section>
            <CardHeader title="Upcoming" count={upcoming.length} className="mb-3" />
            <Card>
              {upcoming.length > 0 ? (
                <ul className="divide-y divide-line">
                  {upcoming.map((item) =>
                    item.kind === "game" ? (
                      <UpcomingGameRow key={`g${item.game.id}`} game={item.game} base={base} today={today} counts={counts[`game-${item.game.id}`]} expenses={expenses[`game-${item.game.id}`]} />
                    ) : (
                      <UpcomingPracticeRow key={`p${item.practice.id}`} practice={item.practice} base={base} today={today} counts={counts[`practice-${item.practice.id}`]} />
                    )
                  )}
                </ul>
              ) : (
                <EmptyState
                  className="py-10"
                  icon={<CalendarPlus size={24} />}
                  title="Nothing coming up"
                  action={emptyActions("Schedule game")}
                >
                  Everything scheduled is in the past.
                </EmptyState>
              )}
            </Card>
          </section>

          {/* Past games */}
          {pastGames.length > 0 && (
            <section>
              <CardHeader title="Past" count={pastGames.length} className="mb-3" />
              <Card>
                <ul className="divide-y divide-line">
                  {pastGames.map((game) => (
                    <PastGameRow key={game.id} game={game} base={base} />
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

// "9 going · 2 out · 3 no reply", linking to the full list
function RsvpSummary({ counts, href }: { counts?: RsvpCounts; href: string }) {
  if (!counts) return null;
  return (
    <Link to={href} className="mt-1.5 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md text-sm hover:underline">
      <UsersThree size={16} className="text-subtle" />
      <span className="font-semibold text-success">{counts.yes} going</span>
      {counts.maybe > 0 && <span className="text-warning">· {counts.maybe} maybe</span>}
      {counts.no > 0 && <span className="text-danger">· {counts.no} out</span>}
      {counts.none > 0 && <span className="text-muted">· {counts.none} no reply</span>}
    </Link>
  );
}

function UpcomingPracticeRow({
  practice,
  base,
  today,
  counts,
}: {
  practice: PracticeRow;
  base: string;
  today: string;
  counts?: RsvpCounts;
}) {
  const soon = relativeGameDay(practice.practiceDate, today);
  const cancelled = practice.status === "cancelled";
  return (
    <li className="flex flex-col gap-3 p-4 sm:px-5 md:flex-row md:items-center md:gap-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <DateTile iso={practice.practiceDate} className={cancelled ? "opacity-60" : ""} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className={`flex items-center gap-1.5 font-display text-xl font-bold leading-tight tracking-tight ${cancelled ? "text-muted line-through" : ""}`}>
              <Sneaker size={18} weight="fill" className="text-pitch" />
              Practice
            </h3>
            {practice.seriesId && (
              <Badge>
                <ArrowsClockwise size={12} weight="bold" />
                Weekly
              </Badge>
            )}
            {cancelled && <Badge tone="danger">Cancelled</Badge>}
            {!cancelled && (soon === "Today" || soon === "Tomorrow") && <Badge tone="primary">{soon}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{formatGameDate(practice.practiceDate, { weekday: "long" })}</span>
            <span className="flex items-center gap-1.5">
              <Clock size={16} className="text-subtle" />
              {formatTimeRange(practice.startTime, practice.endTime) || "Time TBD"}
            </span>
            {practice.location && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin size={16} className="shrink-0 text-subtle" />
                <span className="break-words">{practice.location}</span>
              </span>
            )}
          </div>
          {practice.notes && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
              <Note size={16} className="mt-0.5 shrink-0 text-subtle" />
              <span className="line-clamp-2">{practice.notes}</span>
            </p>
          )}
          {!cancelled && <RsvpSummary counts={counts} href={`${base}/rsvps/practice/${practice.id}`} />}
        </div>
      </div>
      <div className="flex gap-2 sm:pl-16 md:shrink-0 md:pl-0">
        <Link to={`${base}/practices/${practice.id}/edit`} className={buttonClass({ variant: "ghost" })}>
          <PencilSimple size={18} />
          Edit
        </Link>
      </div>
    </li>
  );
}

function UpcomingGameRow({
  game,
  base,
  today,
  counts,
  expenses,
}: {
  game: GameRow;
  base: string;
  today: string;
  counts?: RsvpCounts;
  expenses?: { itemId: number; name: string; cents: number }[];
}) {
  const notes = gameNotesText(game.notes);
  const soon = relativeGameDay(game.gameDate, today);

  return (
    <li className="flex flex-col gap-3 p-4 sm:px-5 md:flex-row md:items-center md:gap-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <DateTile iso={game.gameDate} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words font-display text-xl font-bold leading-tight tracking-tight">
              vs {game.opponent}
            </h3>
            <HomeAwayBadge homeAway={game.homeAway} />
            {(soon === "Today" || soon === "Tomorrow") && <Badge tone="primary">{soon}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{formatGameDate(game.gameDate, { weekday: "long" })}</span>
            <span className="flex items-center gap-1.5">
              <Clock size={16} className="text-subtle" />
              {formatGameTime(game.gameTime) || "Time TBD"}
            </span>
            {game.field && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin size={16} className="shrink-0 text-subtle" />
                <span className="break-words">{game.field}</span>
              </span>
            )}
          </div>
          {notes && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
              <Note size={16} className="mt-0.5 shrink-0 text-subtle" />
              <span className="line-clamp-2">{notes}</span>
            </p>
          )}
          <RsvpSummary counts={counts} href={`${base}/rsvps/game/${game.id}`} />
          {expenses?.map((e) => (
            <Link key={e.itemId} to={`${base}/finances/items/${e.itemId}`} className="mt-1 flex items-center gap-1.5 text-sm text-muted hover:underline">
              <Coins size={16} className="text-subtle" />
              {e.name} · {formatCents(e.cents)}
            </Link>
          ))}
        </div>
      </div>

      {/* Lineup is the main job; the rest are secondary. On phones they sit under the game, lineup full width. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:pl-16 md:shrink-0 md:pl-0">
        {soon === "Today" && (
          <Link to={`${base}/games/${game.id}/game-day`} className={buttonClass({ className: "col-span-2" })}>
            <Play size={18} weight="fill" />
            Game day
          </Link>
        )}
        <Link
          to={`${base}/games/${game.id}/lineup`}
          className={buttonClass({ variant: soon === "Today" ? "secondary" : "primary", className: "col-span-2" })}
        >
          <SoccerBall size={18} weight="bold" />
          Plan lineup
        </Link>
        <a
          href={`${base}/games/${game.id}/game-card`}
          target="_blank"
          rel="noopener"
          className={buttonClass({ variant: "secondary" })}
        >
          <Printer size={18} />
          Game card
        </a>
        <Link
          to={`${base}/games/${game.id}/edit`}
          className={buttonClass({ variant: "ghost" })}
        >
          <PencilSimple size={18} />
          Edit
        </Link>
      </div>
    </li>
  );
}

// Past games are for looking back: quieter type, one action
function PastGameRow({ game, base }: { game: GameRow; base: string }) {
  const notes = gameNotesText(game.notes);
  return (
    <li className="flex items-center gap-4 px-4 py-3 sm:px-5">
      <DateTile iso={game.gameDate} className="opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 break-words font-semibold text-muted">vs {game.opponent}</h3>
          <HomeAwayBadge homeAway={game.homeAway} />
        </div>
        <div className="mt-0.5 text-sm text-subtle">
          {[
            formatGameDate(game.gameDate, { weekday: "short" }),
            formatGameDate(game.gameDate, { year: "numeric" }),
            formatGameTime(game.gameTime),
            game.field,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {notes && <p className="mt-0.5 line-clamp-1 text-sm text-subtle">{notes}</p>}
      </div>
      <Link
        to={`${base}/games/${game.id}/lineup`}
        className={buttonClass({ variant: "ghost", className: "shrink-0" })}
      >
        View lineup
      </Link>
    </li>
  );
}
