import type { Route } from "./+types/team.rotations";
import { Link } from "react-router";
import { data } from "react-router";
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
  
  // Get upcoming games for rotation planning
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
    .limit(5);
  
  // Get team players for rotation planning
  const teamPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      preferredPositions: players.preferredPositions,
      profilePicture: players.profilePicture,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);
  
  return data({
    team,
    upcomingGames,
    players: teamPlayers,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Rotations - AYSO Game Day" },
    { name: "description", content: "Plan fair play rotations for your team" },
  ];
}

export default function TeamRotations({ loaderData }: Route.ComponentProps) {
  const { team, upcomingGames, players } = loaderData;
  
  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{team.name} Rotations</h1>
          <p className="mt-2 text-[var(--muted)]">
            Plan fair play rotations and lineups for your {team.format} team
          </p>
        </div>
        
        {/* Quick stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)]">Team Players</div>
            <div className="text-2xl font-bold">{players.length}</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)]">Upcoming Games</div>
            <div className="text-2xl font-bold">{upcomingGames.length}</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)]">Formation</div>
            <div className="text-2xl font-bold">{team.format}</div>
          </div>
        </div>
        
        {/* Upcoming games with rotation planning */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Plan Rotations</h2>
          {upcomingGames.length > 0 ? (
            <div className="space-y-4">
              {upcomingGames.map((game: any) => (
                <div key={game.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">vs {game.opponent}</h3>
                      <div className="text-sm text-[var(--muted)]">
                        {new Date(game.gameDate).toLocaleDateString()} 
                        {game.gameTime && ` at ${game.gameTime}`}
                        {game.field && ` • ${game.field}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/dashboard/team/${team.id}/games/${game.id}/lineup`}
                        className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition"
                      >
                        Plan Lineup
                      </Link>
                      <Link
                        to={`/dashboard/team/${team.id}/rotations/generator?game=${game.id}`}
                        className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                      >
                        Auto Generate
                      </Link>
                    </div>
                  </div>
                  
                  {/* Quick rotation preview */}
                  <div className="bg-[var(--bg)] rounded p-4">
                    <div className="text-sm text-[var(--muted)] mb-2">
                      AYSO Fair Play: Each player should get equal playing time and experience different positions
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      💡 Use the rotation generator to automatically create fair lineups based on AYSO guidelines
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-8 text-center">
              <div className="max-w-sm mx-auto">
                <div className="mb-4">
                  <div className="h-12 w-12 mx-auto bg-[var(--bg)] rounded-full flex items-center justify-center">
                    <span className="text-[var(--muted)] text-xl">📅</span>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                  No upcoming games
                </h3>
                <p className="text-[var(--muted)] mb-6">
                  Schedule games first to start planning rotations and lineups.
                </p>
                <Link
                  to={`/dashboard/team/${team.id}/games/new`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
                >
                  Schedule Games
                </Link>
              </div>
            </div>
          )}
        </div>
        
        {/* Team roster for rotation planning */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Team Roster</h2>
          {players.length > 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {players.map((player: any) => (
                  <div key={player.id} className="flex items-center gap-3 p-3 border border-[var(--border)] rounded">
                    {getImageUrl(player.profilePicture) ? (
                      <img
                        src={getImageUrl(player.profilePicture)!}
                        alt={player.name}
                        className="w-8 h-8 rounded-full object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--bg)] flex items-center justify-center text-sm font-semibold text-[var(--muted)]">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-medium text-sm">{player.name}</div>
                      {player.preferredPositions && (
                        <div className="text-xs text-[var(--muted)]">
                          Prefers: {JSON.parse(player.preferredPositions).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 pt-4 border-t border-[var(--border)]">
                <Link
                  to={`/dashboard/team/${team.id}/roster`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                >
                  Manage Roster
                </Link>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-8 text-center">
              <div className="max-w-sm mx-auto">
                <div className="mb-4">
                  <div className="h-12 w-12 mx-auto bg-[var(--bg)] rounded-full flex items-center justify-center">
                    <span className="text-[var(--muted)] text-xl">👥</span>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                  No players yet
                </h3>
                <p className="text-[var(--muted)] mb-6">
                  Add players to your roster to start planning rotations.
                </p>
                <Link
                  to={`/dashboard/team/${team.id}/roster/new-player`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
                >
                  Add Players
                </Link>
              </div>
            </div>
          )}
        </div>
        
        {/* AYSO Fair Play Guidelines */}
        <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-lg font-medium text-blue-800 mb-3">AYSO Fair Play Guidelines</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-medium text-blue-800 mb-2">Playing Time</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Every player plays at least half the game</li>
                <li>• Playing time should be as equal as possible</li>
                <li>• Rotate players in and out regularly</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-blue-800 mb-2">Position Rotation</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Players should experience different positions</li>
                <li>• No player sits out two consecutive periods</li>
                <li>• Consider player preferences but ensure variety</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}