import type { Route } from "./+types/dashboard._index";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games, players } from "~/db";
import { eq, count, and, gte } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const url = new URL(request.url);
  const selectedTeamId = url.searchParams.get("team");
  
  if (selectedTeamId) {
    // Team-specific view
    const teamId = parseInt(selectedTeamId);
    
    // Get team details
    const [selectedTeam] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
      .limit(1);
    
    if (!selectedTeam) {
      throw new Response("Team not found", { status: 404 });
    }
    
    // Get team stats
    const [playerCount] = await db
      .select({ count: count() })
      .from(players)
      .where(eq(players.teamId, teamId));
      
    const [gameCount] = await db
      .select({ count: count() })
      .from(games)
      .where(eq(games.teamId, teamId));
    
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
      })
      .from(players)
      .where(eq(players.teamId, teamId))
      .limit(8);
    
    return data({
      viewType: "team" as const,
      selectedTeam,
      stats: {
        players: playerCount?.count || 0,
        games: gameCount?.count || 0,
      },
      upcomingGames,
      recentPlayers,
    });
  } else {
    // All teams overview
    const [teamCount] = await db
      .select({ count: count() })
      .from(teams)
      .where(eq(teams.coachId, user.id));
      
    const [gameCount] = await db
      .select({ count: count() })
      .from(games)
      .innerJoin(teams, eq(games.teamId, teams.id))
      .where(eq(teams.coachId, user.id));
      
    const [playerCount] = await db
      .select({ count: count() })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(eq(teams.coachId, user.id));
    
    // Get upcoming games across all teams
    const today = new Date().toISOString().split('T')[0];
    const upcomingGames = await db
      .select({
        id: games.id,
        opponent: games.opponent,
        gameDate: games.gameDate,
        gameTime: games.gameTime,
        field: games.field,
        homeAway: games.homeAway,
        teamName: teams.name,
        teamId: teams.id,
      })
      .from(games)
      .innerJoin(teams, eq(games.teamId, teams.id))
      .where(and(
        eq(teams.coachId, user.id),
        gte(games.gameDate, today)
      ))
      .orderBy(games.gameDate)
      .limit(5);
    
    // Get recent teams (5 most recently created)
    const recentTeams = await db
      .select({
        id: teams.id,
        name: teams.name,
        format: teams.format,
        ageGroup: teams.ageGroup,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(eq(teams.coachId, user.id))
      .orderBy(teams.createdAt)
      .limit(5);
    
    return data({
      viewType: "overview" as const,
      stats: {
        teams: teamCount?.count || 0,
        games: gameCount?.count || 0,
        players: playerCount?.count || 0,
      },
      upcomingGames,
      recentTeams,
      user: {
        teamName: user.teamName,
        email: user.email,
      },
    });
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Dashboard - AYSO Game Day" },
    { name: "description", content: "Your AYSO coaching dashboard" },
  ];
}

export default function DashboardIndex({ loaderData }: Route.ComponentProps) {
  if (loaderData.viewType === "team") {
    return <TeamDashboard loaderData={loaderData} />;
  } else {
    return <OverviewDashboard loaderData={loaderData} />;
  }
}

function OverviewDashboard({ loaderData }: { loaderData: any }) {
  const { stats, user, upcomingGames, recentTeams } = loaderData;

  return (
    <div className="py-8">
      <div className="container mx-auto px-6 max-w-7xl">
        {/* Welcome header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Welcome back{user?.teamName ? `, ${user.teamName} coach` : ''}!
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            Here's an overview of all your teams and upcoming games.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm text-[var(--muted)]">Teams</p>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.teams}</p>
              </div>
              <div className="h-8 w-8 bg-[var(--primary)] rounded text-white flex items-center justify-center text-sm">
                ⚽
              </div>
            </div>
          </div>
          
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm text-[var(--muted)]">Players</p>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.players}</p>
              </div>
              <div className="h-8 w-8 bg-[var(--success)] rounded text-white flex items-center justify-center text-sm">
                👥
              </div>
            </div>
          </div>
          
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm text-[var(--muted)]">Games</p>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.games}</p>
              </div>
              <div className="h-8 w-8 bg-[var(--warning)] rounded text-white flex items-center justify-center text-sm">
                📅
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upcoming games */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Upcoming Games</h2>
            {upcomingGames.length > 0 ? (
              <div className="space-y-3">
                {upcomingGames.map((game: any) => (
                  <div key={game.id} className="flex items-center justify-between p-3 border border-[var(--border)] rounded">
                    <div>
                      <div className="font-medium">{game.teamName} vs {game.opponent}</div>
                      <div className="text-sm text-[var(--muted)]">
                        {new Date(game.gameDate).toLocaleDateString()} {game.gameTime && `at ${game.gameTime}`}
                      </div>
                      {game.field && <div className="text-sm text-[var(--muted)]">Field: {game.field}</div>}
                    </div>
                    <Link
                      to={`/dashboard/team/${game.teamId}`}
                      className="text-[var(--primary)] hover:underline text-sm"
                    >
                      View Team
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--muted)]">No upcoming games scheduled.</p>
            )}
          </div>

          {/* Recent teams */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your Teams</h2>
              <Link
                to="/dashboard/teams/new"
                className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Add New
              </Link>
            </div>
            {recentTeams.length > 0 ? (
              <>
                <div className="space-y-3">
                  {recentTeams.map((team: any) => (
                    <Link
                      key={team.id}
                      to={`/dashboard/team/${team.id}`}
                      className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition group"
                    >
                      <div>
                        <div className="font-medium text-[var(--text)] group-hover:text-[var(--primary)]">{team.name}</div>
                        <div className="text-sm text-[var(--muted)]">
                          {team.format} {team.ageGroup && `• ${team.ageGroup}`}
                        </div>
                      </div>
                      <div className="text-[var(--muted)] group-hover:text-[var(--primary)] text-sm">
                        →
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="text-center mt-4 pt-3 border-t border-[var(--border)]">
                  <Link
                    to="/dashboard/teams"
                    className="text-[var(--primary)] hover:underline text-sm font-medium"
                  >
                    View All Teams
                  </Link>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-[var(--muted)] mb-4">No teams yet.</p>
                <Link
                  to="/dashboard/teams"
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                >
                  Create Your First Team
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamDashboard({ loaderData }: { loaderData: any }) {
  const { selectedTeam, stats, upcomingGames, recentPlayers } = loaderData;

  return (
    <div className="py-8">
      <div className="container mx-auto px-6 max-w-7xl">
        {/* Team header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold">{selectedTeam.name}</h1>
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]">
              {selectedTeam.format}
            </span>
            {selectedTeam.ageGroup && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                {selectedTeam.ageGroup}
              </span>
            )}
          </div>
          <p className="text-[var(--muted)]">
            Team dashboard for {selectedTeam.season || 'current season'}
          </p>
        </div>

        {/* Team stats */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm text-[var(--muted)]">Players</p>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.players}</p>
              </div>
              <div className="h-8 w-8 bg-[var(--success)] rounded text-white flex items-center justify-center text-sm">
                👥
              </div>
            </div>
          </div>
          
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm text-[var(--muted)]">Games</p>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.games}</p>
              </div>
              <div className="h-8 w-8 bg-[var(--warning)] rounded text-white flex items-center justify-center text-sm">
                📅
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upcoming games */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Upcoming Games</h2>
              <Link
                to={`/dashboard/team/${selectedTeam.id}/games`}
                className="text-[var(--primary)] hover:underline text-sm"
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
                        to={`/dashboard/team/${selectedTeam.id}/games/${game.id}/lineup`}
                        className="text-[var(--primary)] hover:underline text-sm"
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
                  to={`/dashboard/team/${selectedTeam.id}/games/new`}
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
                to={`/dashboard/team/${selectedTeam.id}/roster`}
                className="text-[var(--primary)] hover:underline text-sm"
              >
                Manage Roster
              </Link>
            </div>
            {recentPlayers.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {recentPlayers.map((player: any) => (
                  <div key={player.id} className="p-2 border border-[var(--border)] rounded text-sm">
                    {player.name}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-[var(--muted)] mb-4">No players added yet.</p>
                <Link
                  to={`/dashboard/team/${selectedTeam.id}/roster/new-player`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
                >
                  Add Players
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Team actions */}
        <div className="mt-8 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">Team Actions</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Link
              to={`/dashboard/team/${selectedTeam.id}/games/new`}
              className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition"
            >
              <div className="text-xl">➕</div>
              <div className="font-medium text-sm">Schedule Game</div>
            </Link>
            
            <Link
              to={`/dashboard/team/${selectedTeam.id}/roster`}
              className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition"
            >
              <div className="text-xl">👥</div>
              <div className="font-medium text-sm">Manage Roster</div>
            </Link>
            
            <Link
              to={`/dashboard/team/${selectedTeam.id}/rotations`}
              className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--bg)] transition"
            >
              <div className="text-xl">🔄</div>
              <div className="font-medium text-sm">Plan Rotations</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}