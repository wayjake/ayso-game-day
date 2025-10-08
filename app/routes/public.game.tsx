import type { Route } from "./+types/public.game";
import { data } from "react-router";
import { db, teams, games, players, assignments, positions, sitOuts, shareLinks } from "~/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getImageUrl } from "~/utils/image";
import { getFormationsByFormat } from "~/utils/formations";
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
  const savedFormations = game.notes ? JSON.parse(game.notes) : {};
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
        {/* 🟠 Change indicator ring */}
        {showChangeIndicators && hasChange && (
          <div className="absolute inset-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-orange-500 animate-pulse pointer-events-none"></div>
        )}
        <div
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
            assignedPlayer
              ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
              : 'bg-[var(--surface)] border-[var(--border)] border-dashed'
          } ${showChangeIndicators && hasChange ? 'ring-2 ring-orange-500 ring-offset-1' : ''}`}
          title={showChangeIndicators && hasChange && changeDescription ? changeDescription : undefined}
        >
          {assignedPlayer ? (
            <div className="text-center">
              <div className="text-xs font-bold">{position.number}</div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-xs">{position.number}</div>
              <div className="text-xs text-[var(--muted)]">{position.abbreviation}</div>
            </div>
          )}
        </div>

        {/* Player name below position circle */}
        {assignedPlayer && (
          <div className="absolute top-12 sm:top-14 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs rounded px-1 sm:px-2 py-1 pointer-events-none z-20 max-w-[70px] sm:max-w-none truncate sm:whitespace-nowrap">
            {assignedPlayer.name.length > 12 ? `${assignedPlayer.name.substring(0, 10)}...` : assignedPlayer.name}
          </div>
        )}

        {/* Previous quarter player hint when position is empty */}
        {!assignedPlayer && previousQuarterPlayer && (
          <div className="absolute top-12 sm:top-14 left-1/2 transform -translate-x-1/2 bg-gray-200/90 text-gray-600 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-0.5 pointer-events-none z-10 max-w-[70px] sm:max-w-none truncate sm:whitespace-nowrap border border-gray-300/50">
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
  const currentFormationIndex = typeof currentQuarter === 'number' ? quarterFormations.get(currentQuarter) ?? 0 : 0;
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
  const currentSittingOut = typeof currentQuarter === 'number' ? sittingOut.get(currentQuarter) || new Set() : new Set();
  const currentAbsentInjured = typeof currentQuarter === 'number' ? absentInjured.get(currentQuarter) || new Map() : new Map();

  // Get previous quarter data for hints and change detection
  const previousQuarter = currentQuarter > 1 ? currentQuarter - 1 : null;
  const previousLineup = previousQuarter ? quarterAssignments.get(previousQuarter) || new Map() : new Map();
  const previousSittingOut = previousQuarter ? sittingOut.get(previousQuarter) || new Set() : new Set();

  // 🔄 Calculate position changes between quarters
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
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">{team.name} Lineup</h1>
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-green-500 text-green-700 bg-green-50">
                VIEW ONLY
              </span>
            </div>

            {/* Position Changes Toggle - Public View */}
            {currentQuarter > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowChangeIndicators(!showChangeIndicators)}
                  className={`px-3 py-2 text-sm font-medium border rounded-lg transition flex items-center gap-2 ${
                    showChangeIndicators
                      ? 'border-orange-500 bg-orange-50 text-orange-700 hover:bg-orange-100'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)]'
                  }`}
                  title="Toggle position change indicators"
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"></span>
                  <span className="hidden lg:inline">Changes</span>
                </button>
              </div>
            )}
          </div>
          <p className="mt-2 text-[var(--muted)]">
            vs {game.opponent} • {new Date(game.gameDate).toLocaleDateString()}
            {game.gameTime && ` at ${game.gameTime}`}
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]">
              {team.format} Formation
            </span>
          </div>
        </div>

        {/* Quarter Tabs - Desktop Only */}
        <div className="mb-6 hidden sm:block">
          <div className="border-b border-[var(--border)]">
            <nav className="-mb-px flex space-x-4">
              {[1, 2, 3, 4].map((quarter) => (
                <button
                  key={quarter}
                  onClick={() => setCurrentQuarter(quarter)}
                  className={`py-2 px-4 border-b-2 font-medium text-sm transition ${
                    currentQuarter === quarter
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border)]'
                  }`}
                >
                  Quarter {quarter}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Main lineup content */}
        <div className="flex flex-col lg:grid lg:gap-8 lg:grid-cols-3 space-y-6 lg:space-y-0">
          {/* Substitutes / Available Players */}
          <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
            {/* Subs - Sitting Out Players */}
            <div>
              <h2 className="text-lg font-semibold mb-4">Substitutes - Q{currentQuarter}</h2>
              <div className="space-y-2 min-h-[200px] border border-dashed border-amber-300 rounded-lg p-2 bg-amber-50">
                <div className="space-y-2">
                  {sittingOutPlayers.length > 0 ? (
                    sittingOutPlayers.map((player: any) => {
                      const playerChange = getPlayerChange(player.id, positionChanges);

                      return (
                        <div key={player.id} className="flex items-center gap-2 p-2 border border-[var(--border)] rounded bg-[var(--surface)]">
                          {getImageUrl(player.profilePicture) ? (
                            <img
                              src={getImageUrl(player.profilePicture)!}
                              alt={player.name}
                              className="w-8 h-8 rounded-full object-cover border border-[var(--border)]"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[var(--bg)] flex items-center justify-center text-xs font-semibold text-[var(--muted)]">
                              {player.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate flex items-center gap-1">
                              {player.name}
                              {/* 🔄 Position Change Indicator */}
                              {showChangeIndicators && playerChange && (
                                <span
                                  className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"
                                  title={getChangeDescription(playerChange)}
                                />
                              )}
                            </div>
                            {player.preferredPositions && JSON.parse(player.preferredPositions).length > 0 && (
                              <div className="text-xs text-[var(--muted)] truncate">
                                {JSON.parse(player.preferredPositions).slice(0, 3).join(', ')}
                              </div>
                            )}
                            {/* 📝 Change description */}
                            {showChangeIndicators && playerChange && (
                              <div className="text-xs text-orange-600 truncate">
                                {getChangeDescription(playerChange)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-amber-700 text-center py-4">
                      All players are on the field
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Absent/Injured Players */}
            {absentInjuredPlayersForQuarter.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4">Absent/Injured - Q{currentQuarter}</h2>
                <div className="space-y-2 border border-dashed border-red-300 rounded-lg p-2 bg-red-50">
                  <div className="space-y-2">
                    {absentInjuredPlayersForQuarter.map((player: any) => {
                      const reason = currentAbsentInjured.get(player.id);
                      return (
                        <div key={player.id} className="flex items-center gap-2 p-2 border border-red-200 rounded bg-white">
                          {getImageUrl(player.profilePicture) ? (
                            <img
                              src={getImageUrl(player.profilePicture)!}
                              alt={player.name}
                              className="w-8 h-8 rounded-full object-cover border border-[var(--border)]"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-xs font-semibold text-red-600">
                              {player.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{player.name}</div>
                            <div className="text-xs text-red-600 capitalize">{reason}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Formation Field */}
          <div className="lg:col-span-2 order-1 lg:order-2">
            {/* Formation Display */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Field Formation</h2>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium border border-[var(--border)] rounded bg-[var(--surface)]">
                {currentFormationKey}
              </span>
            </div>

            {/* 📍 Position Change Legend */}
            {showChangeIndicators && positionChanges.length > 0 && currentQuarter > 1 && (
              <div className="mb-3 p-2 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                      <span className="text-orange-700 font-medium">Position Changes from Q{previousQuarter}</span>
                    </div>
                    <span className="text-orange-600">
                      {positionChanges.length} change{positionChanges.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowChangeIndicators(false)}
                    className="text-orange-600 hover:text-orange-800 text-sm"
                    title="Hide change indicators"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="relative bg-green-700 rounded-lg h-[28rem] sm:h-[32rem] w-full">
              {/* Field markings */}
              <div className="absolute inset-2 border-2 border-white rounded">
                {/* Center line */}
                <div className="absolute top-1/2 left-0 right-0 border-t-2 border-white"></div>
                {/* Center circle */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-12 sm:w-16 sm:h-16 border-2 border-white rounded-full"></div>
                {/* Top penalty area */}
                <div className="absolute top-0 left-1/3 w-1/3 h-8 sm:h-12 border-b-2 border-l-2 border-r-2 border-white"></div>
                {/* Top goal area */}
                <div className="absolute top-0 left-[40%] w-1/5 h-4 sm:h-6 border-b-2 border-l-2 border-r-2 border-white"></div>
                {/* Bottom penalty area */}
                <div className="absolute bottom-0 left-1/3 w-1/3 h-8 sm:h-12 border-t-2 border-l-2 border-r-2 border-white"></div>
                {/* Bottom goal area */}
                <div className="absolute bottom-0 left-[40%] w-1/5 h-4 sm:h-6 border-t-2 border-l-2 border-r-2 border-white"></div>
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
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t-2 border-[var(--border)] shadow-[0_-8px_32px_rgba(0,0,0,0.12)] z-30">
        <div className="grid grid-cols-4 text-center">
          {[1, 2, 3, 4].map((quarter) => (
            <button
              key={quarter}
              onClick={() => setCurrentQuarter(quarter)}
              className={`py-6 px-2 text-base font-bold transition min-h-[68px] flex items-center justify-center ${
                currentQuarter === quarter
                  ? 'text-[var(--primary)] bg-[var(--bg)] shadow-inner'
                  : 'text-gray-700 hover:text-black hover:bg-[var(--bg)] active:bg-gray-100'
              }`}
            >
              Q{quarter}
            </button>
          ))}
        </div>
        {/* Extra padding for iPhone home indicator */}
        <div className="h-2 bg-white"></div>
      </div>

      {/* Mobile padding bottom */}
      <div className="sm:hidden h-24"></div>
    </div>
  );
}