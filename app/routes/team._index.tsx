import type { Route } from "./+types/team._index";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games, players } from "~/db";
import { eq, and, gte } from "drizzle-orm";
import { getImageUrl } from "~/utils/image";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get upcoming games (next 3)
  const today = new Date().toISOString().split('T')[0];
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
    .where(and(
      eq(games.teamId, teamId),
      gte(games.gameDate, today)
    ))
    .orderBy(games.gameDate)
    .limit(3);
  
  // Get recent players (for quick roster preview)
  const recentPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      profilePicture: players.profilePicture,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .limit(8);
  
  return data({
    team,
    upcomingGames,
    recentPlayers,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Team Dashboard - AYSO Game Day" },
    { name: "description", content: "Team management dashboard" },
  ];
}

export default function TeamDashboard({ loaderData }: Route.ComponentProps) {
  const { team, upcomingGames, recentPlayers } = loaderData;

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Team header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold">{team.name}</h1>
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]">
              {team.format}
            </span>
            {team.ageGroup && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                {team.ageGroup}
              </span>
            )}
          </div>
          <p className="text-[var(--muted)]">
            Team dashboard for {team.season || 'current season'}
          </p>
        </div>

        {/* Team actions - moved to top */}
        <div className="mb-8 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">Team Actions</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Link
              to={`/dashboard/team/${team.id}/games/new`}
              className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition group"
            >
              <div className="text-xl">➕</div>
              <div>
                <div className="font-medium text-sm">Schedule Game</div>
                <div className="text-xs text-[var(--muted)]">Add a new game to the schedule</div>
              </div>
            </Link>

            <Link
              to={`/dashboard/team/${team.id}/roster`}
              className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition group"
            >
              <div className="text-xl">👥</div>
              <div>
                <div className="font-medium text-sm">Manage Roster</div>
                <div className="text-xs text-[var(--muted)]">Add and edit players</div>
              </div>
            </Link>

            <Link
              to={`/dashboard/team/${team.id}/contacts`}
              className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition group"
            >
              <div className="text-xl">📧</div>
              <div>
                <div className="font-medium text-sm">Manage Contacts</div>
                <div className="text-xs text-[var(--muted)]">Player family contact info</div>
              </div>
            </Link>

            <Link
              to={`/dashboard/team/${team.id}/rotations`}
              className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition group"
            >
              <div className="text-xl">🔄</div>
              <div>
                <div className="font-medium text-sm">Plan Rotations</div>
                <div className="text-xs text-[var(--muted)]">Create fair play rotations</div>
              </div>
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upcoming games */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Upcoming Games</h2>
              <Link
                to={`/dashboard/team/${team.id}/games`}
                className="text-[var(--primary)] hover:underline text-sm font-medium"
              >
                View All
              </Link>
            </div>
            {upcomingGames.length > 0 ? (
              <div className="space-y-3">
                {upcomingGames.map((game: any) => (
                  <div key={game.id} className="p-3 border border-[var(--border)] rounded">
                    <div className="font-medium">vs {game.opponent}</div>
                    <div className="text-sm text-[var(--muted)]">
                      {new Date(game.gameDate).toLocaleDateString()} {game.gameTime && `at ${game.gameTime}`}
                    </div>
                    {game.field && <div className="text-sm text-[var(--muted)]">Field: {game.field}</div>}
                    <div className="mt-2">
                      <Link
                        to={`/dashboard/team/${team.id}/games/${game.id}/lineup`}
                        className="text-[var(--primary)] hover:underline text-sm font-medium"
                      >
                        Plan Lineup
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-[var(--muted)] mb-4">No upcoming games scheduled.</p>
                <Link
                  to={`/dashboard/team/${team.id}/games/new`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                >
                  Schedule Game
                </Link>
              </div>
            )}
          </div>

          {/* Team roster preview */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Team Roster</h2>
              <Link
                to={`/dashboard/team/${team.id}/roster`}
                className="text-[var(--primary)] hover:underline text-sm font-medium"
              >
                Manage Roster
              </Link>
            </div>
            {recentPlayers.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {recentPlayers.map((player: any) => (
                  <div key={player.id} className="flex items-center gap-2 p-2 border border-[var(--border)] rounded text-sm">
                    {getImageUrl(player.profilePicture) ? (
                      <img
                        src={getImageUrl(player.profilePicture)!}
                        alt={player.name}
                        className="w-6 h-6 rounded-full object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[var(--bg)] flex items-center justify-center text-xs font-semibold text-[var(--muted)]">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="flex-1">{player.name}</span>
                  </div>
                ))}
                {recentPlayers.length === 8 && (
                  <div className="col-span-2 text-center pt-2">
                    <Link
                      to={`/dashboard/team/${team.id}/roster`}
                      className="text-[var(--primary)] hover:underline text-sm"
                    >
                      View all players →
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-[var(--muted)] mb-4">No players added yet.</p>
                <Link
                  to={`/dashboard/team/${team.id}/roster/new-player`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                >
                  Add Players
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}