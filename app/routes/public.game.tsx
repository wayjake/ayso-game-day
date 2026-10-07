import type { Route } from "./+types/public.game";
import { data, Link } from "react-router";
import { db, teams, games, shareLinks } from "~/db";
import { eq, and, sql } from "drizzle-orm";
import { useMemo, useState } from "react";
import { formatGameDateTime } from "~/utils/dates";
import { parseGameNotes } from "~/utils/game-notes";
import { getLineupRows } from "~/utils/lineup.server";
import { buildQuarterPlans, changesBetween, type Format } from "~/utils/lineup";
import { getChangeDescription, getPlayerChange } from "~/utils/position-changes";
import { AppMark } from "~/components/AppMark";
import { LineupField, QuarterBar, QuarterTabs, type SlotHighlight } from "~/components/LineupField";
import { Badge, Card, CardHeader, Page, PlayerAvatar, buttonClass } from "~/components/ui";
import { CalendarBlank, Eye, FirstAid, SoccerBall, UserMinus } from "@phosphor-icons/react";

export async function loader({ params }: Route.LoaderArgs) {
  const shareId = params.id;

  // Find the share link and verify it's not expired
  const [shareLink] = await db
    .select()
    .from(shareLinks)
    .where(and(
      eq(shareLinks.shareId, shareId),
      sql`datetime(${shareLinks.expiresAt}) > datetime('now')`
    ))
    .limit(1);

  if (!shareLink) {
    throw new Response("Share link not found or expired", { status: 404 });
  }

  const teamId = shareLink.teamId;
  const gameId = shareLink.gameId;

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }

  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  if (!game) {
    throw new Response("Game not found", { status: 404 });
  }

  const rows = await getLineupRows(teamId, gameId);

  return data({
    team: { name: team.name, format: team.format },
    game: { opponent: game.opponent, gameDate: game.gameDate, gameTime: game.gameTime },
    quarterFormations: parseGameNotes(game.notes).quarterFormations ?? {},
    ...rows,
  });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData?.team?.name || 'Team'} Lineup - vs ${loaderData?.game?.opponent || 'Game'} - AYSO Game Day` },
    { name: "description", content: "View team lineup and rotations" },
  ];
}

export default function PublicGameView({ loaderData }: Route.ComponentProps) {
  const { team, game, players, assignments, absences, quarterFormations } = loaderData;
  const [currentQuarter, setCurrentQuarter] = useState<number>(1);
  const [showChangeIndicators, setShowChangeIndicators] = useState(true);

  const plans = useMemo(
    () => buildQuarterPlans({ format: team.format as Format, players, assignments, absences, quarterFormations }),
    [team.format, players, assignments, absences, quarterFormations]
  );

  const current = plans[currentQuarter - 1];
  const previous = currentQuarter > 1 ? plans[currentQuarter - 2] : null;
  const positionChanges = previous ? changesBetween(previous, current) : [];

  // Rings on the field for players who are new or moved since last quarter
  const highlights = new Map<number, SlotHighlight>();
  if (showChangeIndicators) {
    for (const change of positionChanges) {
      if (change.changeType === "new_in") highlights.set(change.playerId, "in");
      if (change.changeType === "new_position" || change.changeType === "position_swap") highlights.set(change.playerId, "moved");
    }
  }

  const sittingOutPlayers = players.filter((player) => current.sittingOut.has(player.id));
  const unavailablePlayers = players.filter((player) => current.unavailable.has(player.id));

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Slim header */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="AYSO Game Day home">
            <AppMark />
          </Link>
          <Badge>
            <Eye size={14} weight="bold" />
            View only
          </Badge>
        </div>
      </header>

      <Page>
        {/* Game header */}
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-primary">{team.name}</span>
            <Badge tone="primary">{team.format}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">vs {game.opponent}</h1>

            {currentQuarter > 1 && (
              <button
                type="button"
                onClick={() => setShowChangeIndicators(!showChangeIndicators)}
                aria-pressed={showChangeIndicators}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                <span className="h-2 w-2 rounded-full bg-warning" />
                {showChangeIndicators ? "Hide changes" : "Show changes"}
              </button>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
            <CalendarBlank size={16} />
            {formatGameDateTime(game.gameDate, game.gameTime)}
          </p>
        </header>

        <QuarterTabs current={currentQuarter} onChange={setCurrentQuarter} className="mb-6" />

        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3">
          {/* Bench and absences */}
          <div className="order-2 space-y-6 lg:order-1 lg:col-span-1">
            <Card className="p-5">
              <CardHeader title={`Sitting out · Q${currentQuarter}`} count={sittingOutPlayers.length} />
              {sittingOutPlayers.length > 0 ? (
                <ul className="mt-3 divide-y divide-line">
                  {sittingOutPlayers.map((player) => {
                    const playerChange = showChangeIndicators ? getPlayerChange(player.id, positionChanges) : null;
                    return (
                      <li key={player.id} className="flex items-center gap-3 py-2.5">
                        <PlayerAvatar player={player} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            <span className="truncate">{player.name}</span>
                            {player.jerseyNumber != null && (
                              <span className="shrink-0 font-normal text-subtle tabular">#{player.jerseyNumber}</span>
                            )}
                          </div>
                          {playerChange && (
                            <div className="truncate text-xs font-medium text-warning">{getChangeDescription(playerChange)}</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-muted">
                  <SoccerBall size={16} />
                  All players are on the field
                </p>
              )}
            </Card>

            {unavailablePlayers.length > 0 && (
              <Card className="p-5">
                <CardHeader title={`Absent or injured · Q${currentQuarter}`} count={unavailablePlayers.length} />
                <ul className="mt-3 divide-y divide-line">
                  {unavailablePlayers.map((player) => {
                    const reason = current.unavailable.get(player.id);
                    return (
                      <li key={player.id} className="flex items-center gap-3 py-2.5">
                        <PlayerAvatar player={player} size="sm" className="opacity-60" />
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-muted">{player.name}</div>
                        <Badge tone={reason === 'injured' ? 'danger' : 'neutral'}>
                          {reason === 'injured' ? <FirstAid size={14} weight="bold" /> : <UserMinus size={14} weight="bold" />}
                          {reason === 'injured' ? 'Injured' : 'Absent'}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>

          {/* Field */}
          <Card className="order-1 p-4 sm:p-5 lg:order-2 lg:col-span-2">
            <CardHeader
              title="Formation"
              actions={
                <span className="rounded-md bg-surface-2 px-2 py-0.5 font-display text-base font-bold tabular text-ink">
                  {current.formationKey}
                </span>
              }
              className="mb-4"
            />
            <LineupField
              positions={current.positions}
              lineup={current.lineup}
              players={players}
              highlights={highlights}
              className="h-[28rem] sm:h-[32rem]"
            />
            {highlights.size > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full ring-[3px] ring-primary" />New this quarter</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full ring-[3px] ring-warning" />Changed position</span>
              </div>
            )}
          </Card>
        </div>
      </Page>

      <QuarterBar current={currentQuarter} onChange={setCurrentQuarter} />
    </div>
  );
}
