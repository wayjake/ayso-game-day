import type { Route } from "./+types/team.games";
import { Link, data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, games } from "~/db";
import { eq, and } from "drizzle-orm";
import { formatGameDate, formatGameTime, relativeGameDay, todayISO } from "~/utils/dates";
import { gameNotesText } from "~/utils/game-notes";
import { Badge, Card, CardHeader, DateTile, EmptyState, HomeAwayBadge, Page, PageHeader, buttonClass } from "~/components/ui";
import {
  CalendarPlus,
  Clock,
  MapPin,
  Note,
  PencilSimple,
  Play,
  Plus,
  Printer,
  SoccerBall,
} from "@phosphor-icons/react";

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

type GameRow = Route.ComponentProps["loaderData"]["games"][number];

export default function TeamGames({ loaderData }: Route.ComponentProps) {
  const { team, games } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  // Separate upcoming and past games; most recent past game first
  const today = todayISO();
  const upcomingGames = games.filter((game) => game.gameDate >= today);
  const pastGames = games.filter((game) => game.gameDate < today).reverse();

  const scheduleLink = (label: string, variant: "primary" | "secondary" = "primary") => (
    <Link to={`${base}/games/new`} className={buttonClass({ variant })}>
      <Plus size={18} weight="bold" />
      {label}
    </Link>
  );

  return (
    <Page>
      <PageHeader
        title="Games"
        description={`Your ${team.format} schedule. Plan each game's lineup from here.`}
        actions={upcomingGames.length > 0 && scheduleLink("Schedule game", "secondary")}
      />

      {games.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarPlus size={24} />}
            title="No games yet"
            action={scheduleLink("Schedule your first game")}
          >
            Schedule a game to start planning lineups and rotations.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Upcoming games */}
          <section>
            <CardHeader title="Upcoming" count={upcomingGames.length} className="mb-3" />
            <Card>
              {upcomingGames.length > 0 ? (
                <ul className="divide-y divide-line">
                  {upcomingGames.map((game) => (
                    <UpcomingGameRow key={game.id} game={game} base={base} today={today} />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  className="py-10"
                  icon={<CalendarPlus size={24} />}
                  title="No upcoming games"
                  action={scheduleLink("Schedule game")}
                >
                  Every scheduled game is in the past.
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

function UpcomingGameRow({ game, base, today }: { game: GameRow; base: string; today: string }) {
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
