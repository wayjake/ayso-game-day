import type { Route } from "./+types/team._index";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games, players, assignments } from "~/db";
import { eq, and, gte, count } from "drizzle-orm";
import { formatGameDate, formatGameTime, relativeGameDay, todayISO } from "~/utils/dates";
import { Card, CardHeader, DateTile, EmptyState, HomeAwayBadge, Page, PlayerAvatar, buttonClass } from "~/components/ui";
import {
  CalendarBlank,
  CalendarPlus,
  CaretRight,
  Clock,
  MapPin,
  PencilSimple,
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

  return data({
    team,
    today,
    upcomingGames,
    plannedQuarters,
    roster,
    totalGames: gameCount?.count || 0,
  });
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: `${data?.team.name ?? "Team"} - AYSO Game Day` },
    { name: "description", content: "Team management dashboard" },
  ];
}

export default function TeamOverview({ loaderData }: Route.ComponentProps) {
  const { team, today, upcomingGames, plannedQuarters, roster, totalGames } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const [nextGame, ...laterGames] = upcomingGames;
  const plannedCount = plannedQuarters.length;

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

            <div className="mt-6 flex flex-wrap gap-2">
              <Link to={`${base}/games/${nextGame.id}/lineup`} className={buttonClass({ size: "lg" })}>
                <SoccerBall size={20} weight="bold" />
                {plannedCount === 0 ? "Plan lineup" : "Open lineup"}
              </Link>
              <a
                href={`${base}/games/${nextGame.id}/game-card`}
                target="_blank"
                rel="noopener"
                className={buttonClass({ variant: "secondary", size: "lg" })}
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
        {/* Later games */}
        <Card className="p-5 sm:p-6 lg:col-span-2">
          <CardHeader
            title="Coming up"
            actions={
              <>
                <Link to={`${base}/games/new`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <Plus size={16} weight="bold" />
                  Schedule
                </Link>
                {totalGames > 0 && (
                  <Link to={`${base}/games`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    All games
                  </Link>
                )}
              </>
            }
          />
          {laterGames.length > 0 ? (
            <ul className="mt-3 -mx-2">
              {laterGames.map((game) => (
                <li key={game.id}>
                  <Link
                    to={`${base}/games/${game.id}/lineup`}
                    className="group flex items-center gap-4 rounded-xl px-2 py-2.5 transition hover:bg-surface-2"
                  >
                    <DateTile iso={game.gameDate} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">vs {game.opponent}</div>
                      <div className="text-sm text-muted">
                        {[formatGameTime(game.gameTime), game.field].filter(Boolean).join(" · ") || "Time TBD"}
                      </div>
                    </div>
                    <CaretRight size={16} className="text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{nextGame ? "Nothing else on the schedule yet." : "No games scheduled."}</p>
          )}
        </Card>

        {/* Roster */}
        <Card className="p-5 sm:p-6 lg:col-span-3">
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
            <div className="mt-3 -mx-2 grid grid-cols-2 sm:grid-cols-3">
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
      </div>
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
