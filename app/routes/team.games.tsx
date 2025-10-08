import type { Route } from "./+types/team.games";
import { Link } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games } from "~/db";
import { eq, and } from "drizzle-orm";

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
  
  return data({
    team,
    games: teamGames,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Games - AYSO Game Day" },
    { name: "description", content: "Manage your team's game schedule" },
  ];
}

export default function TeamGames({ loaderData }: Route.ComponentProps) {
  const { team, games } = loaderData;
  
  // Separate upcoming and past games
  const today = new Date().toISOString().split('T')[0];
  const upcomingGames = games.filter((game: any) => game.gameDate >= today);
  const pastGames = games.filter((game: any) => game.gameDate < today);
  
  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{team.name} Games</h1>
            <p className="mt-2 text-[var(--muted)]">
              Manage your {team.format} team's game schedule
            </p>
          </div>
          <Link
            to={`/dashboard/team/${team.id}/games/new`}
            className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
          >
            Schedule Game
          </Link>
        </div>
        
        {/* Upcoming games */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Upcoming Games</h2>
          {upcomingGames.length > 0 ? (
            <div className="space-y-4">
              {upcomingGames.map((game: any) => (
                <div key={game.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">vs {game.opponent}</h3>
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                          game.homeAway === 'home' 
                            ? 'border border-green-200 bg-green-50 text-green-700' 
                            : 'border border-blue-200 bg-blue-50 text-blue-700'
                        }`}>
                          {game.homeAway}
                        </span>
                      </div>
                      <div className="text-[var(--muted)] space-y-1">
                        <div>📅 {new Date(game.gameDate).toLocaleDateString()}</div>
                        {game.gameTime && <div>🕐 {game.gameTime}</div>}
                        {game.field && <div>📍 Field: {game.field}</div>}
                        {game.notes && <div className="mt-2 text-sm">📝 {game.notes}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/dashboard/team/${team.id}/games/${game.id}/lineup`}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition"
                      >
                        Plan Lineup
                      </Link>
                      <Link
                        to={`/dashboard/team/${team.id}/games/${game.id}/edit`}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                      >
                        Edit
                      </Link>
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
                  Schedule your first game to start planning lineups and rotations.
                </p>
                <Link
                  to={`/dashboard/team/${team.id}/games/new`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
                >
                  Schedule Your First Game
                </Link>
              </div>
            </div>
          )}
        </div>
        
        {/* Past games */}
        {pastGames.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Past Games</h2>
            <div className="space-y-4">
              {pastGames.map((game: any) => (
                <div key={game.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6 opacity-75">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">vs {game.opponent}</h3>
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                          game.homeAway === 'home' 
                            ? 'border border-green-200 bg-green-50 text-green-700' 
                            : 'border border-blue-200 bg-blue-50 text-blue-700'
                        }`}>
                          {game.homeAway}
                        </span>
                      </div>
                      <div className="text-[var(--muted)] space-y-1">
                        <div>📅 {new Date(game.gameDate).toLocaleDateString()}</div>
                        {game.gameTime && <div>🕐 {game.gameTime}</div>}
                        {game.field && <div>📍 Field: {game.field}</div>}
                        {game.notes && <div className="mt-2 text-sm">📝 {game.notes}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/dashboard/team/${team.id}/games/${game.id}/lineup`}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--muted)] hover:bg-[var(--bg)] transition"
                      >
                        View Lineup
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}