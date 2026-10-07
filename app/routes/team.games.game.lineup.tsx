import type { Route } from "./+types/team.games.game.lineup";
import { data, Link, useFetcher } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, games, players, assignments, positions, sitOuts, shareLinks } from "~/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getDefaultFormationIndex, getFormationsByFormat } from "~/utils/formations";
import {
  calculatePositionChanges,
  getPlayerChange,
  getChangeDescription,
  type PositionChange
} from "~/utils/position-changes";
import { Pitch, QuarterBar, QuarterTabs } from "~/components/LineupField";
import { useState, useEffect, useRef, useCallback } from "react";
import { AIAssistantCoach } from "~/components/AIAssistantCoach";
import { formatGameDateTime } from "~/utils/dates";
import { parseGameNotes, serializeGameNotes } from "~/utils/game-notes";
import { Alert, Badge, Button, Card, CardHeader, HomeAwayBadge, Page, PlayerAvatar, buttonClass, cx, inputClass } from "~/components/ui";
import {
  ArrowDown,
  ArrowUp,
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  ChartBar,
  Chair,
  Copy,
  DotsThree,
  Eye,
  FirstAidKit,
  Link as LinkIcon,
  Play,
  Printer,
  Question,
  ShareNetwork,
  Sparkle,
  Star,
  Trash,
  UserMinus,
  Warning,
  X,
} from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const gameId = parseInt(params.gameId);
  
  // Get team details and verify ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
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
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);
  
  if (!team) {
    return data(
      { success: false, error: "Team not found" },
      { status: 404 }
    );
  }

  // The game and every player touched below must belong to this team. Without
  // this, anyone with access to one team could edit another team's games by id.
  const [ownedGame] = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  if (!ownedGame) {
    return data(
      { success: false, error: "Game not found" },
      { status: 404 }
    );
  }

  const teamPlayerIds = new Set(
    (await db.select({ id: players.id }).from(players).where(eq(players.teamId, teamId)))
      .map((p) => p.id)
  );

  // Rebuild assignment rows from whitelisted fields, forcing this game's id
  const toAssignmentRows = (rows: any[]) =>
    rows
      .filter((row) => teamPlayerIds.has(Number(row.playerId)))
      .map((row) => ({
        gameId,
        playerId: Number(row.playerId),
        positionNumber: Number(row.positionNumber),
        positionName: row.positionName ?? null,
        quarter: Number(row.quarter) || 1,
        isSittingOut: Boolean(row.isSittingOut),
      }));

  const action = formData.get("_action") as string;

  const playerIdField = formData.get("playerId");
  if (playerIdField && !teamPlayerIds.has(parseInt(playerIdField as string))) {
    return data(
      { success: false, error: "Player not found" },
      { status: 404 }
    );
  }
  
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
  
  if (action === "bulkAssign") {
    try {
      const assignmentsData = JSON.parse(formData.get("assignments") as string);

      // Clear all existing non-sitting-out assignments for this game
      await db.delete(assignments).where(
        and(
          eq(assignments.gameId, gameId),
          eq(assignments.isSittingOut, false)
        )
      );

      // Insert all new assignments
      const rows = toAssignmentRows(assignmentsData);
      if (rows.length > 0) {
        await db.insert(assignments).values(rows);
      }

      return data({ success: true, action: "bulkAssign" });
    } catch (error) {
      console.error("Error bulk assigning players:", error);
      return data(
        { success: false, error: "Failed to assign players" },
        { status: 500 }
      );
    }
  }

  if (action === "clearPosition") {
    try {
      const positionNumber = parseInt(formData.get("positionNumber") as string);
      const quarter = parseInt(formData.get("quarter") as string);
      const playerIdStr = formData.get("playerId") as string | null;

      if (positionNumber === 0) {
        // Special case: clearing a sitting out assignment (position 0)
        if (playerIdStr) {
          // If playerId is provided, only remove that specific player's sitting out assignment
          const playerId = parseInt(playerIdStr);
          await db.delete(assignments).where(
            and(
              eq(assignments.gameId, gameId),
              eq(assignments.playerId, playerId),
              eq(assignments.positionNumber, 0),
              eq(assignments.quarter, quarter),
              eq(assignments.isSittingOut, true)
            )
          );
        } else {
          // Legacy: if no playerId, remove ALL sitting out assignments for this quarter
          await db.delete(assignments).where(
            and(
              eq(assignments.gameId, gameId),
              eq(assignments.positionNumber, 0),
              eq(assignments.quarter, quarter),
              eq(assignments.isSittingOut, true)
            )
          );
        }
      } else {
        // Remove assignment for this field position
        await db.delete(assignments).where(
          and(
            eq(assignments.gameId, gameId),
            eq(assignments.positionNumber, positionNumber),
            eq(assignments.quarter, quarter),
            eq(assignments.isSittingOut, false)
          )
        );
      }

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
      const existingFormations = parseGameNotes(currentGame.notes);
      const quarterFormations = existingFormations.quarterFormations || {};
      
      // Update the formation for this quarter
      quarterFormations[quarter] = formationIndex;
      
      // Save back to the notes field (temporary solution)
      const updatedNotes = serializeGameNotes({
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
      const quartersParam = formData.get("quarters") as string;
      const reason = formData.get("reason") as string; // 'absent' or 'injured'

      // Parse quarters - can be comma-separated for multiple quarters
      const quarters = quartersParam.split(',').map(q => parseInt(q.trim()));

      // Process each quarter
      for (const quarter of quarters) {
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
      }

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
      const rows = toAssignmentRows(lineupData.assignments ?? []);
      if (rows.length > 0) {
        await db.insert(assignments).values(rows);
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

  if (action === "clearLineup") {
    try {
      // Delete all assignments for this game (both field and sitting out)
      await db.delete(assignments).where(eq(assignments.gameId, gameId));

      return data({ success: true, action: "clearLineup" });
    } catch (error) {
      console.error("Error clearing lineup:", error);
      return data(
        { success: false, error: "Failed to clear lineup" },
        { status: 500 }
      );
    }
  }

  return data({ success: false, error: "Invalid action" }, { status: 400 });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Lineup - ${loaderData?.game?.opponent || 'Game'} - AYSO Game Day` },
    { name: "description", content: "Plan your team lineup and rotations" },
  ];
}

// Badge colors for "quarters sitting out": 0 is the normal case, more is worse
function sittingOutBadgeClass(quartersSittingOut: number) {
  if (quartersSittingOut === 0) return "bg-surface-2 text-muted";
  if (quartersSittingOut === 1) return "bg-primary-soft text-primary-ink";
  if (quartersSittingOut === 2) return "bg-warning-soft text-warning";
  return "bg-danger-soft text-danger";
}

function PlayerCard({
  player,
  onDragStart,
  onAssign,
  availablePositions,
  onSitOut,
  quartersPlaying = 0,
  positionChange,
  showChangeIndicators = true,
  isSittingOut = false
}: {
  player: any;
  onDragStart: (player: any) => void;
  onAssign?: (player: any, position: any) => void;
  availablePositions?: any[];
  onSitOut?: (player: any) => void;
  quartersPlaying?: number;
  positionChange?: PositionChange;
  showChangeIndicators?: boolean;
  isSittingOut?: boolean;
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
        className="flex min-h-12 cursor-grab items-center gap-2.5 rounded-xl bg-surface p-2 ring-1 ring-line/70 transition hover:shadow-raised hover:ring-line-strong active:cursor-grabbing"
        data-player-card={player.id}
      >
        <PlayerAvatar player={{ ...player, jerseyNumber: null }} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {player.jerseyNumber != null && (
              <span className="shrink-0 font-display text-sm font-bold text-subtle tabular">
                #{player.jerseyNumber}
              </span>
            )}
            <span className="truncate">{player.name}</span>
            {/* Position change indicator */}
            {showChangeIndicators && positionChange && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-warning"
                title={getChangeDescription(positionChange)}
              />
            )}
          </div>
          {preferredPositions.length > 0 && (
            <div className="truncate text-xs text-muted">
              {preferredPositions.slice(0, 3).join(', ')}
            </div>
          )}
          {/* Change description */}
          {showChangeIndicators && positionChange && (
            <div className="truncate text-xs font-medium text-warning">
              {getChangeDescription(positionChange)}
            </div>
          )}
        </div>
      </div>
      
      {/* Position Selection Dropdown */}
      {showDropdown && availablePositions && (
        <div
          ref={dropdownRef}
          className="absolute left-0 z-[10001] mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-surface p-1.5 shadow-overlay ring-1 ring-line"
        >
          <div className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted">
            Assign to position
          </div>
          <div className="max-h-56 overflow-y-auto">
            {availablePositions.map((pos) => {
              const isPreferred = preferredPositions.includes(pos.abbreviation);
              return (
                <button
                  key={pos.number}
                  onClick={() => handlePositionSelect(pos)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                    isPreferred ? "bg-success-soft hover:brightness-95" : "hover:bg-surface-2"
                  )}
                >
                  <span className="w-6 shrink-0 font-display font-bold tabular">{pos.number}</span>
                  <span className="font-medium">{pos.abbreviation}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{pos.fullName}</span>
                  {isPreferred && <Star size={14} weight="fill" className="shrink-0 text-success" aria-label="Preferred" />}
                </button>
              );
            })}
          </div>
          {/* Sit Out option - only show if not already sitting out */}
          {onSitOut && !isSittingOut && (
            <>
              <div className="mx-2 my-1.5 border-t border-line"></div>
              <button
                onClick={handleSitOutClick}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-warning transition hover:bg-warning-soft"
              >
                <Chair size={16} />
                Sit out this quarter
              </button>
            </>
          )}
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
  showChangeIndicators = true,
  quartersSittingOut = 0,
  onPositionDragStart
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
  quartersSittingOut?: number;
  onPositionDragStart?: (player: any, fromPosition: number) => void;
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

  const handlePositionDragStart = (e: React.DragEvent) => {
    if (assignedPlayer && onPositionDragStart) {
      const player = { id: assignedPlayer.playerId, name: assignedPlayer.name };
      e.dataTransfer.setData('player', JSON.stringify(player));
      e.dataTransfer.setData('fromPosition', position.number.toString());
      onPositionDragStart(player, position.number);
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
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${showDropdown ? 'z-[10000]' : 'z-10'}`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      data-position={position.number}
    >
      <div className="relative">
        {/* Change indicator ring */}
        {showChangeIndicators && hasChange && (
          <div className="pointer-events-none absolute inset-0 h-10 w-10 animate-pulse rounded-full border-2 border-warning sm:h-12 sm:w-12"></div>
        )}
        <div
          draggable={!!assignedPlayer}
          onDragStart={handlePositionDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
          className={cx(
            "flex h-10 w-10 items-center justify-center rounded-full font-display font-bold tabular shadow-raised transition sm:h-12 sm:w-12",
            assignedPlayer
              ? "cursor-grab bg-surface text-lg text-ink active:cursor-grabbing sm:text-xl"
              : "cursor-pointer border-2 border-dashed border-white/70 bg-surface/80 text-ink hover:border-primary hover:bg-surface",
            // One ring at a time: selected (menu open) > position change > default
            showDropdown
              ? "ring-[3px] ring-primary"
              : showChangeIndicators && hasChange
                ? "ring-2 ring-warning ring-offset-1 ring-offset-pitch"
                : assignedPlayer && "ring-2 ring-white/60 hover:ring-primary"
          )}
          title={showChangeIndicators && hasChange && changeDescription ? changeDescription : undefined}
        >
          {assignedPlayer ? (
            <div className="text-center leading-none">{position.number}</div>
          ) : (
            <div className="text-center leading-none">
              <div className="text-sm">{position.number}</div>
              <div className="mt-0.5 font-sans text-[9px] font-semibold text-muted sm:text-[10px]">{position.abbreviation}</div>
            </div>
          )}
        </div>
        
        {/* Sitting out badge indicator */}
        {assignedPlayer && quartersSittingOut !== undefined && (
          <div
            className={cx(
              "pointer-events-none absolute -top-1 -right-2 z-30 flex h-4 items-center justify-center rounded px-1 text-[9px] font-bold tabular shadow-card",
              sittingOutBadgeClass(quartersSittingOut)
            )}
            title={`Sitting out ${quartersSittingOut} of 4 quarters`}
          >
            {quartersSittingOut}/4
          </div>
        )}

        {/* Player name below position circle */}
        {assignedPlayer && (
          <div className="pointer-events-none absolute top-12 left-1/2 z-20 max-w-[70px] -translate-x-1/2 truncate rounded-md bg-ink/85 px-1.5 py-0.5 text-xs font-medium text-white sm:top-14 sm:max-w-none sm:px-2 sm:whitespace-nowrap">
            {assignedPlayer.name.length > 12 ? `${assignedPlayer.name.substring(0, 10)}...` : assignedPlayer.name}
          </div>
        )}

        {/* Previous quarter player hint when position is empty */}
        {!assignedPlayer && previousQuarterPlayer && (
          <div className="pointer-events-none absolute top-12 left-1/2 z-10 max-w-[70px] -translate-x-1/2 truncate rounded-md bg-surface/75 px-1.5 py-0.5 text-[10px] text-muted sm:top-14 sm:max-w-none sm:px-2 sm:text-xs sm:whitespace-nowrap">
            {previousQuarterPlayer.name.length > 12 ? `${previousQuarterPlayer.name.substring(0, 10)}...` : previousQuarterPlayer.name}
          </div>
        )}
        
        {/* Dropdown Menu */}
        {showDropdown && (
          <div 
            ref={dropdownRef}
            className="absolute left-1/2 z-[10001] mt-1 w-48 -translate-x-1/2 rounded-xl bg-surface p-1.5 shadow-overlay ring-1 ring-line"
          >
            {assignedPlayer ? (
              <>
                <div className="truncate px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted">
                  {assignedPlayer.name}
                </div>
                <div className="mx-2 mb-1.5 border-t border-line"></div>
                <button
                  onClick={handleClearClick}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-ink transition hover:bg-surface-2"
                >
                  <ArrowUp size={16} className="text-muted" />
                  Move to available
                </button>
                {onSitOut && (
                  <button
                    onClick={handleSitOutClick}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-warning transition hover:bg-warning-soft"
                  >
                    <Chair size={16} />
                    Move to substitutes
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted">
                  Assign to #{position.number} {position.abbreviation}
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {availablePlayers && availablePlayers.length > 0 ? (
                    availablePlayers.map((player) => {
                      const playerPrefs = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];
                      const isPreferred = playerPrefs.includes(position.abbreviation);
                      return (
                        <button
                          key={player.id}
                          onClick={() => handlePlayerSelect(player)}
                          className={cx(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                            isPreferred ? "bg-success-soft hover:brightness-95" : "hover:bg-surface-2"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
                          {isPreferred && (
                            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                              <Star size={12} weight="fill" />
                              Preferred
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-2.5 py-2 text-xs text-muted">
                      No substitutes available
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Less frequent lineup actions, tucked behind one button
function LineupMenu({
  gameCardHref,
  onShare,
  onSummary,
  onClear,
}: {
  gameCardHref: string;
  onShare: () => void;
  onSummary: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const item = "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition";
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={buttonClass({ variant: "secondary", size: "icon" })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More lineup actions"
        title="More"
      >
        <DotsThree size={22} weight="bold" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-60 rounded-xl bg-surface p-1.5 shadow-overlay ring-1 ring-line">
          <button role="menuitem" onClick={run(onShare)} className={cx(item, "text-ink hover:bg-surface-2")}>
            <ShareNetwork size={18} className="text-muted" />
            Share with parents
          </button>
          <a
            role="menuitem"
            href={gameCardHref}
            target="_blank"
            rel="noopener"
            onClick={() => setOpen(false)}
            className={cx(item, "text-ink hover:bg-surface-2")}
          >
            <Printer size={18} className="text-muted" />
            Print game card
          </a>
          <button role="menuitem" onClick={run(onSummary)} className={cx(item, "text-ink hover:bg-surface-2")}>
            <ChartBar size={18} className="text-muted" />
            Fair play summary
          </button>
          <div className="mx-2 my-1.5 border-t border-line" />
          <button role="menuitem" onClick={run(onClear)} className={cx(item, "text-danger hover:bg-danger-soft")}>
            <Trash size={18} />
            Clear lineup
          </button>
        </div>
      )}
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
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showAbsentInjuredModal, setShowAbsentInjuredModal] = useState(false);
  const [absentInjuredModalData, setAbsentInjuredModalData] = useState<{ player: any } | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<'absent' | 'injured'>('absent');
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
  const defaultFormationIndex = getDefaultFormationIndex(team.format);
  const currentFormationIndex = typeof currentQuarter === 'number' ? quarterFormations.get(currentQuarter) ?? defaultFormationIndex : defaultFormationIndex;
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

    // Initialize all quarters with empty sets (players start as "available")
    for (let q = 1; q <= totalQuarters; q++) {
      quarterMap.set(q, new Map());
      sitOutMap.set(q, new Set());
      absentInjuredMap.set(q, new Map());
    }

    // Load absent/injured players first
    absentInjuredPlayers.forEach((absentPlayer: any) => {
      const quarter = absentPlayer.quarter || 1;
      const quarterAbsentInjured = absentInjuredMap.get(quarter) || new Map();
      quarterAbsentInjured.set(absentPlayer.playerId, absentPlayer.reason);
      absentInjuredMap.set(quarter, quarterAbsentInjured);
    });

    // Load existing assignments
    assignments.forEach((assignment: any) => {
      const quarter = assignment.quarter || 1;
      const player = players.find((p: any) => p.id === assignment.playerId);

      if (assignment.isSittingOut) {
        // Player is explicitly sitting out
        const quarterSitOuts = sitOutMap.get(quarter) || new Set();
        quarterSitOuts.add(assignment.playerId);
        sitOutMap.set(quarter, quarterSitOuts);
      } else {
        // Player is assigned to field position
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

    // Check if there's already a player at the target position
    const existingPlayerAtPosition = currentLineup.get(position.number);

    // Find if player is coming from another position
    let playerCurrentPosition = null;
    for (const [pos, assigned] of currentLineup.entries()) {
      if (assigned.playerId === player.id) {
        playerCurrentPosition = pos;
        break;
      }
    }

    // If there's a player at the target position and we're dragging from another position, swap them
    if (existingPlayerAtPosition && playerCurrentPosition !== null) {
      // Swap positions
      currentLineup.set(playerCurrentPosition, existingPlayerAtPosition);
      currentLineup.set(position.number, {
        playerId: player.id,
        name: player.name
      });

      // Update state
      newQuarterAssignments.set(currentQuarter, currentLineup);
      setQuarterAssignments(newQuarterAssignments);

      // Make server requests for both players
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

      fetcher.submit(
        {
          _action: "assignPlayer",
          playerId: existingPlayerAtPosition.playerId.toString(),
          positionNumber: playerCurrentPosition.toString(),
          positionName: positions.find((p: any) => p.number === playerCurrentPosition)?.abbreviation || '',
          quarter: currentQuarter.toString(),
        },
        { method: "post" }
      );
    } else {
      // Normal assignment (no swap)
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
    }
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
  
  // Helper functions for absent/injured management.
  // One button opens a sheet that asks why (absent/injured) and for how long.
  const handleMarkUnavailable = (player: any) => {
    if (typeof currentQuarter !== 'number') return;
    setUnavailableReason('absent');
    setAbsentInjuredModalData({ player });
    setShowAbsentInjuredModal(true);
  };

  const closeUnavailableSheet = () => {
    setShowAbsentInjuredModal(false);
    setAbsentInjuredModalData(null);
  };

  // Apply absent/injured status to specific quarter(s)
  const applyAbsentInjured = (player: any, reason: 'absent' | 'injured', quartersToApply: number[]) => {

    // Optimistic update - update local state immediately
    const newAbsentInjured = new Map(absentInjured);
    const newQuarterAssignments = new Map(quarterAssignments);
    const newSittingOut = new Map(sittingOut);

    quartersToApply.forEach(q => {
      // Update absent/injured state
      const quarterAbsentInjured = newAbsentInjured.get(q) || new Map();
      quarterAbsentInjured.set(player.id, reason);
      newAbsentInjured.set(q, quarterAbsentInjured);

      // Remove from field positions if assigned
      const currentLineup = newQuarterAssignments.get(q) || new Map();
      for (const [pos, assigned] of currentLineup.entries()) {
        if (assigned.playerId === player.id) {
          currentLineup.delete(pos);
        }
      }
      newQuarterAssignments.set(q, currentLineup);

      // Remove from sitting out
      const quarterSitOuts = newSittingOut.get(q) || new Set();
      quarterSitOuts.delete(player.id);
      newSittingOut.set(q, quarterSitOuts);
    });

    setAbsentInjured(newAbsentInjured);
    setQuarterAssignments(newQuarterAssignments);
    setSittingOut(newSittingOut);

    // Make server request
    fetcher.submit(
      {
        _action: "markAbsentInjured",
        playerId: player.id.toString(),
        quarters: quartersToApply.join(','),
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

    // Make server request to clear the sitting out assignment
    fetcher.submit(
      {
        _action: "clearPosition",
        positionNumber: "0",
        quarter: currentQuarter.toString(),
        playerId: playerId.toString(), // Add playerId so we only delete this specific player
      },
      { method: "post" }
    );
  };
  
  // Get current quarter data
  const currentLineup = typeof currentQuarter === 'number' ? quarterAssignments.get(currentQuarter) || new Map() : new Map();
  const currentSittingOut: Set<number> = typeof currentQuarter === 'number' ? sittingOut.get(currentQuarter) || new Set<number>() : new Set<number>();
  const currentAbsentInjured = typeof currentQuarter === 'number' ? absentInjured.get(currentQuarter) || new Map() : new Map();

  // Get previous quarter data for hints
  const previousQuarter = currentQuarter > 1 ? currentQuarter - 1 : null;
  const previousLineup = previousQuarter ? quarterAssignments.get(previousQuarter) || new Map() : new Map();
  const previousSittingOut: Set<number> = previousQuarter ? sittingOut.get(previousQuarter) || new Set<number>() : new Set<number>();

  // Calculate position changes between quarters
  // Absent/injured count as off the field, so a player back from an absence
  // shows as coming on (same rule as game day and the public page)
  const previousAbsentInjured: Map<number, string> = previousQuarter ? absentInjured.get(previousQuarter) || new Map() : new Map();
  const positionChanges = previousQuarter ? calculatePositionChanges(
    previousLineup,
    currentLineup,
    new Set([...previousSittingOut, ...previousAbsentInjured.keys()]),
    new Set([...currentSittingOut, ...currentAbsentInjured.keys()])
  ) : [];

  // Get absent/injured players for current quarter
  const absentInjuredPlayersForQuarter = players.filter((player: any) => currentAbsentInjured.has(player.id));

  // Get available players (not on field, not sitting out, not absent/injured)
  const availablePlayers = players.filter((player: any) => {
    // Check if player is on the field in current quarter
    const isOnField = Array.from(currentLineup.values()).some(assigned => assigned.playerId === player.id);
    // Check if player is sitting out
    const isSittingOut = currentSittingOut.has(player.id);
    // Check if player is absent/injured
    const isAbsentInjured = currentAbsentInjured.has(player.id);

    return !isOnField && !isSittingOut && !isAbsentInjured;
  });

  // Get sitting out players for current quarter (explicitly marked as subs)
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

  const getPlayerQuartersSittingOut = (playerId: number): number => {
    let count = 0;
    for (let q = 1; q <= totalQuarters; q++) {
      const qSitOuts = sittingOut.get(q) || new Set();
      if (qSitOuts.has(playerId)) {
        count++;
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

  const handleClearLineup = () => {
    if (confirm('Are you sure you want to clear the entire lineup? This will remove all player assignments from all quarters.')) {
      fetcher.submit(
        { _action: "clearLineup" },
        { method: "post" }
      );
    }
  };

  // Handle AI lineup acceptance
  const handleAcceptAILineup = (quarters: Array<{
    number: number;
    completed: boolean;
    players: Record<number, number>;
    substitutes?: Array<{ playerId: number; playerName: string }>;
  }>) => {
    // Build all assignments for bulk insert
    const allAssignments: any[] = [];

    quarters.forEach((quarter) => {
      // Add field position assignments
      Object.entries(quarter.players).forEach(([positionStr, playerId]) => {
        const positionNumber = parseInt(positionStr);
        const position = positions.find((p: any) => p.number === positionNumber);

        allAssignments.push({
          gameId: game.id,
          playerId: playerId,
          positionNumber: positionNumber,
          positionName: position?.abbreviation || '',
          quarter: quarter.number,
          isSittingOut: false,
        });
      });

      // Add sitting out assignments for substitutes
      if (quarter.substitutes && quarter.substitutes.length > 0) {
        quarter.substitutes.forEach((sub) => {
          allAssignments.push({
            gameId: game.id,
            playerId: sub.playerId,
            positionNumber: 0, // No position for sitting out
            positionName: '',
            quarter: quarter.number,
            isSittingOut: true,
          });
        });
      }
    });

    // Submit all assignments in a single request
    fetcher.submit(
      {
        _action: "bulkAssign",
        assignments: JSON.stringify(allAssignments),
      },
      { method: "post" }
    );

    // Update local state optimistically
    const newQuarterAssignments = new Map(quarterAssignments);
    const newSittingOut = new Map(sittingOut);

    quarters.forEach((quarter) => {
      const quarterLineup = new Map<number, any>();
      const quarterSubs = new Set<number>();

      // Add field position assignments
      Object.entries(quarter.players).forEach(([positionStr, playerId]) => {
        const positionNumber = parseInt(positionStr);
        const player = players.find((p: any) => p.id === playerId);

        if (player) {
          quarterLineup.set(positionNumber, {
            playerId: player.id,
            name: player.name,
          });
        }
      });

      // Add substitutes to sitting out set
      if (quarter.substitutes && quarter.substitutes.length > 0) {
        quarter.substitutes.forEach((sub) => {
          quarterSubs.add(sub.playerId);
        });
      }

      newQuarterAssignments.set(quarter.number, quarterLineup);
      newSittingOut.set(quarter.number, quarterSubs);
    });

    setQuarterAssignments(newQuarterAssignments);
    setSittingOut(newSittingOut);
  };
  
  return (
    <Page>
        {/* Header */}
        <header className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-primary">Lineup</div>
              {/* Title row is the tooltip's anchor so it stays on screen at phone width */}
              <div className="relative mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">vs {game.opponent}</h1>
                <HomeAwayBadge homeAway={game.homeAway} />
                <div>
                  <button
                    ref={instructionsButtonRef}
                    onClick={() => setShowInstructions(!showInstructions)}
                    aria-expanded={showInstructions}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-subtle transition hover:bg-surface-2 hover:text-ink"
                    aria-label="How to plan your lineup"
                  >
                    <Question size={20} />
                  </button>

                  {/* Instructions Tooltip */}
                  {showInstructions && (
                    <div
                      ref={instructionsRef}
                      className="absolute top-full left-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl bg-surface p-4 shadow-overlay ring-1 ring-line"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-ink">How to plan your lineup</h3>
                        <button
                          onClick={() => setShowInstructions(false)}
                          className="-mt-1 -mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink"
                          aria-label="Close"
                        >
                          <X size={16} weight="bold" />
                        </button>
                      </div>
                      <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted marker:text-subtle">
                        <li>Pick a quarter tab to plan that quarter's lineup</li>
                        <li><strong className="font-semibold text-ink">Drag</strong> players onto positions, or <strong className="font-semibold text-ink">click</strong> a name or position for a menu</li>
                        <li>Click a player on the field to move them or sit them out</li>
                        <li>Each player should play at least 2 quarters (AYSO fair play)</li>
                        <li>No player should sit out more than 1 quarter</li>
                        <li>Changes save as you make them</li>
                        <li>On the day, open <strong className="font-semibold text-ink">Game day</strong> for a sideline view of each quarter's changes</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted">{formatGameDateTime(game.gameDate, game.gameTime)}</span>
                <Badge tone="primary" className="tabular">
                  {team.format} · {currentFormationKey}
                </Badge>
              </div>
            </div>

            {/* Game day and the assistant up front; everything else in the menu */}
            <div className="flex items-center gap-2">
              <Link
                to={`/dashboard/team/${team.id}/games/${game.id}/game-day`}
                className={buttonClass({ variant: "secondary" })}
                title="Sideline view for during the game"
              >
                <Play size={18} weight="fill" className="text-primary" />
                Game day
              </Link>
              <button
                onClick={() => setShowAIAssistant(true)}
                className={buttonClass()}
                title="AI assistant coach"
              >
                <Sparkle size={18} weight="fill" />
                <span className="hidden sm:inline">AI assistant</span>
              </button>
              <LineupMenu
                gameCardHref={`/dashboard/team/${team.id}/games/${game.id}/game-card`}
                onShare={handleShare}
                onSummary={() => setShowOverview(true)}
                onClear={handleClearLineup}
              />
            </div>
          </div>
        </header>
        
        <QuarterTabs current={currentQuarter} onChange={setCurrentQuarter} className="mb-6" />

        {/* Main lineup content */}
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:gap-8">
            {/* Available Players and Substitutes */}
            <div className="order-2 space-y-6 lg:order-1 lg:col-span-1">
            {/* Available Players - Not yet assigned */}
            <Card className="p-3 sm:p-4">
              <CardHeader
                title={<>Available <span className="font-normal text-subtle">· Q{currentQuarter}</span></>}
                count={availablePlayers.length}
                className="mb-3 px-1"
              />
              <div
                className="min-h-[150px] rounded-xl bg-surface-2/60 p-1.5"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const playerData = e.dataTransfer.getData('player');
                  const fromPosition = e.dataTransfer.getData('fromPosition');
                  if (playerData && fromPosition) {
                    // Player is being dragged from a position to available
                    const player = JSON.parse(playerData);
                    handleClearPosition({ number: parseInt(fromPosition) });
                  }
                }}
              >
                <div className="space-y-1.5">
                  {availablePlayers.length > 0 ? (
                    availablePlayers.map((player: any) => {
                      const quartersSittingOut = getPlayerQuartersSittingOut(player.id);
                      const playerChange = getPlayerChange(player.id, positionChanges);

                      return (
                        <div key={player.id} className="flex items-center gap-1">
                          <div className="min-w-0 flex-1">
                            <PlayerCard
                              player={player}
                              onDragStart={handleDragStart}
                              onAssign={handlePositionAssignment}
                              availablePositions={getAvailablePositions()}
                              onSitOut={handleSitOut}
                              quartersPlaying={quartersSittingOut}
                              positionChange={playerChange}
                              showChangeIndicators={showChangeIndicators}
                            />
                          </div>
                          {/* Subs indicator and quick absent/injured/sub buttons */}
                          <span
                            className={cx("inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] font-bold tabular", sittingOutBadgeClass(quartersSittingOut))}
                            title={`Sitting out ${quartersSittingOut} of 4 quarters`}
                          >
                            {quartersSittingOut}/4
                          </span>
                          <button
                            onClick={() => handleMarkUnavailable(player)}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
                            title="Can't play: absent or injured"
                            aria-label={`Mark ${player.name} absent or injured`}
                          >
                            <UserMinus size={20} />
                          </button>
                          <button
                            onClick={() => handleSitOut(player)}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning transition hover:brightness-95"
                            title="Move to substitutes"
                            aria-label={`Move ${player.name} to substitutes`}
                          >
                            <ArrowDown size={20} weight="bold" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="py-10 text-center text-sm text-muted">
                      All players assigned
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {/* Subs - Sitting Out Players */}
            <Card className="p-3 sm:p-4">
              <CardHeader
                title={<>Substitutes <span className="font-normal text-subtle">· Q{currentQuarter}</span></>}
                count={sittingOutPlayers.length}
                className="mb-3 px-1"
              />
              <div
                className="min-h-[150px] rounded-xl bg-warning-soft/50 p-1.5 ring-1 ring-inset ring-warning/15"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const playerData = e.dataTransfer.getData('player');
                  const fromPosition = e.dataTransfer.getData('fromPosition');
                  if (playerData) {
                    const player = JSON.parse(playerData);
                    if (fromPosition) {
                      // Player is being dragged from a position - clear the position and sit them out
                      handleClearPosition({ number: parseInt(fromPosition) });
                    }
                    handleSitOut(player);
                  }
                }}
              >
                <div className="space-y-1.5">
                  {sittingOutPlayers.length > 0 ? (
                    sittingOutPlayers.map((player: any) => {
                      const quartersSittingOut = getPlayerQuartersSittingOut(player.id);
                      const playerChange = getPlayerChange(player.id, positionChanges);

                      return (
                        <div key={player.id} className="flex items-center gap-1">
                          <div className="min-w-0 flex-1">
                            <PlayerCard
                              player={player}
                              onDragStart={handleDragStart}
                              onAssign={handlePositionAssignment}
                              availablePositions={getAvailablePositions()}
                              onSitOut={handleSitOut}
                              quartersPlaying={quartersSittingOut}
                              positionChange={playerChange}
                              showChangeIndicators={showChangeIndicators}
                              isSittingOut={true}
                            />
                          </div>
                          {/* Subs indicator and quick absent/injured/available buttons */}
                          <span
                            className={cx("inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] font-bold tabular", sittingOutBadgeClass(quartersSittingOut))}
                            title={`Sitting out ${quartersSittingOut} of 4 quarters`}
                          >
                            {quartersSittingOut}/4
                          </span>
                          <button
                            onClick={() => handleMarkUnavailable(player)}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
                            title="Can't play: absent or injured"
                            aria-label={`Mark ${player.name} absent or injured`}
                          >
                            <UserMinus size={20} />
                          </button>
                          <button
                            onClick={() => handleUnsitPlayer(player.id)}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface text-muted ring-1 ring-line transition hover:bg-surface-2 hover:text-ink"
                            title="Move back to available"
                            aria-label={`Move ${player.name} back to available`}
                          >
                            <ArrowUp size={20} weight="bold" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="py-10 text-center text-sm text-warning">
                      No substitutes for this quarter
                    </p>
                  )}
                </div>
              </div>
            </Card>
            
            {/* Absent/Injured Players */}
            {absentInjuredPlayersForQuarter.length > 0 && (
              <Card className="p-3 sm:p-4">
                <CardHeader
                  title={<>Absent or injured <span className="font-normal text-subtle">· Q{currentQuarter}</span></>}
                  count={absentInjuredPlayersForQuarter.length}
                  className="mb-3 px-1"
                />
                <div className="space-y-1.5 rounded-xl bg-danger-soft/60 p-1.5 ring-1 ring-inset ring-danger/10">
                  {absentInjuredPlayersForQuarter.map((player: any) => {
                    const reason = currentAbsentInjured.get(player.id);
                    return (
                      <div key={player.id} className="flex items-center gap-2.5 rounded-xl bg-surface p-2 ring-1 ring-line/70">
                        <PlayerAvatar player={{ ...player, jerseyNumber: null }} size="sm" className="opacity-70" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-muted">{player.name}</div>
                          <div className="flex items-center gap-1 text-xs font-medium text-danger">
                            {reason === 'injured' ? <FirstAidKit size={12} /> : <UserMinus size={12} />}
                            <span className="capitalize">{reason}</span>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => handleClearAbsentInjured(player.id)}
                        >
                          Return to subs
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
          
          {/* Formation Field */}
          <div className="order-1 lg:order-2 lg:col-span-2">
            {/* Formation Selector */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                Formation <span className="font-normal text-subtle sm:hidden">· Q{currentQuarter}</span>
              </h2>
              <div className="flex items-center gap-2">
              {currentQuarter > 1 && (
                <button
                  onClick={() => setShowChangeIndicators(!showChangeIndicators)}
                  className={cx(
                    "inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition",
                    showChangeIndicators
                      ? "bg-warning-soft text-warning ring-1 ring-warning/30"
                      : "bg-surface text-muted shadow-card ring-1 ring-line/70 hover:text-ink"
                  )}
                  aria-pressed={showChangeIndicators}
                  title="Show what changed since last quarter"
                >
                  <ArrowsLeftRight size={18} weight={showChangeIndicators ? "bold" : "regular"} />
                  <span className="hidden sm:inline">Changes</span>
                </button>
              )}
              <div className="flex items-center gap-1 rounded-xl bg-surface p-1 shadow-card ring-1 ring-line/70">
                <button
                  onClick={handlePrevFormation}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
                  aria-label="Previous formation"
                >
                  <CaretLeft size={18} weight="bold" />
                </button>
                <span className="min-w-16 px-1 text-center font-display text-lg font-bold tabular">
                  {currentFormationKey}
                </span>
                <button
                  onClick={handleNextFormation}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
                  aria-label="Next formation"
                >
                  <CaretRight size={18} weight="bold" />
                </button>
              </div>
              </div>
            </div>

            {/* Position Change Legend */}
            {showChangeIndicators && positionChanges.length > 0 && currentQuarter > 1 && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-warning-soft py-1.5 pr-1.5 pl-3 text-sm text-warning">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-warning"></span>
                    Changes from Q{previousQuarter}
                  </span>
                  <span className="tabular">
                    {positionChanges.length} change{positionChanges.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => setShowChangeIndicators(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-warning/10"
                  title="Hide change indicators"
                  aria-label="Hide change indicators"
                >
                  <X size={16} weight="bold" />
                </button>
              </div>
            )}

            <Pitch className="h-[28rem] sm:h-[32rem]">
              {/* Position slots */}
              {formationPositions.map((position: any) => {
                const positionChangesForThisPosition = positionChanges.filter(change =>
                  change.toPosition === position.number || change.fromPosition === position.number
                );
                const hasChange = positionChangesForThisPosition.length > 0;
                const changeDescription = positionChangesForThisPosition
                  .map(change => getChangeDescription(change))
                  .join('; ');

                const assignedPlayer = currentLineup.get(position.number);
                const quartersSittingOut = assignedPlayer ? getPlayerQuartersSittingOut(assignedPlayer.playerId) : 0;

                return (
                  <PositionSlot
                    key={`${currentQuarter}-${currentFormationIndex}-${position.number}-${position.x}-${position.y}`}
                    position={position}
                    assignedPlayer={assignedPlayer}
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
                    quartersSittingOut={quartersSittingOut}
                    onPositionDragStart={handleDragStart}
                  />
                );
              })}
            </Pitch>
          </div>
          </div>
      
      {/* Phone quarter bar, fixed to the bottom above the iPhone home indicator */}
      <QuarterBar current={currentQuarter} onChange={setCurrentQuarter} />

      {/* Overview Modal Overlay */}
      {showOverview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-overlay">
            <div className="p-5 sm:p-6">
              {/* Modal Header */}
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight">Fair play summary</h2>
                  <p className="mt-1 text-sm text-muted">
                    Players marked absent or injured in any quarter are exempt from AYSO minimum playing time.
                  </p>
                </div>
                <button
                  onClick={() => setShowOverview(false)}
                  className="-mt-1 -mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
                  aria-label="Close"
                >
                  <X size={20} weight="bold" />
                </button>
              </div>
              
              {/* Summary Content */}
              <div className="space-y-6">
                <div className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                  {players
                    .map((player: any) => {
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

                      return { player, quarterCount, sitOutCount, absentInjuredCount };
                    })
                    .filter(({ absentInjuredCount }) => absentInjuredCount === 0)
                    .map(({ player, quarterCount, sitOutCount, absentInjuredCount }) => {
                      // AYSO compliance: minimum 2 quarters playing, max 1 quarter sitting (absent/injured doesn't count against AYSO rules)
                      const isCompliant = quarterCount >= 2 && sitOutCount <= 1;

                      return (
                        <div key={player.id} className={cx("flex items-center justify-between gap-3 px-4 py-3 text-sm", !isCompliant && "bg-danger-soft")}>
                          <span className="min-w-0 truncate font-medium">{player.name}</span>
                          <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                            <span className="text-muted tabular">
                              Playing <span className="font-semibold text-ink">{quarterCount}/4</span>
                              <span className="mx-1.5 text-line-strong">·</span>
                              Sitting <span className="font-semibold text-ink">{sitOutCount}/4</span>
                            </span>
                            {isCompliant ? (
                              <Badge tone="success">OK</Badge>
                            ) : (
                              <Badge tone="danger">
                                <Warning size={12} weight="bold" />
                                Non-compliant
                              </Badge>
                            )}
                          </span>
                        </div>
                      );
                    })}
                </div>

                {/* Exempt Players Section */}
                {players.some((player: any) => {
                  let absentInjuredCount = 0;
                  for (let q = 1; q <= totalQuarters; q++) {
                    const qAbsentInjured = absentInjured.get(q) || new Map();
                    if (qAbsentInjured.has(player.id)) absentInjuredCount++;
                  }
                  return absentInjuredCount > 0;
                }) && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-muted">Exempt players</h3>
                    <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface-2">
                      {players
                        .map((player: any) => {
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

                          return { player, quarterCount, sitOutCount, absentInjuredCount };
                        })
                        .filter(({ absentInjuredCount }) => absentInjuredCount > 0)
                        .map(({ player, quarterCount, sitOutCount, absentInjuredCount }) => (
                          <div key={player.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
                            <span className="min-w-0 truncate font-medium text-ink">{player.name}</span>
                            <span className="shrink-0 text-right tabular">
                              <div>Playing {quarterCount}/4 · Sitting {sitOutCount}/4</div>
                              <div className="text-xs">Absent or injured {absentInjuredCount}/4</div>
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                
                <Alert tone="primary">
                  <h3 className="mb-1.5 font-semibold">AYSO fair play rules</h3>
                  <ul className="list-disc space-y-1 pl-4 text-xs">
                    <li>Each player must play at least 2 quarters</li>
                    <li>No player should sit out more than 1 quarter</li>
                    <li>Absent or injured players are excluded from these requirements</li>
                  </ul>
                </Alert>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-overlay sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">Share lineup</h2>
                <p className="mt-1 text-sm text-muted">
                  Send this link to your team so they can see the lineup.
                </p>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="-mt-1 -mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
                aria-label="Close"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            <div className="space-y-4">
              {shareUrl && (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={shareUrl}
                      readOnly
                      className={cx(inputClass, "min-w-0 flex-1")}
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <Button onClick={handleCopyShareLink}>
                      <Copy size={18} />
                      Copy
                    </Button>
                  </div>

                  <ul className="space-y-1.5 text-xs text-muted">
                    <li className="flex items-center gap-2">
                      <LinkIcon size={14} className="shrink-0 text-subtle" />
                      This link expires in 24 hours
                    </li>
                    <li className="flex items-center gap-2">
                      <Eye size={14} className="shrink-0 text-subtle" />
                      Anyone with the link can view the lineup, but not edit it
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Can't play sheet: why, and for which quarters */}
      {showAbsentInjuredModal && absentInjuredModalData && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={closeUnavailableSheet}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unavailable-title"
            className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-overlay sm:rounded-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id="unavailable-title" className="font-display text-2xl font-bold tracking-tight">
                {absentInjuredModalData.player.name} can't play
              </h2>
              <button
                onClick={closeUnavailableSheet}
                className="-mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
                aria-label="Close"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            {/* Reason */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Reason">
              {(['absent', 'injured'] as const).map((reason) => (
                <button
                  key={reason}
                  role="radio"
                  aria-checked={unavailableReason === reason}
                  onClick={() => setUnavailableReason(reason)}
                  className={cx(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition",
                    unavailableReason === reason ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"
                  )}
                >
                  {reason === 'absent' ? <UserMinus size={18} /> : <FirstAidKit size={18} />}
                  {reason === 'absent' ? 'Absent' : 'Injured'}
                </button>
              ))}
            </div>

            {/* How long */}
            <div className="mt-5 flex flex-col gap-2">
              {currentQuarter < 4 && (
                <Button
                  size="lg"
                  onClick={() => {
                    const rest = [1, 2, 3, 4].filter((q) => q >= currentQuarter);
                    applyAbsentInjured(absentInjuredModalData.player, unavailableReason, rest);
                    closeUnavailableSheet();
                  }}
                >
                  {currentQuarter === 1 ? 'Whole game' : `Q${currentQuarter} to the end`}
                </Button>
              )}
              <Button
                size="lg"
                variant={currentQuarter < 4 ? "secondary" : "primary"}
                onClick={() => {
                  applyAbsentInjured(absentInjuredModalData.player, unavailableReason, [currentQuarter]);
                  closeUnavailableSheet();
                }}
              >
                Just Q{currentQuarter}
              </Button>
              <Button size="lg" variant="ghost" onClick={closeUnavailableSheet}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Coach Modal */}
      <AIAssistantCoach
        isOpen={showAIAssistant}
        onClose={() => setShowAIAssistant(false)}
        gameId={game.id}
        teamId={team.id}
        onAcceptLineup={handleAcceptAILineup}
      />
    </Page>
  );
}
