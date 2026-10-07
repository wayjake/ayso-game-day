import type { Route } from "./+types/dashboard.teams";
import { data, Link } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, games } from "~/db";
import { eq, count, desc, and, gte } from "drizzle-orm";
import { formatGameDate, formatGameTime, todayISO } from "~/utils/dates";
import { Badge, Card, DateTile, EmptyState, Page, PageHeader, buttonClass } from "~/components/ui";
import { CalendarBlank, CaretRight, Plus, SoccerBall, UsersThree } from "@phosphor-icons/react";

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
    { title: "Your teams - AYSO Game Day" },
    { name: "description", content: "Manage your AYSO teams" },
  ];
}

export default function TeamsPage({ loaderData }: Route.ComponentProps) {
  const { teams } = loaderData;

  return (
    <Page>
      <PageHeader
        title="Your teams"
        description="Pick a team to manage its games and roster."
        actions={
          teams.length > 0 && (
            <Link to="/dashboard/teams/new" className={buttonClass()}>
              <Plus size={18} weight="bold" />
              New team
            </Link>
          )
        }
      />

      {teams.length > 0 ? (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card
              key={team.id}
              className="group relative flex flex-col p-5 transition hover:shadow-raised hover:ring-line-strong"
            >
              {/* The team name link covers the whole card; inner links sit above it */}
              <h2 className="font-display text-2xl font-bold tracking-tight">
                <Link
                  to={`/dashboard/team/${team.id}`}
                  className="flex items-center justify-between gap-3 after:absolute after:inset-0 after:rounded-2xl"
                >
                  <span className="min-w-0 truncate">{team.name}</span>
                  <CaretRight
                    size={18}
                    weight="bold"
                    className="shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </Link>
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="primary">{team.format}</Badge>
                {team.ageGroup && <Badge>{team.ageGroup}</Badge>}
                {team.season && <span className="ml-1 text-sm text-muted">{team.season}</span>}
              </div>

              {/* Next game */}
              {team.nextGame ? (
                <Link
                  to={`/dashboard/team/${team.id}/games/${team.nextGame.id}/lineup`}
                  className="relative z-10 mt-5 flex items-center gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-canvas hover:ring-line-strong"
                >
                  <DateTile iso={team.nextGame.gameDate} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-primary">Next game</div>
                    <div className="truncate font-semibold">vs {team.nextGame.opponent}</div>
                    <div className="text-sm text-muted">
                      {[formatGameDate(team.nextGame.gameDate, { weekday: "short" }), formatGameTime(team.nextGame.gameTime)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <SoccerBall size={18} className="shrink-0 text-subtle" />
                </Link>
              ) : (
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-line-strong p-3 text-sm text-muted">
                  <CalendarBlank size={18} className="shrink-0 text-subtle" />
                  No upcoming games
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <UsersThree size={16} />
                    <span className="tabular">{team.playerCount}</span> {team.playerCount === 1 ? "player" : "players"}
                  </span>
                  {team.region && (
                    <span className="truncate">{/^\d+$/.test(team.region) ? `Region ${team.region}` : team.region}</span>
                  )}
                </div>
                <Link
                  to={`/dashboard/team/${team.id}/games`}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "relative z-10 -mr-2" })}
                >
                  Games
                </Link>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<SoccerBall size={24} />}
            title="No teams yet"
            action={
              <Link to="/dashboard/teams/new" className={buttonClass({ size: "lg" })}>
                <Plus size={18} weight="bold" />
                Create your first team
              </Link>
            }
          >
            Create a team to start planning games and fair-play rotations.
          </EmptyState>
        </Card>
      )}
    </Page>
  );
}
