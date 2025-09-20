import type { Route } from "./+types/team.games.game.lineup";
import { data, useFetcher } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games, players, assignments, positions, sitOuts, shareLinks } from "~/db";
import { eq, and, or, sql, lt } from "drizzle-orm";
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
import { useState, useEffect, useRef, useCallback } from "react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const gameId = parseInt(params.gameId);
  
  // Get team details and verify ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
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

  // Get active share link if one exists
  const [activeShareLink] = await db
    .select()
    .from(shareLinks)
    .where(and(
      eq(shareLinks.gameId, gameId),
      sql`datetime(${shareLinks.expiresAt}) > datetime('now')`
    ))
    .limit(1);

  return data({
    team,
    game,
    players: teamPlayers,
    positions: availablePositions,
    assignments: existingAssignments,
    quarterFormations,
    absentInjuredPlayers,
    activeShareLink,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  const teamId = parseInt(params.teamId);
  const gameId = parseInt(params.gameId);
  
  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    return data(
      { success: false, error: "Team not found" },
      { status: 404 }
    );
  }
  
  const action = formData.get("_action") as string;
  
  if (action === "assignPlayer") {
    try {
      const playerId = parseInt(formData.get("playerId") as string);
      const positionNumber = parseInt(formData.get("positionNumber") as string);
      const positionName = formData.get("positionName") as string;
      const quarter = parseInt(formData.get("quarter") as string);
      
      // Remove any existing assignment for this player in this quarter
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.playerId, playerId),
          eq(assignments.quarter, quarter)
        )
      );
      
      // Remove any existing assignment for this position in this quarter
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.positionNumber, positionNumber),
          eq(assignments.quarter, quarter),
          eq(assignments.isSittingOut, false)
        )
      );
      
      // Insert new assignment
      await db.insert(assignments).values({
        gameId,
        playerId,
        positionNumber,
        positionName,
        quarter,
        isSittingOut: false,
      });
      
      return data({ success: true, action: "assignPlayer" });
    } catch (error) {
      console.error("Error assigning player:", error);
      return data(
        { success: false, error: "Failed to assign player" },
        { status: 500 }
      );
    }
  }
  
  if (action === "sitOutPlayer") {
    try {
      const playerId = parseInt(formData.get("playerId") as string);
      const quarter = parseInt(formData.get("quarter") as string);
      
      // Remove any existing assignment for this player in this quarter
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.playerId, playerId),
          eq(assignments.quarter, quarter)
        )
      );
      
      // Insert sitting out assignment
      await db.insert(assignments).values({
        gameId,
        playerId,
        positionNumber: 0,
        positionName: 'SUB',
        quarter,
        isSittingOut: true,
      });
      
      return data({ success: true, action: "sitOutPlayer" });
    } catch (error) {
      console.error("Error sitting out player:", error);
      return data(
        { success: false, error: "Failed to sit out player" },
        { status: 500 }
      );
    }
  }
  
  if (action === "clearPosition") {
    try {
      const positionNumber = parseInt(formData.get("positionNumber") as string);
      const quarter = parseInt(formData.get("quarter") as string);
      
      // Remove assignment for this position
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.positionNumber, positionNumber),
          eq(assignments.quarter, quarter),
          eq(assignments.isSittingOut, false)
        )
      );
      
      return data({ success: true, action: "clearPosition" });
    } catch (error) {
      console.error("Error clearing position:", error);
      return data(
        { success: false, error: "Failed to clear position" },
        { status: 500 }
      );
    }
  }
  
  if (action === "saveFormation") {
    try {
      const quarter = parseInt(formData.get("quarter") as string);
      const formationIndex = parseInt(formData.get("formationIndex") as string);
      
      // Get current game to read existing quarter formations
      const [currentGame] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);
      
      if (!currentGame) {
        return data(
          { success: false, error: "Game not found" },
          { status: 404 }
        );
      }
      
      // Parse existing quarter formations or create new object
      const existingFormations = currentGame.notes ? JSON.parse(currentGame.notes) : {};
      const quarterFormations = existingFormations.quarterFormations || {};
      
      // Update the formation for this quarter
      quarterFormations[quarter] = formationIndex;
      
      // Save back to the notes field (temporary solution)
      const updatedNotes = JSON.stringify({
        ...existingFormations,
        quarterFormations
      });
      
      await db.update(games)
        .set({ 
          notes: updatedNotes,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(games.id, gameId));
      
      return data({ success: true, action: "saveFormation" });
    } catch (error) {
      console.error("Error saving formation:", error);
      return data(
        { success: false, error: "Failed to save formation" },
        { status: 500 }
      );
    }
  }
  
  if (action === "markAbsentInjured") {
    try {
      const playerId = parseInt(formData.get("playerId") as string);
      const quarter = parseInt(formData.get("quarter") as string);
      const reason = formData.get("reason") as string; // 'absent' or 'injured'
      
      // Remove any existing assignment for this player in this quarter
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.playerId, playerId),
          eq(assignments.quarter, quarter)
        )
      );
      
      // Remove any existing absent/injured record for this player and quarter
      await db.delete(sitOuts).where(
        and(
          eq(sitOuts.gameId, gameId),
          eq(sitOuts.playerId, playerId),
          eq(sitOuts.quarter, quarter)
        )
      );
      
      // Insert new absent/injured record
      await db.insert(sitOuts).values({
        gameId,
        playerId,
        quarter,
        reason,
      });
      
      return data({ success: true, action: "markAbsentInjured" });
    } catch (error) {
      console.error("Error marking player absent/injured:", error);
      return data(
        { success: false, error: "Failed to mark player absent/injured" },
        { status: 500 }
      );
    }
  }
  
  if (action === "clearAbsentInjured") {
    try {
      const playerId = parseInt(formData.get("playerId") as string);
      const quarter = parseInt(formData.get("quarter") as string);
      
      // Remove absent/injured record
      await db.delete(sitOuts).where(
        and(
          eq(sitOuts.gameId, gameId),
          eq(sitOuts.playerId, playerId),
          eq(sitOuts.quarter, quarter)
        )
      );
      
      return data({ success: true, action: "clearAbsentInjured" });
    } catch (error) {
      console.error("Error clearing absent/injured status:", error);
      return data(
        { success: false, error: "Failed to clear absent/injured status" },
        { status: 500 }
      );
    }
  }
  
  if (action === "createShare") {
    try {
      // Generate a unique share ID
      const shareId = Math.random().toString(36).substring(2) + Date.now().toString(36);

      // Set expiry to 24 hours from now
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Delete any existing share links for this game
      await db.delete(shareLinks).where(eq(shareLinks.gameId, gameId));

      // Create new share link
      await db.insert(shareLinks).values({
        gameId,
        teamId,
        shareId,
        expiresAt,
        createdBy: user.id,
      });

      // Generate the full share URL
      const origin = new URL(request.url).origin;
      const shareUrl = `${origin}/public/game/${shareId}`;

      return data({
        success: true,
        shareUrl,
        shareId,
        action: "createShare"
      });
    } catch (error) {
      console.error("Error creating share link:", error);
      return data(
        { success: false, error: "Failed to create share link" },
        { status: 500 }
      );
    }
  }

  if (action === "saveLineup") {
    try {
      // Clear existing assignments for this game
      await db.delete(assignments).where(eq(assignments.gameId, gameId));
      
      // Parse lineup data from form
      const lineupData = JSON.parse(formData.get("lineupData") as string);
      
      // Insert new assignments
      if (lineupData.assignments && lineupData.assignments.length > 0) {
        await db.insert(assignments).values(
          lineupData.assignments.map((assignment: any) => ({
            gameId,
            playerId: assignment.playerId,
            positionNumber: assignment.positionNumber,
            positionName: assignment.positionName,
            quarter: assignment.quarter || 1,
            isSittingOut: assignment.isSittingOut || false,
          }))
        );
      }
      
      return data({ success: true, message: "Lineup saved successfully!" });
    } catch (error) {
      console.error("Error saving lineup:", error);
      return data(
        { success: false, error: "Failed to save lineup. Please try again." },
        { status: 500 }
      );
    }
  }
  
  return data({ success: false, error: "Invalid action" }, { status: 400 });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Plan Lineup - ${loaderData?.game?.opponent || 'Game'} - AYSO Game Day` },
    { name: "description", content: "Plan your team lineup and rotations" },
  ];
}


function PlayerCard({
  player,
  onDragStart,
  onAssign,
  availablePositions,
  onSitOut,
  quartersPlaying = 0,
  positionChange,
  showChangeIndicators = true
}: {
  player: any;
  onDragStart: (player: any) => void;
  onAssign?: (player: any, position: any) => void;
  availablePositions?: any[];
  onSitOut?: (player: any) => void;
  quartersPlaying?: number;
  positionChange?: PositionChange;
  showChangeIndicators?: boolean;
}) {
  const preferredPositions = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('player', JSON.stringify(player));
    onDragStart(player);
  };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onAssign) {
      setShowDropdown(!showDropdown);
    }
  };
  
  const handlePositionSelect = (position: any) => {
    if (onAssign) {
      onAssign(position, player);
    }
    setShowDropdown(false);
  };
  
  const handleSitOutClick = () => {
    if (onSitOut) {
      onSitOut(player);
    }
    setShowDropdown(false);
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isClickOnDropdown = dropdownRef.current?.contains(target);
      const isClickOnThisCard = target && (target as Element).closest && (target as Element).closest(`[data-player-card="${player.id}"]`);
      
      if (!isClickOnDropdown && !isClickOnThisCard) {
        setShowDropdown(false);
      }
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown, player.id]);
  
  return (
    <div className="relative">
      <div
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onClick={handleClick}
        className="flex items-center gap-2 p-2 border border-[var(--border)] rounded bg-[var(--surface)] cursor-pointer hover:shadow-md transition-shadow active:cursor-grabbing"
        data-player-card={player.id}
      >
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
            {showChangeIndicators && positionChange && (
              <span
                className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"
                title={getChangeDescription(positionChange)}
              />
            )}
          </div>
          {preferredPositions.length > 0 && (
            <div className="text-xs text-[var(--muted)] truncate">
              {preferredPositions.slice(0, 3).join(', ')}
            </div>
          )}
          {/* 📝 Change description tooltip */}
          {showChangeIndicators && positionChange && (
            <div className="text-xs text-orange-600 truncate">
              {getChangeDescription(positionChange)}
            </div>
          )}
        </div>
      </div>
      
      {/* Position Selection Dropdown */}
      {showDropdown && availablePositions && (
        <div 
          ref={dropdownRef}
          className="absolute z-[10001] mt-1 left-1/2 transform -translate-x-1/2 w-48 bg-white border border-[var(--border)] rounded-lg shadow-xl"
        >
          <div className="p-2">
            <div className="text-xs font-semibold text-[var(--muted)] px-2 py-1">
              Assign to Position:
            </div>
            <div className="max-h-48 overflow-y-auto">
              {availablePositions.map((pos) => {
                const isPreferred = preferredPositions.includes(pos.abbreviation);
                return (
                  <button
                    key={pos.number}
                    onClick={() => handlePositionSelect(pos)}
                    className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--bg)] transition ${
                      isPreferred ? 'bg-green-50' : ''
                    }`}
                  >
                    <span className="font-medium">#{pos.number} {pos.abbreviation}</span>
                    <span className="text-xs text-[var(--muted)] ml-1">
                      - {pos.fullName}
                      {isPreferred && ' ⭐'}
                    </span>
                  </button>
                );
              })}
            </div>
            {onSitOut && (
              <>
                <div className="border-t border-[var(--border)] mt-2 pt-2">
                  <button
                    onClick={handleSitOutClick}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-red-50 text-red-600 transition"
                  >
                    🪑 Sit Out This Quarter
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionSlot({
  position,
  assignedPlayer,
  previousQuarterPlayer,
  onDrop,
  onClear,
  onSitOut,
  availablePlayers,
  onAssignPlayer,
  openDropdownPosition,
  setOpenDropdownPosition,
  hasChange = false,
  changeDescription,
  showChangeIndicators = true
}: {
  position: any;
  assignedPlayer: any;
  previousQuarterPlayer?: any;
  onDrop: (position: any, player: any) => void;
  onClear: (position: any) => void;
  onSitOut?: (player: any) => void;
  availablePlayers?: any[];
  onAssignPlayer?: (position: any, player: any) => void;
  openDropdownPosition: number | null;
  setOpenDropdownPosition: (position: number | null) => void;
  hasChange?: boolean;
  changeDescription?: string;
  showChangeIndicators?: boolean;
}) {
  const showDropdown = openDropdownPosition === position.number;
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const playerData = e.dataTransfer.getData('player');
    if (playerData) {
      const player = JSON.parse(playerData);
      onDrop(position, player);
    }
  };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenDropdownPosition(showDropdown ? null : position.number);
  };
  
  const handlePlayerSelect = (player: any) => {
    if (onAssignPlayer) {
      onAssignPlayer(position, player);
    }
    setOpenDropdownPosition(null);
  };
  
  const handleSitOutClick = () => {
    if (onSitOut && assignedPlayer) {
      const player = { id: assignedPlayer.playerId, name: assignedPlayer.name };
      onSitOut(player);
    }
    setOpenDropdownPosition(null);
  };
  
  const handleClearClick = () => {
    onClear(position);
    setOpenDropdownPosition(null);
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isClickOnDropdown = dropdownRef.current?.contains(target);
      const isClickOnThisPosition = target && (target as Element).closest && (target as Element).closest(`[data-position="${position.number}"]`);
      
      if (!isClickOnDropdown && !isClickOnThisPosition) {
        setOpenDropdownPosition(null);
      }
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown, setOpenDropdownPosition, position.number]);
  
  return (
    <div
      className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${showDropdown ? 'z-[10000]' : 'z-10'}`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      data-position={position.number}
    >
      <div className="relative">
        {/* 🟠 Change indicator ring */}
        {showChangeIndicators && hasChange && (
          <div className="absolute inset-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-orange-500 animate-pulse"></div>
        )}
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
            assignedPlayer
              ? 'bg-[var(--primary)] border-[var(--primary)] text-white hover:bg-[var(--primary-600)]'
              : 'bg-[var(--surface)] border-[var(--border)] border-dashed hover:border-[var(--primary)]'
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
        
        {/* Dropdown Menu */}
        {showDropdown && (
          <div 
            ref={dropdownRef}
            className="absolute z-[10001] mt-1 left-1/2 transform -translate-x-1/2 w-48 bg-white border border-[var(--border)] rounded-lg shadow-xl"
          >
            <div className="p-2">
              {assignedPlayer ? (
                <>
                  <div className="text-xs font-semibold text-[var(--muted)] px-2 py-1">
                    {assignedPlayer.name}
                  </div>
                  {onSitOut && (
                    <button
                      onClick={handleSitOutClick}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-red-50 text-red-600 transition"
                    >
                      🪑 Move to Sit Out
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs font-semibold text-[var(--muted)] px-2 py-1">
                    Assign Player to #{position.number} {position.abbreviation}:
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {availablePlayers && availablePlayers.length > 0 ? (
                      availablePlayers.map((player) => {
                        const playerPrefs = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];
                        const isPreferred = playerPrefs.includes(position.abbreviation);
                        return (
                          <button
                            key={player.id}
                            onClick={() => handlePlayerSelect(player)}
                            className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--bg)] transition ${
                              isPreferred ? 'bg-green-50' : ''
                            }`}
                          >
                            <span className="font-medium">{player.name}</span>
                            {isPreferred && <span className="text-xs text-green-600 ml-1">⭐ Preferred</span>}
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-xs text-[var(--muted)] px-2 py-2">
                        No substitutes available
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GameLineup({ loaderData }: Route.ComponentProps) {
  const { team, game, players, positions, assignments, quarterFormations: savedQuarterFormations, absentInjuredPlayers, activeShareLink } = loaderData;
  const fetcher = useFetcher();
  const [draggedPlayer, setDraggedPlayer] = useState<any>(null);
  const [currentQuarter, setCurrentQuarter] = useState<number>(1);
  const [quarterAssignments, setQuarterAssignments] = useState<Map<number, Map<number, any>>>(new Map());
  const [sittingOut, setSittingOut] = useState<Map<number, Set<number>>>(new Map());
  const [absentInjured, setAbsentInjured] = useState<Map<number, Map<number, string>>>(new Map()); // quarter -> playerId -> reason
  const [showInstructions, setShowInstructions] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [openDropdownPosition, setOpenDropdownPosition] = useState<number | null>(null);
  const [showChangeIndicators, setShowChangeIndicators] = useState(true);
  const instructionsRef = useRef<HTMLDivElement>(null);
  const instructionsButtonRef = useRef<HTMLButtonElement>(null);
  
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
  
  const handlePrevFormation = () => {
    if (typeof currentQuarter !== 'number') return;
    
    const newIndex = currentFormationIndex === 0 ? formationKeys.length - 1 : currentFormationIndex - 1;
    
    // Optimistic update - update local state immediately
    const newQuarterFormations = new Map(quarterFormations);
    newQuarterFormations.set(currentQuarter, newIndex);
    setQuarterFormations(newQuarterFormations);
    
    // Make server request
    fetcher.submit(
      {
        _action: "saveFormation",
        quarter: currentQuarter.toString(),
        formationIndex: newIndex.toString(),
      },
      { method: "post" }
    );
  };
  
  const handleNextFormation = () => {
    if (typeof currentQuarter !== 'number') return;
    
    const newIndex = (currentFormationIndex + 1) % formationKeys.length;
    
    // Optimistic update - update local state immediately
    const newQuarterFormations = new Map(quarterFormations);
    newQuarterFormations.set(currentQuarter, newIndex);
    setQuarterFormations(newQuarterFormations);
    
    // Make server request
    fetcher.submit(
      {
        _action: "saveFormation",
        quarter: currentQuarter.toString(),
        formationIndex: newIndex.toString(),
      },
      { method: "post" }
    );
  };
  
  // Close instructions tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        instructionsRef.current && 
        !instructionsRef.current.contains(event.target as Node) &&
        instructionsButtonRef.current &&
        !instructionsButtonRef.current.contains(event.target as Node)
      ) {
        setShowInstructions(false);
      }
    };
    
    if (showInstructions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showInstructions]);
  

  // Initialize existing assignments per quarter
  useEffect(() => {
    const quarterMap = new Map<number, Map<number, any>>();
    const sitOutMap = new Map<number, Set<number>>();
    const absentInjuredMap = new Map<number, Map<number, string>>();
    
    // Initialize all quarters with all players sitting out by default
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
      
      // Remove from sitting out as they are absent/injured (different category)
      const quarterSitOuts = sitOutMap.get(quarter) || new Set();
      quarterSitOuts.delete(absentPlayer.playerId);
      sitOutMap.set(quarter, quarterSitOuts);
    });
    
    // Load existing assignments and override defaults
    assignments.forEach((assignment: any) => {
      const quarter = assignment.quarter || 1;
      const player = players.find((p: any) => p.id === assignment.playerId);
      
      if (assignment.isSittingOut) {
        // Player is explicitly sitting out (already in sitOut by default)
        const quarterSitOuts = sitOutMap.get(quarter) || new Set();
        quarterSitOuts.add(assignment.playerId);
        sitOutMap.set(quarter, quarterSitOuts);
      } else {
        // Player is assigned to field position - remove from sitting out
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
  
  const handleDragStart = (player: any) => {
    setDraggedPlayer(player);
  };
  
  const handlePositionAssignment = (position: any, player: any) => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    const newQuarterAssignments = new Map(quarterAssignments);
    const currentLineup = newQuarterAssignments.get(currentQuarter) || new Map();
    
    // Remove player from any existing position in this quarter
    for (const [pos, assigned] of currentLineup.entries()) {
      if (assigned.playerId === player.id) {
        currentLineup.delete(pos);
      }
    }
    
    // Remove player from sitting out if they were there
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.delete(player.id);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
    
    // Assign to new position
    currentLineup.set(position.number, {
      playerId: player.id,
      name: player.name
    });
    
    newQuarterAssignments.set(currentQuarter, currentLineup);
    setQuarterAssignments(newQuarterAssignments);
    
    // Make server request
    fetcher.submit(
      {
        _action: "assignPlayer",
        playerId: player.id.toString(),
        positionNumber: position.number.toString(),
        positionName: position.abbreviation,
        quarter: currentQuarter.toString(),
      },
      { method: "post" }
    );
  };
  
  const handleClearPosition = (position: any) => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    const newQuarterAssignments = new Map(quarterAssignments);
    const currentLineup = newQuarterAssignments.get(currentQuarter) || new Map();
    currentLineup.delete(position.number);
    newQuarterAssignments.set(currentQuarter, currentLineup);
    setQuarterAssignments(newQuarterAssignments);
    
    // Make server request
    fetcher.submit(
      {
        _action: "clearPosition",
        positionNumber: position.number.toString(),
        quarter: currentQuarter.toString(),
      },
      { method: "post" }
    );
  };
  
  const handleSitOut = (player: any) => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    // Remove from field positions
    const newQuarterAssignments = new Map(quarterAssignments);
    const currentLineup = newQuarterAssignments.get(currentQuarter) || new Map();
    for (const [pos, assigned] of currentLineup.entries()) {
      if (assigned.playerId === player.id) {
        currentLineup.delete(pos);
      }
    }
    newQuarterAssignments.set(currentQuarter, currentLineup);
    setQuarterAssignments(newQuarterAssignments);
    
    // Add to sitting out
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.add(player.id);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
    
    // Make server request
    fetcher.submit(
      {
        _action: "sitOutPlayer",
        playerId: player.id.toString(),
        quarter: currentQuarter.toString(),
      },
      { method: "post" }
    );
  };
  
  // Helper functions for absent/injured management
  const handleMarkAbsentInjured = (player: any, reason: 'absent' | 'injured') => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    const newAbsentInjured = new Map(absentInjured);
    const quarterAbsentInjured = newAbsentInjured.get(currentQuarter) || new Map();
    quarterAbsentInjured.set(player.id, reason);
    newAbsentInjured.set(currentQuarter, quarterAbsentInjured);
    setAbsentInjured(newAbsentInjured);
    
    // Remove from field positions if assigned
    const newQuarterAssignments = new Map(quarterAssignments);
    const currentLineup = newQuarterAssignments.get(currentQuarter) || new Map();
    for (const [pos, assigned] of currentLineup.entries()) {
      if (assigned.playerId === player.id) {
        currentLineup.delete(pos);
      }
    }
    newQuarterAssignments.set(currentQuarter, currentLineup);
    setQuarterAssignments(newQuarterAssignments);
    
    // Remove from sitting out
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.delete(player.id);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
    
    // Make server request
    fetcher.submit(
      {
        _action: "markAbsentInjured",
        playerId: player.id.toString(),
        quarter: currentQuarter.toString(),
        reason: reason,
      },
      { method: "post" }
    );
  };
  
  const handleClearAbsentInjured = (playerId: number) => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    const newAbsentInjured = new Map(absentInjured);
    const quarterAbsentInjured = newAbsentInjured.get(currentQuarter) || new Map();
    quarterAbsentInjured.delete(playerId);
    newAbsentInjured.set(currentQuarter, quarterAbsentInjured);
    setAbsentInjured(newAbsentInjured);
    
    // Add back to sitting out
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.add(playerId);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
    
    // Make server request
    fetcher.submit(
      {
        _action: "clearAbsentInjured",
        playerId: playerId.toString(),
        quarter: currentQuarter.toString(),
      },
      { method: "post" }
    );
  };
  
  const handleUnsitPlayer = (playerId: number) => {
    if (typeof currentQuarter !== 'number') return;
    
    // Optimistic update - update local state immediately
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.delete(playerId);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
    
    // Note: This removes the player from sitting out but doesn't assign them anywhere
    // The player becomes "available" but not assigned to any position
    // This functionality might need to be handled differently in the UI
  };
  
  // Get current quarter data
  const currentLineup = typeof currentQuarter === 'number' ? quarterAssignments.get(currentQuarter) || new Map() : new Map();
  const currentSittingOut = typeof currentQuarter === 'number' ? sittingOut.get(currentQuarter) || new Set() : new Set();
  const currentAbsentInjured = typeof currentQuarter === 'number' ? absentInjured.get(currentQuarter) || new Map() : new Map();

  // Get previous quarter data for hints
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

  // Get sitting out players for current quarter (these are now the "available" players)
  const sittingOutPlayers = players.filter((player: any) => currentSittingOut.has(player.id));

  // Calculate how many quarters each player is playing
  const getPlayerQuartersPlaying = (playerId: number): number => {
    let count = 0;
    for (let q = 1; q <= totalQuarters; q++) {
      const qLineup = quarterAssignments.get(q) || new Map();
      // Check if player is assigned to any position in this quarter
      for (const [_, assigned] of qLineup.entries()) {
        if (assigned.playerId === playerId) {
          count++;
          break;
        }
      }
    }
    return count;
  };
  
  // Get available positions for current quarter (not already assigned)
  const getAvailablePositions = () => {
    return formationPositions.filter((pos: any) => !currentLineup.has(pos.number));
  };

  // Handle share functionality
  const handleShare = () => {
    if (activeShareLink) {
      // Use existing active link
      const origin = window.location.origin;
      setShareUrl(`${origin}/public/game/${activeShareLink.shareId}`);
      setShowShareModal(true);
    } else {
      // Create new share link
      fetcher.submit(
        {
          _action: "createShare",
        },
        { method: "post" }
      );
    }
  };

  // Watch for fetcher response from share creation
  useEffect(() => {
    if (fetcher.data?.action === "createShare" && fetcher.data?.success) {
      setShareUrl(fetcher.data.shareUrl);
      setShowShareModal(true);
    }
  }, [fetcher.data]);

  const handleCopyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      // You could add a toast notification here
    }
  };
  
  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">Plan Lineup</h1>
              <div className="relative">
                <button
                  ref={instructionsButtonRef}
                  onClick={() => setShowInstructions(!showInstructions)}
                  onMouseEnter={() => setShowInstructions(true)}
                  onMouseLeave={(e) => {
                    // Only close if not hovering over the tooltip
                    if (!instructionsRef.current?.contains(e.relatedTarget as Node)) {
                      setShowInstructions(false);
                    }
                  }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--muted)] text-sm font-bold transition"
                  aria-label="How to plan your lineup"
                >
                  ?
                </button>
              
              {/* Instructions Tooltip */}
              {showInstructions && (
                <div 
                  ref={instructionsRef}
                  className="absolute z-50 left-8 top-0 w-80 p-4 bg-white border border-[var(--border)] rounded-lg shadow-xl"
                  onMouseEnter={() => setShowInstructions(true)}
                  onMouseLeave={() => setShowInstructions(false)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-[var(--text)]">How to Plan Your Lineup</h3>
                    <button
                      onClick={() => setShowInstructions(false)}
                      className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <ul className="text-xs text-[var(--muted)] space-y-1.5">
                    <li>• Select a quarter tab to plan that quarter's lineup</li>
                    <li>• <strong>Drag</strong> players to positions OR <strong>click</strong> names/positions for dropdown menus</li>
                    <li>• Click assigned players on field to move them or sit them out</li>
                    <li>• Each player should play at least 2 quarters (AYSO Fair Play)</li>
                    <li>• No player should sit out more than 1 quarter</li>
                    <li>• Save all quarters when complete</li>
                  </ul>
                </div>
              )}
            </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Position Changes Toggle */}
              {currentQuarter > 1 && (
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
              )}

              {/* Share Button */}
              <button
                onClick={handleShare}
                className="px-4 py-2 text-sm font-medium border border-[var(--border)] rounded-lg bg-[var(--surface)] hover:bg-[var(--bg)] transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.032 4.026a9.001 9.001 0 01-7.432 0m9.032-4.026A9.001 9.001 0 0112 3c-4.474 0-8.268 3.12-9.032 7.326m0 0A9.001 9.001 0 0012 21c4.474 0 8.268-3.12 9.032-7.326M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">Share Lineup</span>
                <span className="sm:hidden">Share</span>
              </button>

              {/* Playing Time Summary Button */}
              <button
                onClick={() => setShowOverview(true)}
                className="px-4 py-2 text-sm font-medium border border-[var(--border)] rounded-lg bg-[var(--surface)] hover:bg-[var(--bg)] transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="hidden sm:inline">Playing Time Summary</span>
                <span className="sm:hidden">Summary</span>
              </button>
            </div>
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
              {[1, 2, 3, 4].map((quarter) => {
                return (
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
                );
              })}
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
                      const quartersPlaying = getPlayerQuartersPlaying(player.id);
                      const quartersBgColor =
                        quartersPlaying === 0 ? 'bg-red-500 text-white' :
                        quartersPlaying === 1 ? 'bg-orange-500 text-white' :
                        quartersPlaying === 2 ? 'bg-yellow-500 text-white' :
                        'bg-green-500 text-white';

                      const playerChange = getPlayerChange(player.id, positionChanges);

                      return (
                        <div key={player.id} className="relative">
                          <PlayerCard
                            player={player}
                            onDragStart={handleDragStart}
                            onAssign={handlePositionAssignment}
                            availablePositions={getAvailablePositions()}
                            onSitOut={handleSitOut}
                            quartersPlaying={quartersPlaying}
                            positionChange={playerChange}
                            showChangeIndicators={showChangeIndicators}
                          />
                          {/* Quick absent/injured buttons and quarters indicator */}
                          <div className="absolute top-1 right-1 flex gap-1">
                            <div
                              className={`w-7 h-5 text-[10px] font-bold ${quartersBgColor} rounded flex items-center justify-center`}
                              title={`Playing ${quartersPlaying} out of 4 quarters`}
                            >
                              {quartersPlaying}/4
                            </div>
                            <button
                              onClick={() => handleMarkAbsentInjured(player, 'absent')}
                              className="w-5 h-5 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition flex items-center justify-center"
                              title="Mark as Absent"
                            >
                              A
                            </button>
                            <button
                              onClick={() => handleMarkAbsentInjured(player, 'injured')}
                              className="w-5 h-5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition flex items-center justify-center"
                              title="Mark as Injured"
                            >
                              I
                            </button>
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
                          <button
                            onClick={() => handleClearAbsentInjured(player.id)}
                            className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded border border-red-200 hover:bg-red-100 transition"
                          >
                            Return to Subs
                          </button>
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
            {/* Formation Selector */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Field Formation</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevFormation}
                  className="p-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] transition"
                  aria-label="Previous formation"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium border border-[var(--border)] rounded bg-[var(--surface)]">
                  {currentFormationKey}
                </span>
                <button
                  onClick={handleNextFormation}
                  className="p-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] transition"
                  aria-label="Next formation"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
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
                    onDrop={handlePositionAssignment}
                    onClear={handleClearPosition}
                    onSitOut={handleSitOut}
                    availablePlayers={sittingOutPlayers}
                    onAssignPlayer={handlePositionAssignment}
                    openDropdownPosition={openDropdownPosition}
                    setOpenDropdownPosition={setOpenDropdownPosition}
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
      
      {/* Mobile Bottom Navigation - Fixed to bottom with enhanced iPhone compatibility */}
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
        {/* Extra padding for iPhone home indicator and safe area */}
        <div className="h-2 bg-white"></div>
      </div>
      
      {/* Mobile padding bottom to account for fixed navigation with iPhone safe area */}
      <div className="sm:hidden h-24"></div>
      
      {/* Overview Modal Overlay */}
      {showOverview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">AYSO Fair Play Compliance</h2>
                <button
                  onClick={() => setShowOverview(false)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Summary Content */}
              <div className="space-y-4">
                <p className="text-sm text-gray-600 mb-4">
                  Players marked as Absent/Injured are excluded from AYSO minimum playing time requirements.
                </p>
                
                <div className="space-y-2">
                  {players.map((player: any) => {
                    let quarterCount = 0;
                    let sitOutCount = 0;
                    let absentInjuredCount = 0;
                    
                    for (let q = 1; q <= totalQuarters; q++) {
                      const qLineup = quarterAssignments.get(q) || new Map();
                      const qSitOuts = sittingOut.get(q) || new Set();
                      const qAbsentInjured = absentInjured.get(q) || new Map();
                      
                      const isPlaying = Array.from(qLineup.values()).some(a => a.playerId === player.id);
                      const isSittingOut = qSitOuts.has(player.id);
                      const isAbsentInjured = qAbsentInjured.has(player.id);
                      
                      if (isPlaying) quarterCount++;
                      if (isSittingOut) sitOutCount++;
                      if (isAbsentInjured) absentInjuredCount++;
                    }
                    
                    // AYSO compliance: minimum 2 quarters playing, max 1 quarter sitting (absent/injured doesn't count against AYSO rules)
                    const isCompliant = quarterCount >= 2 && sitOutCount <= 1;
                    
                    return (
                      <div key={player.id} className={`text-sm flex justify-between p-3 rounded-lg ${!isCompliant ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                        <span className="font-medium">{player.name}</span>
                        <span className="text-right">
                          <div>Playing: {quarterCount}/4 | Sitting: {sitOutCount}/4</div>
                          {absentInjuredCount > 0 && <div className="text-xs">Absent/Injured: {absentInjuredCount}/4</div>}
                          {!isCompliant && <span className="text-red-600 font-bold"> ⚠️ Non-compliant</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                
                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="text-sm font-semibold text-blue-800 mb-2">AYSO Fair Play Rules</h3>
                  <ul className="text-xs text-blue-700 space-y-1">
                    <li>• Each player must play at least 2 quarters</li>
                    <li>• No player should sit out more than 1 quarter</li>
                    <li>• Absent or injured players are excluded from these requirements</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Share Lineup</h2>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Share this link with your team to view the lineup. The link expires in 24 hours.
              </p>

              {shareUrl && (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={shareUrl}
                      readOnly
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={handleCopyShareLink}
                      className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-600)] transition text-sm font-medium"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="text-xs text-gray-500">
                    <p>🔗 This link will expire in 24 hours</p>
                    <p>👀 Anyone with this link can view (but not edit) the lineup</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}