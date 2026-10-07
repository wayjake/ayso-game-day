import type { Route } from "./+types/public.game";
import { data, Link } from "react-router";
import { db, teams, games, players, assignments, positions, sitOuts, shareLinks } from "~/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getDefaultFormationIndex, getFormationsByFormat } from "~/utils/formations";
import {
  calculatePositionChanges,
  hasPositionChange,
  hasPlayerChange,
  getPlayerChange,
  getChangeIndicatorColor,
  getChangeDescription,
  type PositionChange
} from "~/utils/position-changes";
import { useState, useEffect } from "react";
import { formatGameDateTime } from "~/utils/dates";
import { parseGameNotes } from "~/utils/game-notes";
import { AppMark } from "~/components/AppMark";
import { Badge, Card, CardHeader, Page, PlayerAvatar, buttonClass } from "~/components/ui";
import { CalendarBlank, Eye, FirstAid, SoccerBall, UserMinus, X } from "@phosphor-icons/react";

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

  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }

  // Get game details
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  if (!game) {
    throw new Response("Game not found", { status: 404 });
  }

  // Get team players
  const teamPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      jerseyNumber: players.jerseyNumber,
      profilePicture: players.profilePicture,
      preferredPositions: players.preferredPositions,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);

  // Get positions for this format
  const availablePositions = await db
    .select({
      number: positions.number,
      abbreviation: positions.abbreviation,
      fullName: positions.fullName,
      category: positions.category,
    })
    .from(positions)
    .where(or(
      eq(positions.format, 'all'),
      eq(positions.format, team.format)
    ))
    .orderBy(positions.number);

  // Get existing assignments for this game
  const existingAssignments = await db
    .select({
      playerId: assignments.playerId,
      positionNumber: assignments.positionNumber,
      positionName: assignments.positionName,
      quarter: assignments.quarter,
      isSittingOut: assignments.isSittingOut,
    })
    .from(assignments)
    .where(eq(assignments.gameId, gameId));

  // Get absent/injured players for this game
  const absentInjuredPlayers = await db
    .select({
      playerId: sitOuts.playerId,
      quarter: sitOuts.quarter,
      reason: sitOuts.reason,
    })
    .from(sitOuts)
    .where(and(
      eq(sitOuts.gameId, gameId),
      or(
        eq(sitOuts.reason, 'absent'),
        eq(sitOuts.reason, 'injured')
      )
    ));

  // Parse saved quarter formations from game notes
  const savedFormations = parseGameNotes(game.notes);
  const quarterFormations = savedFormations.quarterFormations || {};

  return data({
    team,
    game,
    players: teamPlayers,
    positions: availablePositions,
    assignments: existingAssignments,
    quarterFormations,
    absentInjuredPlayers,
    shareLink,
  });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData?.team?.name || 'Team'} Lineup - vs ${loaderData?.game?.opponent || 'Game'} - AYSO Game Day` },
    { name: "description", content: "View team lineup and rotations" },
  ];
}


// Read-only position slot component with change indicators
function PositionSlot({
  position,
  assignedPlayer,
  previousQuarterPlayer,
  hasChange = false,
  changeDescription,
  showChangeIndicators = true
}: {
  position: any;
  assignedPlayer: any;
  previousQuarterPlayer?: any;
  hasChange?: boolean;
  changeDescription?: string;
  showChangeIndicators?: boolean;
}) {
  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2 z-10"
      style={{ left: `${100 - position.x}%`, top: `${position.y}%` }}
    >
      <div className="relative">
        {/* Change indicator ring */}
        {showChangeIndicators && hasChange && (
          <div className="absolute inset-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-warning animate-pulse pointer-events-none"></div>
        )}
        <div
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-display font-bold tabular ${
            assignedPlayer
              ? 'bg-primary text-white text-base sm:text-lg ring-2 ring-white shadow-raised'
              : 'bg-pitch-dark/60 text-white border-2 border-dashed border-white/60'
          } ${showChangeIndicators && hasChange ? 'outline-2 outline-offset-2 outline-warning' : ''}`}
          title={showChangeIndicators && hasChange && changeDescription ? changeDescription : undefined}
        >
          {assignedPlayer ? (
            <div className="text-center">{position.number}</div>
          ) : (
            <div className="text-center leading-none">
              <div className="text-xs">{position.number}</div>
              <div className="text-[10px] font-sans font-semibold text-white/75">{position.abbreviation}</div>
            </div>
          )}
        </div>

        {/* Player name below position circle */}
        {assignedPlayer && (
          <div className="absolute top-12 sm:top-14 left-1/2 transform -translate-x-1/2 bg-ink/85 text-white text-xs font-semibold rounded-md px-1.5 sm:px-2 py-0.5 shadow-card pointer-events-none z-20 max-w-[72px] sm:max-w-none truncate sm:whitespace-nowrap">
            {assignedPlayer.name.length > 12 ? `${assignedPlayer.name.substring(0, 10)}...` : assignedPlayer.name}
          </div>
        )}

        {/* Previous quarter player hint when position is empty */}
        {!assignedPlayer && previousQuarterPlayer && (
          <div className="absolute top-12 sm:top-14 left-1/2 transform -translate-x-1/2 bg-pitch-dark/80 text-white/80 text-[10px] sm:text-xs rounded-md px-1.5 sm:px-2 py-0.5 pointer-events-none z-10 max-w-[72px] sm:max-w-none truncate sm:whitespace-nowrap ring-1 ring-white/30">
            {previousQuarterPlayer.name.length > 12 ? `${previousQuarterPlayer.name.substring(0, 10)}...` : previousQuarterPlayer.name}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PublicGameView({ loaderData }: Route.ComponentProps) {
  const { team, game, players, positions, assignments, quarterFormations: savedQuarterFormations, absentInjuredPlayers } = loaderData;
  const [currentQuarter, setCurrentQuarter] = useState<number>(1);
  const [quarterAssignments, setQuarterAssignments] = useState<Map<number, Map<number, any>>>(new Map());
  const [sittingOut, setSittingOut] = useState<Map<number, Set<number>>>(new Map());
  const [absentInjured, setAbsentInjured] = useState<Map<number, Map<number, string>>>(new Map());
  const [showChangeIndicators, setShowChangeIndicators] = useState(true);

  // Formation state per quarter
  const formationOptions = getFormationsByFormat(team.format);
  const formationKeys = Object.keys(formationOptions);
  const [quarterFormations, setQuarterFormations] = useState<Map<number, number>>(new Map());

  // Initialize quarter formations from saved data
  useEffect(() => {
    const formationsMap = new Map<number, number>();
    Object.entries(savedQuarterFormations).forEach(([quarter, formationIndex]) => {
      formationsMap.set(parseInt(quarter), formationIndex as number);
    });
    setQuarterFormations(formationsMap);
  }, [savedQuarterFormations]);

  // Get current quarter's formation
  const defaultFormationIndex = getDefaultFormationIndex(team.format);
  const currentFormationIndex = typeof currentQuarter === 'number' ? quarterFormations.get(currentQuarter) ?? defaultFormationIndex : defaultFormationIndex;
  const currentFormationKey = formationKeys[currentFormationIndex];
  const currentFormation = (formationOptions as any)[currentFormationKey];
  const formationPositions = currentFormation?.positions || [];

  const totalQuarters = 4; // Standard for AYSO games

  // Initialize existing assignments per quarter
  useEffect(() => {
    const quarterMap = new Map<number, Map<number, any>>();
    const sitOutMap = new Map<number, Set<number>>();
    const absentInjuredMap = new Map<number, Map<number, string>>();

    // Initialize all quarters
    for (let q = 1; q <= totalQuarters; q++) {
      quarterMap.set(q, new Map());
      const allPlayerIds = new Set(players.map((p: any) => p.id));
      sitOutMap.set(q, allPlayerIds);
      absentInjuredMap.set(q, new Map());
    }

    // Load absent/injured players first
    absentInjuredPlayers.forEach((absentPlayer: any) => {
      const quarter = absentPlayer.quarter || 1;
      const quarterAbsentInjured = absentInjuredMap.get(quarter) || new Map();
      quarterAbsentInjured.set(absentPlayer.playerId, absentPlayer.reason);
      absentInjuredMap.set(quarter, quarterAbsentInjured);

      // Remove from sitting out
      const quarterSitOuts = sitOutMap.get(quarter) || new Set();
      quarterSitOuts.delete(absentPlayer.playerId);
      sitOutMap.set(quarter, quarterSitOuts);
    });

    // Load existing assignments
    assignments.forEach((assignment: any) => {
      const quarter = assignment.quarter || 1;
      const player = players.find((p: any) => p.id === assignment.playerId);

      if (assignment.isSittingOut) {
        const quarterSitOuts = sitOutMap.get(quarter) || new Set();
        quarterSitOuts.add(assignment.playerId);
        sitOutMap.set(quarter, quarterSitOuts);
      } else {
        // Remove from sitting out
        const quarterSitOuts = sitOutMap.get(quarter) || new Set();
        quarterSitOuts.delete(assignment.playerId);
        sitOutMap.set(quarter, quarterSitOuts);

        // Add to field position
        const quarterLineup = quarterMap.get(quarter) || new Map();
        quarterLineup.set(assignment.positionNumber, {
          playerId: assignment.playerId,
          name: player?.name
        });
        quarterMap.set(quarter, quarterLineup);
      }
    });

    setQuarterAssignments(quarterMap);
    setSittingOut(sitOutMap);
    setAbsentInjured(absentInjuredMap);
  }, [assignments, players, formationPositions, absentInjuredPlayers]);

  // Get current quarter data
  const currentLineup = typeof currentQuarter === 'number' ? quarterAssignments.get(currentQuarter) || new Map() : new Map();
  const currentSittingOut: Set<number> = typeof currentQuarter === 'number' ? sittingOut.get(currentQuarter) || new Set<number>() : new Set<number>();
  const currentAbsentInjured = typeof currentQuarter === 'number' ? absentInjured.get(currentQuarter) || new Map() : new Map();

  // Get previous quarter data for hints and change detection
  const previousQuarter = currentQuarter > 1 ? currentQuarter - 1 : null;
  const previousLineup = previousQuarter ? quarterAssignments.get(previousQuarter) || new Map() : new Map();
  const previousSittingOut: Set<number> = previousQuarter ? sittingOut.get(previousQuarter) || new Set<number>() : new Set<number>();

  // Calculate position changes between quarters
  const positionChanges = previousQuarter ? calculatePositionChanges(
    previousLineup,
    currentLineup,
    previousSittingOut,
    currentSittingOut
  ) : [];

  // Get absent/injured players for current quarter
  const absentInjuredPlayersForQuarter = players.filter((player: any) => currentAbsentInjured.has(player.id));

  // Get sitting out players for current quarter
  const sittingOutPlayers = players.filter((player: any) => currentSittingOut.has(player.id));

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

            {/* Position changes toggle */}
            {currentQuarter > 1 && (
              <button
                type="button"
                onClick={() => setShowChangeIndicators(!showChangeIndicators)}
                aria-pressed={showChangeIndicators}
                className={
                  showChangeIndicators
                    ? buttonClass({ variant: "ghost", size: "sm", className: "bg-warning-soft text-warning! ring-1 ring-warning" })
                    : buttonClass({ variant: "secondary", size: "sm" })
                }
                title="Toggle position change indicators"
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

        {/* Quarter tabs (desktop) */}
        <nav className="mb-6 hidden border-b border-line sm:flex sm:gap-1" aria-label="Quarter">
          {[1, 2, 3, 4].map((quarter) => {
            const isActive = currentQuarter === quarter;
            return (
              <button
                key={quarter}
                type="button"
                onClick={() => setCurrentQuarter(quarter)}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 pt-2 pb-3 text-sm font-semibold transition ${
                  isActive
                    ? "border-primary text-ink"
                    : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                Quarter {quarter}
              </button>
            );
          })}
        </nav>

        {/* Main lineup content */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3">
          {/* Substitutes and absent players */}
          <div className="order-2 space-y-6 lg:order-1 lg:col-span-1">
            {/* Subs: players sitting out */}
            <Card className="p-5">
              <CardHeader title={`Sitting out · Q${currentQuarter}`} count={sittingOutPlayers.length} />
              {sittingOutPlayers.length > 0 ? (
                <ul className="mt-3 divide-y divide-line">
                  {sittingOutPlayers.map((player: any) => {
                    const playerChange = getPlayerChange(player.id, positionChanges);
                    const preferred: string[] = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];

                    return (
                      <li key={player.id} className="flex items-center gap-3 py-2.5">
                        <PlayerAvatar player={player} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            <span className="truncate">{player.name}</span>
                            {player.jerseyNumber != null && (
                              <span className="shrink-0 font-normal text-subtle tabular">#{player.jerseyNumber}</span>
                            )}
                            {/* Position change indicator */}
                            {showChangeIndicators && playerChange && (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-warning"
                                title={getChangeDescription(playerChange)}
                              />
                            )}
                          </div>
                          {preferred.length > 0 && (
                            <div className="truncate text-xs text-muted">{preferred.slice(0, 3).join(', ')}</div>
                          )}
                          {/* Change description */}
                          {showChangeIndicators && playerChange && (
                            <div className="truncate text-xs font-medium text-warning">
                              {getChangeDescription(playerChange)}
                            </div>
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

            {/* Absent/injured players */}
            {absentInjuredPlayersForQuarter.length > 0 && (
              <Card className="p-5">
                <CardHeader title={`Absent or injured · Q${currentQuarter}`} count={absentInjuredPlayersForQuarter.length} />
                <ul className="mt-3 divide-y divide-line">
                  {absentInjuredPlayersForQuarter.map((player: any) => {
                    const reason = currentAbsentInjured.get(player.id);
                    return (
                      <li key={player.id} className="flex items-center gap-3 py-2.5">
                        <PlayerAvatar player={player} size="sm" className="opacity-60" />
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-muted">{player.name}</div>
                        <Badge tone={reason === 'injured' ? 'danger' : 'neutral'} className="capitalize">
                          {reason === 'injured' ? <FirstAid size={14} weight="bold" /> : <UserMinus size={14} weight="bold" />}
                          {reason}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>

          {/* Formation field */}
          <Card className="order-1 p-4 sm:p-5 lg:order-2 lg:col-span-2">
            <CardHeader
              title="Formation"
              actions={
                <span className="rounded-md bg-surface-2 px-2 py-0.5 font-display text-base font-bold tabular text-ink">
                  {currentFormationKey}
                </span>
              }
              className="mb-4"
            />

            {/* Position change legend */}
            {showChangeIndicators && positionChanges.length > 0 && currentQuarter > 1 && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-warning-soft py-1.5 pr-1.5 pl-3 text-sm text-warning">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                    Changes from Q{previousQuarter}
                  </span>
                  <span className="tabular">
                    {positionChanges.length} change{positionChanges.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChangeIndicators(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-warning/10"
                  title="Hide change indicators"
                  aria-label="Hide change indicators"
                >
                  <X size={16} weight="bold" />
                </button>
              </div>
            )}

            <div className="relative h-[28rem] w-full rounded-xl bg-pitch sm:h-[32rem]">
              {/* Mowing stripes, clipped to the field. Slots live outside this layer so their labels never clip. */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="absolute inset-x-0 bg-pitch-dark" style={{ top: `${(i * 2 + 1) * (100 / 12)}%`, height: `${100 / 12}%` }} />
                ))}
              </div>

              {/* Field markings */}
              <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-white/70" aria-hidden>
                {/* Center line */}
                <div className="absolute top-1/2 left-0 right-0 border-t-2 border-white/70"></div>
                {/* Center circle */}
                <div className="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 sm:h-20 sm:w-20"></div>
                {/* Top penalty area */}
                <div className="absolute top-0 left-1/4 h-10 w-1/2 border-x-2 border-b-2 border-white/70 sm:h-14"></div>
                {/* Top goal area */}
                <div className="absolute top-0 left-[37.5%] h-4 w-1/4 border-x-2 border-b-2 border-white/70 sm:h-6"></div>
                {/* Bottom penalty area */}
                <div className="absolute bottom-0 left-1/4 h-10 w-1/2 border-x-2 border-t-2 border-white/70 sm:h-14"></div>
                {/* Bottom goal area */}
                <div className="absolute bottom-0 left-[37.5%] h-4 w-1/4 border-x-2 border-t-2 border-white/70 sm:h-6"></div>
              </div>

              {/* Position slots */}
              {formationPositions.map((position: any) => {
                const positionChangesForThisPosition = positionChanges.filter(change =>
                  change.toPosition === position.number || change.fromPosition === position.number
                );
                const hasChange = positionChangesForThisPosition.length > 0;
                const changeDescription = positionChangesForThisPosition
                  .map(change => getChangeDescription(change))
                  .join('; ');

                return (
                  <PositionSlot
                    key={`${currentQuarter}-${currentFormationIndex}-${position.number}-${position.x}-${position.y}`}
                    position={position}
                    assignedPlayer={currentLineup.get(position.number)}
                    previousQuarterPlayer={previousLineup.get(position.number)}
                    hasChange={hasChange}
                    changeDescription={changeDescription}
                    showChangeIndicators={showChangeIndicators}
                  />
                );
              })}
            </div>
          </Card>
        </div>
      </Page>

      {/* Room for the fixed quarter bar on phones */}
      <div className="h-20 sm:hidden" aria-hidden />

      {/* Quarter tabs (mobile): bottom bar within thumb reach */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay sm:hidden"
        aria-label="Quarter"
      >
        <div className="grid grid-cols-4">
          {[1, 2, 3, 4].map((quarter) => {
            const isActive = currentQuarter === quarter;
            return (
              <button
                key={quarter}
                type="button"
                onClick={() => setCurrentQuarter(quarter)}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex min-h-16 items-center justify-center font-display text-xl font-bold tabular transition ${
                  isActive ? "text-primary" : "text-muted active:bg-surface-2"
                }`}
              >
                {isActive && <span className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-primary" />}
                Q{quarter}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
