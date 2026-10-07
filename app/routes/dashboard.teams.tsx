import type { Route } from "./+types/dashboard.teams";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, games } from "~/db";
import { eq, count, desc, and, gte } from "drizzle-orm";
import { formatGameDateTime, todayISO } from "~/utils/dates";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  
  // Get teams for this coach, most recently created first
  const userTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      format: teams.format,
      ageGroup: teams.ageGroup,
      season: teams.season,
      region: teams.region,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(canAccessTeam(user.id))
    .orderBy(desc(teams.createdAt));
  
  // Player count and next game for each team
  const today = todayISO();
  const teamsWithPlayerCounts = await Promise.all(
    userTeams.map(async (team) => {
      const [playerCount] = await db
        .select({ count: count() })
        .from(players)
        .where(eq(players.teamId, team.id));

      const [nextGame] = await db
        .select({
          id: games.id,
          opponent: games.opponent,
          gameDate: games.gameDate,
          gameTime: games.gameTime,
        })
        .from(games)
        .where(and(eq(games.teamId, team.id), gte(games.gameDate, today)))
        .orderBy(games.gameDate, games.gameTime)
        .limit(1);

      return {
        ...team,
        playerCount: playerCount?.count || 0,
        nextGame: nextGame ?? null,
      };
    })
  );
  
  return data({
    teams: teamsWithPlayerCounts,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Teams - AYSO Game Day" },
    { name: "description", content: "Manage your AYSO teams" },
  ];
}

export default function TeamsPage({ loaderData }: Route.ComponentProps) {
  const { teams, user } = loaderData;

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Teams</h1>
            <p className="mt-2 text-[var(--muted)]">
              Pick a team to manage its games and roster
            </p>
          </div>
          <Link 
            to="/dashboard/teams/new"
            className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
          >
            Add New Team
          </Link>
        </div>

        {/* Teams grid */}
        {teams.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <div key={team.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text)] mb-1">
                        {team.name}
                      </h3>
                      <div className="flex gap-2">
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]">
                          {team.format}
                        </span>
                        {team.ageGroup && (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                            {team.ageGroup}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4 text-sm">
                      <span className="text-[var(--muted)]">Next game</span>
                      {team.nextGame ? (
                        <Link
                          to={`/dashboard/team/${team.id}/games/${team.nextGame.id}/lineup`}
                          className="text-right font-medium text-[var(--primary)] hover:underline"
                        >
                          vs {team.nextGame.opponent}
                          <span className="block text-xs font-normal text-[var(--muted)]">
                            {formatGameDateTime(team.nextGame.gameDate, team.nextGame.gameTime)}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-[var(--muted)]">None scheduled</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--muted)]">Players</span>
                      <span className="font-medium">{team.playerCount}</span>
                    </div>
                    
                    {team.season && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--muted)]">Season</span>
                        <span className="font-medium">{team.season}</span>
                      </div>
                    )}
                    
                    {team.region && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--muted)]">Region</span>
                        <span className="font-medium">{team.region}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex gap-2">
                    <Link
                      to={`/dashboard/team/${team.id}`}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 text-sm rounded font-medium border border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition"
                    >
                      Open team
                    </Link>
                    <Link
                      to={`/dashboard/team/${team.id}/games`}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                    >
                      Games
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Empty state */
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-12 text-center">
            <div className="max-w-sm mx-auto">
              <div className="mb-4">
                <div className="h-12 w-12 mx-auto bg-[var(--bg)] rounded-full flex items-center justify-center">
                  <span className="text-[var(--muted)] text-xl">⚽</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                No teams yet
              </h3>
              <p className="text-[var(--muted)] mb-6">
                Create your first team to start planning games and managing player rotations.
              </p>
              <Link
                to="/dashboard/teams/new"
                className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Create Your First Team
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}