import type { Route } from "./+types/team._index";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games, players, assignments } from "~/db";
import { eq, and, gte, count } from "drizzle-orm";
import { getImageUrl } from "~/utils/image";
import { formatGameDate, formatGameDateTime, formatGameTime, relativeGameDay, todayISO } from "~/utils/dates";

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

  return (
    <div className="py-6">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px] space-y-6">
        {/* Next game */}
        {nextGame ? (
          <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold uppercase tracking-wide text-[var(--primary)]">Next game</span>
                <span className="text-[var(--muted)]">•</span>
                <span className="font-medium">{relativeGameDay(nextGame.gameDate, today)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-bold">vs {nextGame.opponent}</h1>
                {nextGame.homeAway && (
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold capitalize ${
                    nextGame.homeAway === 'home'
                      ? 'border border-green-200 bg-green-50 text-green-700'
                      : 'border border-blue-200 bg-blue-50 text-blue-700'
                  }`}>
                    {nextGame.homeAway}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[var(--muted)]">
                {formatGameDateTime(nextGame.gameDate, nextGame.gameTime)}
                {nextGame.field && ` • Field ${nextGame.field}`}
              </div>

              {/* Lineup progress */}
              <div className="mt-4 flex items-center gap-3">
                <div className="flex gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((q) => (
                    <span
                      key={q}
                      className={`h-2 w-8 rounded-full ${plannedQuarters.includes(q) ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`}
                    />
                  ))}
                </div>
                <span className="text-sm text-[var(--muted)]">
                  {plannedQuarters.length === 4
                    ? 'Lineup planned for all 4 quarters'
                    : plannedQuarters.length === 0
                      ? 'Lineup not started'
                      : `Lineup planned for ${plannedQuarters.length} of 4 quarters`}
                </span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  to={`${base}/games/${nextGame.id}/lineup`}
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                >
                  {plannedQuarters.length === 0 ? 'Plan lineup' : 'Open lineup'}
                </Link>
                <a
                  href={`${base}/games/${nextGame.id}/game-card`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                >
                  Game card
                </a>
                <Link
                  to={`${base}/games/${nextGame.id}/edit`}
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                >
                  Edit game
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-8 text-center">
            <h1 className="text-xl font-semibold">No upcoming games</h1>
            <p className="mt-2 text-[var(--muted)]">
              {totalGames > 0 ? 'Every scheduled game is in the past.' : 'Schedule a game to start planning lineups.'}
            </p>
            <Link
              to={`${base}/games/new`}
              className="mt-5 inline-flex items-center justify-center px-5 py-2.5 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
            >
              Schedule game
            </Link>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Later games */}
          <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Coming up</h2>
              <div className="flex items-center gap-4 text-sm font-medium">
                <Link to={`${base}/games/new`} className="text-[var(--primary)] hover:underline">
                  Schedule game
                </Link>
                {totalGames > 0 && (
                  <Link to={`${base}/games`} className="text-[var(--primary)] hover:underline">
                    All games
                  </Link>
                )}
              </div>
            </div>
            {laterGames.length > 0 ? (
              <ul className="divide-y divide-[var(--border)]">
                {laterGames.map((game) => (
                  <li key={game.id}>
                    <Link
                      to={`${base}/games/${game.id}/lineup`}
                      className="flex items-center justify-between gap-4 py-3 group"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate group-hover:text-[var(--primary)]">vs {game.opponent}</div>
                        <div className="text-sm text-[var(--muted)]">
                          {formatGameDate(game.gameDate)}
                          {game.gameTime && ` • ${formatGameTime(game.gameTime)}`}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm text-[var(--muted)] group-hover:text-[var(--primary)]">
                        Lineup →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                {nextGame ? 'Nothing else on the schedule yet.' : 'No games scheduled.'}
              </p>
            )}
          </section>

          {/* Roster */}
          <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                Roster <span className="text-[var(--muted)] font-normal">({roster.length})</span>
              </h2>
              <div className="flex items-center gap-4 text-sm font-medium">
                <Link to={`${base}/roster/new-player`} className="text-[var(--primary)] hover:underline">
                  Add player
                </Link>
                {roster.length > 0 && (
                  <Link to={`${base}/roster`} className="text-[var(--primary)] hover:underline">
                    Manage
                  </Link>
                )}
              </div>
            </div>
            {roster.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {roster.map((player) => (
                  <Link
                    key={player.id}
                    to={`${base}/roster/player/${player.id}/edit`}
                    className="flex items-center gap-2 p-2 rounded text-sm hover:bg-[var(--bg)] transition"
                  >
                    {getImageUrl(player.profilePicture) ? (
                      <img
                        src={getImageUrl(player.profilePicture)!}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center text-xs font-semibold text-[var(--muted)]">
                        {player.jerseyNumber ?? player.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="truncate">{player.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">No players yet. Add them one at a time or import a roster.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
