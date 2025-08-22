import type { Route } from "./+types/team.games.game.lineup";
import { data, useFetcher } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games, players, assignments, positions } from "~/db";
import { eq, and, or } from "drizzle-orm";
import { getImageUrl } from "~/utils/image";
import { useState, useEffect, useRef } from "react";

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
  
  return data({
    team,
    game,
    players: teamPlayers,
    positions: availablePositions,
    assignments: existingAssignments,
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

// Formation templates
const formations11v11 = {
  '4-4-2': {
    name: '4-4-2 Classic',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' }, // Goalkeeper
      { number: 2, x: 80, y: 25, abbreviation: 'RB' }, // Right Back
      { number: 3, x: 20, y: 25, abbreviation: 'LB' }, // Left Back
      { number: 4, x: 42, y: 25, abbreviation: 'CB' }, // Center Back
      { number: 5, x: 58, y: 25, abbreviation: 'CB' }, // Center Back
      { number: 7, x: 85, y: 50, abbreviation: 'RM' }, // Right Mid
      { number: 6, x: 42, y: 50, abbreviation: 'CM' }, // Central Mid
      { number: 8, x: 58, y: 50, abbreviation: 'CM' }, // Central Mid
      { number: 11, x: 15, y: 50, abbreviation: 'LM' }, // Left Mid
      { number: 9, x: 40, y: 75, abbreviation: 'ST' }, // Striker
      { number: 10, x: 60, y: 75, abbreviation: 'ST' }, // Striker
    ],
  },
  '4-3-3': {
    name: '4-3-3 Attack',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 80, y: 25, abbreviation: 'RB' },
      { number: 3, x: 20, y: 25, abbreviation: 'LB' },
      { number: 4, x: 42, y: 25, abbreviation: 'CB' },
      { number: 5, x: 58, y: 25, abbreviation: 'CB' },
      { number: 6, x: 50, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 35, y: 55, abbreviation: 'CM' },
      { number: 10, x: 65, y: 55, abbreviation: 'CM' },
      { number: 7, x: 75, y: 75, abbreviation: 'RW' },
      { number: 11, x: 25, y: 75, abbreviation: 'LW' },
      { number: 9, x: 50, y: 80, abbreviation: 'ST' },
    ],
  },
  '3-5-2': {
    name: '3-5-2 Wing',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 4, x: 50, y: 25, abbreviation: 'CB' },
      { number: 5, x: 35, y: 25, abbreviation: 'CB' },
      { number: 3, x: 65, y: 25, abbreviation: 'CB' },
      { number: 2, x: 88, y: 50, abbreviation: 'RWB' },
      { number: 11, x: 12, y: 50, abbreviation: 'LWB' },
      { number: 6, x: 50, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 38, y: 55, abbreviation: 'CM' },
      { number: 10, x: 62, y: 55, abbreviation: 'CM' },
      { number: 9, x: 40, y: 75, abbreviation: 'ST' },
      { number: 7, x: 60, y: 75, abbreviation: 'ST' },
    ],
  },
  '4-1-4-1': {
    name: '4-1-4-1 Diamond',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 80, y: 25, abbreviation: 'RB' },
      { number: 3, x: 20, y: 25, abbreviation: 'LB' },
      { number: 4, x: 42, y: 25, abbreviation: 'CB' },
      { number: 5, x: 58, y: 25, abbreviation: 'CB' },
      { number: 6, x: 50, y: 42, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 55, abbreviation: 'RM' },
      { number: 8, x: 42, y: 52, abbreviation: 'CM' },
      { number: 11, x: 25, y: 55, abbreviation: 'LM' },
      { number: 10, x: 58, y: 52, abbreviation: 'CM' },
      { number: 9, x: 50, y: 80, abbreviation: 'ST' },
    ],
  },
  '4-2-3-1': {
    name: '4-2-3-1',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 80, y: 25, abbreviation: 'RB' },
      { number: 3, x: 20, y: 25, abbreviation: 'LB' },
      { number: 4, x: 42, y: 25, abbreviation: 'CB' },
      { number: 5, x: 58, y: 25, abbreviation: 'CB' },
      { number: 6, x: 42, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 45, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 65, abbreviation: 'RW' },
      { number: 10, x: 50, y: 65, abbreviation: 'CAM' },
      { number: 11, x: 25, y: 65, abbreviation: 'LW' },
      { number: 9, x: 50, y: 80, abbreviation: 'ST' },
    ],
  },
  '4-3-2-1': {
    name: '4-3-2-1 Christmas Tree',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 80, y: 25, abbreviation: 'RB' },
      { number: 3, x: 20, y: 25, abbreviation: 'LB' },
      { number: 4, x: 42, y: 25, abbreviation: 'CB' },
      { number: 5, x: 58, y: 25, abbreviation: 'CB' },
      { number: 6, x: 50, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 35, y: 50, abbreviation: 'CM' },
      { number: 7, x: 65, y: 50, abbreviation: 'CM' },
      { number: 10, x: 42, y: 65, abbreviation: 'CAM' },
      { number: 11, x: 58, y: 65, abbreviation: 'CAM' },
      { number: 9, x: 50, y: 80, abbreviation: 'ST' },
    ],
  },
  '5-3-2': {
    name: '5-3-2 Defensive',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 88, y: 30, abbreviation: 'RWB' },
      { number: 3, x: 12, y: 30, abbreviation: 'LWB' },
      { number: 4, x: 35, y: 22, abbreviation: 'CB' },
      { number: 5, x: 50, y: 22, abbreviation: 'CB' },
      { number: 6, x: 65, y: 22, abbreviation: 'CB' },
      { number: 8, x: 50, y: 50, abbreviation: 'CM' },
      { number: 7, x: 62, y: 50, abbreviation: 'CM' },
      { number: 11, x: 38, y: 50, abbreviation: 'CM' },
      { number: 9, x: 40, y: 75, abbreviation: 'ST' },
      { number: 10, x: 60, y: 75, abbreviation: 'ST' },
    ],
  },
};

const formations9v9 = {
  '3-3-2': {
    name: '3-3-2 Balanced',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 65, y: 25, abbreviation: 'RB' },
      { number: 3, x: 35, y: 25, abbreviation: 'LB' },
      { number: 4, x: 50, y: 25, abbreviation: 'CB' },
      { number: 6, x: 50, y: 45, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 55, abbreviation: 'RM' },
      { number: 8, x: 25, y: 55, abbreviation: 'LM' },
      { number: 10, x: 50, y: 65, abbreviation: 'CAM' },
      { number: 9, x: 50, y: 80, abbreviation: 'CF' },
    ],
  },
  '3-2-3': {
    name: '3-2-3 Attack',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 65, y: 25, abbreviation: 'RB' },
      { number: 3, x: 35, y: 25, abbreviation: 'LB' },
      { number: 4, x: 50, y: 25, abbreviation: 'CB' },
      { number: 6, x: 42, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 45, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 70, abbreviation: 'RW' },
      { number: 11, x: 25, y: 70, abbreviation: 'LW' },
      { number: 9, x: 50, y: 80, abbreviation: 'CF' },
    ],
  },
  '2-4-2': {
    name: '2-4-2 Midfield',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 4, x: 42, y: 25, abbreviation: 'CB' },
      { number: 5, x: 58, y: 25, abbreviation: 'CB' },
      { number: 2, x: 80, y: 50, abbreviation: 'RM' },
      { number: 3, x: 20, y: 50, abbreviation: 'LM' },
      { number: 6, x: 42, y: 50, abbreviation: 'CM' },
      { number: 8, x: 58, y: 50, abbreviation: 'CM' },
      { number: 9, x: 40, y: 75, abbreviation: 'ST' },
      { number: 10, x: 60, y: 75, abbreviation: 'ST' },
    ],
  },
  '4-2-2': {
    name: '4-2-2 Defensive',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 75, y: 25, abbreviation: 'RB' },
      { number: 3, x: 25, y: 25, abbreviation: 'LB' },
      { number: 4, x: 44, y: 25, abbreviation: 'CB' },
      { number: 5, x: 56, y: 25, abbreviation: 'CB' },
      { number: 6, x: 42, y: 50, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 50, abbreviation: 'CDM' },
      { number: 9, x: 40, y: 75, abbreviation: 'ST' },
      { number: 10, x: 60, y: 75, abbreviation: 'ST' },
    ],
  },
  '3-1-3-1': {
    name: '3-1-3-1 Diamond',
    positions: [
      { number: 1, x: 50, y: 8, abbreviation: 'GK' },
      { number: 2, x: 65, y: 25, abbreviation: 'RB' },
      { number: 3, x: 35, y: 25, abbreviation: 'LB' },
      { number: 4, x: 50, y: 25, abbreviation: 'CB' },
      { number: 6, x: 50, y: 42, abbreviation: 'CDM' },
      { number: 7, x: 70, y: 55, abbreviation: 'RM' },
      { number: 8, x: 30, y: 55, abbreviation: 'LM' },
      { number: 10, x: 50, y: 60, abbreviation: 'CAM' },
      { number: 9, x: 50, y: 80, abbreviation: 'CF' },
    ],
  },
};

function PlayerCard({ 
  player, 
  onDragStart, 
  onAssign,
  availablePositions,
  onSitOut
}: { 
  player: any; 
  onDragStart: (player: any) => void;
  onAssign?: (player: any, position: any) => void;
  availablePositions?: any[];
  onSitOut?: (player: any) => void;
}) {
  const preferredPositions = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('player', JSON.stringify(player));
    onDragStart(player);
  };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAssign && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const dropdownWidth = 192; // 48 * 4 (w-48)
      const dropdownHeight = 200; // Approximate dropdown height
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const spaceRight = viewportWidth - rect.left;
      
      // Position dropdown above if not enough space below
      const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove > dropdownHeight;
      
      // Adjust horizontal position if dropdown would go off-screen
      let leftPosition = rect.left + window.scrollX;
      if (spaceRight < dropdownWidth) {
        leftPosition = rect.right + window.scrollX - dropdownWidth;
      }
      
      setDropdownPosition({
        top: shouldPositionAbove 
          ? rect.top + window.scrollY - dropdownHeight - 4
          : rect.bottom + window.scrollY + 4,
        left: leftPosition
      });
      setShowDropdown(!showDropdown);
    }
  };
  
  const handlePositionSelect = (position: any) => {
    if (onAssign) {
      onAssign(player, position);
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
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);
  
  return (
    <>
      <div
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onClick={handleClick}
        className="flex items-center gap-2 p-2 border border-[var(--border)] rounded bg-[var(--surface)] cursor-pointer hover:shadow-md transition-shadow active:cursor-grabbing"
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
          <div className="font-medium text-sm truncate">{player.name}</div>
          {preferredPositions.length > 0 && (
            <div className="text-xs text-[var(--muted)] truncate">
              {preferredPositions.slice(0, 3).join(', ')}
            </div>
          )}
        </div>
      </div>
      
      {/* Position Selection Dropdown */}
      {showDropdown && availablePositions && (
        <div 
          ref={dropdownRef}
          className="fixed z-[9999] w-48 bg-white border border-[var(--border)] rounded-lg shadow-xl"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`
          }}
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
    </>
  );
}

function PositionSlot({ 
  position, 
  assignedPlayer, 
  onDrop, 
  onClear,
  onSitOut,
  availablePlayers,
  onAssignPlayer
}: { 
  position: any; 
  assignedPlayer: any; 
  onDrop: (position: any, player: any) => void;
  onClear: (position: any) => void;
  onSitOut?: (player: any) => void;
  availablePlayers?: any[];
  onAssignPlayer?: (position: any, player: any) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
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
    setShowDropdown(!showDropdown);
  };
  
  const handlePlayerSelect = (player: any) => {
    if (onAssignPlayer) {
      onAssignPlayer(position, player);
    }
    setShowDropdown(false);
  };
  
  const handleSitOutClick = () => {
    if (onSitOut && assignedPlayer) {
      const player = { id: assignedPlayer.playerId, name: assignedPlayer.name };
      onSitOut(player);
    }
    setShowDropdown(false);
  };
  
  const handleClearClick = () => {
    onClear(position);
    setShowDropdown(false);
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);
  
  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <div className="relative">
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
          className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
            assignedPlayer
              ? 'bg-[var(--primary)] border-[var(--primary)] text-white hover:bg-[var(--primary-600)]'
              : 'bg-[var(--surface)] border-[var(--border)] border-dashed hover:border-[var(--primary)]'
          }`}
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
        
        {/* Hover tooltip for assigned player */}
        {assignedPlayer && !showDropdown && (
          <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs rounded px-2 py-1 opacity-0 hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {assignedPlayer.name}
          </div>
        )}
        
        {/* Dropdown Menu */}
        {showDropdown && (
          <div 
            ref={dropdownRef}
            className="absolute z-[9999] mt-1 left-1/2 transform -translate-x-1/2 w-48 bg-white border border-[var(--border)] rounded-lg shadow-xl"
          >
            <div className="p-2">
              {assignedPlayer ? (
                <>
                  <div className="text-xs font-semibold text-[var(--muted)] px-2 py-1">
                    {assignedPlayer.name}
                  </div>
                  <button
                    onClick={handleClearClick}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--bg)] transition"
                  >
                    ↩️ Remove from Position
                  </button>
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
                        No available players
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
  const { team, game, players, positions, assignments } = loaderData;
  const fetcher = useFetcher();
  const [draggedPlayer, setDraggedPlayer] = useState<any>(null);
  const [currentQuarter, setCurrentQuarter] = useState(1);
  const [quarterAssignments, setQuarterAssignments] = useState<Map<number, Map<number, any>>>(new Map());
  const [sittingOut, setSittingOut] = useState<Map<number, Set<number>>>(new Map());
  const [showInstructions, setShowInstructions] = useState(false);
  const instructionsRef = useRef<HTMLDivElement>(null);
  const instructionsButtonRef = useRef<HTMLButtonElement>(null);
  
  // Formation state per quarter
  const formationOptions = team.format === '9v9' ? formations9v9 : formations11v11;
  const formationKeys = Object.keys(formationOptions);
  const [quarterFormations, setQuarterFormations] = useState<Map<number, number>>(new Map());
  
  // Get current quarter's formation
  const currentFormationIndex = quarterFormations.get(currentQuarter) ?? 0;
  const currentFormationKey = formationKeys[currentFormationIndex];
  const currentFormation = (formationOptions as any)[currentFormationKey];
  const formationPositions = currentFormation?.positions || [];
  
  const totalQuarters = 4; // Standard for AYSO games
  
  const handlePrevFormation = () => {
    const newIndex = currentFormationIndex === 0 ? formationKeys.length - 1 : currentFormationIndex - 1;
    const newQuarterFormations = new Map(quarterFormations);
    newQuarterFormations.set(currentQuarter, newIndex);
    setQuarterFormations(newQuarterFormations);
  };
  
  const handleNextFormation = () => {
    const newIndex = (currentFormationIndex + 1) % formationKeys.length;
    const newQuarterFormations = new Map(quarterFormations);
    newQuarterFormations.set(currentQuarter, newIndex);
    setQuarterFormations(newQuarterFormations);
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
    
    // Initialize all quarters
    for (let q = 1; q <= totalQuarters; q++) {
      quarterMap.set(q, new Map());
      sitOutMap.set(q, new Set());
    }
    
    // Load existing assignments
    assignments.forEach((assignment: any) => {
      const quarter = assignment.quarter || 1;
      const player = players.find((p: any) => p.id === assignment.playerId);
      
      if (assignment.isSittingOut) {
        const quarterSitOuts = sitOutMap.get(quarter) || new Set();
        quarterSitOuts.add(assignment.playerId);
        sitOutMap.set(quarter, quarterSitOuts);
      } else {
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
  }, [assignments, players]);
  
  const handleDragStart = (player: any) => {
    setDraggedPlayer(player);
  };
  
  const handlePositionAssignment = (position: any, player: any) => {
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
  };
  
  const handleClearPosition = (position: any) => {
    const newQuarterAssignments = new Map(quarterAssignments);
    const currentLineup = newQuarterAssignments.get(currentQuarter) || new Map();
    currentLineup.delete(position.number);
    newQuarterAssignments.set(currentQuarter, currentLineup);
    setQuarterAssignments(newQuarterAssignments);
  };
  
  const handleSitOut = (player: any) => {
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
  };
  
  const handleUnsitPlayer = (playerId: number) => {
    const newSittingOut = new Map(sittingOut);
    const quarterSitOuts = newSittingOut.get(currentQuarter) || new Set();
    quarterSitOuts.delete(playerId);
    newSittingOut.set(currentQuarter, quarterSitOuts);
    setSittingOut(newSittingOut);
  };
  
  const handleSaveLineup = () => {
    const allAssignments: any[] = [];
    
    // Convert all quarter assignments to array format
    for (let quarter = 1; quarter <= totalQuarters; quarter++) {
      const quarterLineup = quarterAssignments.get(quarter) || new Map();
      const quarterSitOuts = sittingOut.get(quarter) || new Set();
      
      // Add field positions
      for (const [positionNumber, assignment] of quarterLineup.entries()) {
        allAssignments.push({
          playerId: assignment.playerId,
          positionNumber,
          positionName: formationPositions.find((p: any) => p.number === positionNumber)?.abbreviation || '',
          quarter,
          isSittingOut: false,
        });
      }
      
      // Add sitting out players
      for (const playerId of quarterSitOuts) {
        allAssignments.push({
          playerId,
          positionNumber: 0,
          positionName: 'SUB',
          quarter,
          isSittingOut: true,
        });
      }
    }
    
    fetcher.submit(
      {
        _action: "saveLineup",
        lineupData: JSON.stringify({ assignments: allAssignments }),
      },
      { method: "post" }
    );
  };
  
  // Get current quarter data
  const currentLineup = quarterAssignments.get(currentQuarter) || new Map();
  const currentSittingOut = sittingOut.get(currentQuarter) || new Set();
  
  // Get available players (not assigned and not sitting out in current quarter)
  const assignedPlayerIds = new Set(Array.from(currentLineup.values()).map(a => a.playerId));
  const availablePlayers = players.filter((player: any) => 
    !assignedPlayerIds.has(player.id) && !currentSittingOut.has(player.id)
  );
  
  // Get sitting out players for current quarter
  const sittingOutPlayers = players.filter((player: any) => currentSittingOut.has(player.id));
  
  // Get available positions for current quarter (not already assigned)
  const getAvailablePositions = () => {
    return formationPositions.filter((pos: any) => !currentLineup.has(pos.number));
  };
  
  return (
    <div className="py-8">
      <div className="container mx-auto px-6 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
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
        
        {/* Quarter Tabs */}
        <div className="mb-6">
          <div className="border-b border-[var(--border)]">
            <nav className="-mb-px flex space-x-4">
              {[1, 2, 3, 4].map((quarter) => {
                const quarterFormationIndex = quarterFormations.get(quarter) ?? 0;
                const quarterFormationKey = formationKeys[quarterFormationIndex];
                const quarterFormation = (formationOptions as any)[quarterFormationKey];
                
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
                    <div className="flex flex-col items-center">
                      <span>Quarter {quarter}</span>
                      <span className="text-xs opacity-75">{quarterFormation?.name || formationKeys[0].replace(/-/g, ' ')}</span>
                    </div>
                    {(quarterAssignments.get(quarter)?.size || 0) > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-[var(--primary)] text-white">
                        {quarterAssignments.get(quarter)?.size || 0}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
        
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Available Players */}
          <div className="lg:col-span-1 space-y-6">
            {/* Available Players */}
            <div>
              <h2 className="text-lg font-semibold mb-4">Available Players</h2>
              <div className="space-y-2 border border-[var(--border)] rounded-lg p-2">
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {availablePlayers.length > 0 ? (
                    availablePlayers.map((player: any) => (
                      <PlayerCard 
                        key={player.id}
                        player={player} 
                        onDragStart={handleDragStart}
                        onAssign={handlePositionAssignment}
                        availablePositions={getAvailablePositions()}
                        onSitOut={handleSitOut}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-[var(--muted)] text-center py-4">
                      All players assigned or sitting out
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Sitting Out */}
            <div>
              <h2 className="text-lg font-semibold mb-4">Sitting Out - Q{currentQuarter}</h2>
              <div className="space-y-2 min-h-[100px] border border-dashed border-red-300 rounded-lg p-2 bg-red-50">
                {sittingOutPlayers.length > 0 ? (
                  sittingOutPlayers.map((player: any) => (
                    <div key={player.id} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 p-2 border border-red-200 rounded bg-white">
                        {getImageUrl(player.profilePicture) ? (
                          <img
                            src={getImageUrl(player.profilePicture)!}
                            alt={player.name}
                            className="w-6 h-6 rounded-full object-cover border border-[var(--border)]"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-[var(--bg)] flex items-center justify-center text-xs font-semibold text-[var(--muted)]">
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm font-medium">{player.name}</span>
                      </div>
                      <button
                        onClick={() => handleUnsitPlayer(player.id)}
                        className="px-2 py-1 text-xs rounded border border-green-300 bg-green-100 text-green-700 hover:bg-green-200 transition"
                      >
                        Return
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-red-600 text-center py-4">
                    No players sitting out this quarter
                  </p>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">
                AYSO Fair Play: Players should not sit out more than one quarter
              </p>
            </div>
            
            {/* Playing Time Summary */}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="text-sm font-medium text-green-800 mb-2">Playing Time Summary</h3>
              <div className="space-y-1">
                {players.map((player: any) => {
                  let quarterCount = 0;
                  let sitOutCount = 0;
                  for (let q = 1; q <= totalQuarters; q++) {
                    const qLineup = quarterAssignments.get(q) || new Map();
                    const qSitOuts = sittingOut.get(q) || new Set();
                    
                    const isPlaying = Array.from(qLineup.values()).some(a => a.playerId === player.id);
                    const isSittingOut = qSitOuts.has(player.id);
                    
                    if (isPlaying) quarterCount++;
                    if (isSittingOut) sitOutCount++;
                  }
                  
                  const isCompliant = quarterCount >= 2 && sitOutCount <= 1;
                  
                  return (
                    <div key={player.id} className={`text-xs flex justify-between ${!isCompliant ? 'text-red-700' : 'text-green-700'}`}>
                      <span>{player.name}</span>
                      <span>
                        Playing: {quarterCount}/4 | Sitting: {sitOutCount}/4
                        {!isCompliant && ' ⚠️'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Save Lineup */}
            <div className="pt-4 border-t border-[var(--border)]">
              <button
                onClick={handleSaveLineup}
                disabled={fetcher.state !== "idle"}
                className="w-full inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fetcher.state !== "idle" ? "Saving..." : "Save All Quarters"}
              </button>
              
              {fetcher.data?.success && (
                <div className="mt-2 text-sm text-green-600 text-center">
                  {fetcher.data.message}
                </div>
              )}
              
              {fetcher.data?.error && (
                <div className="mt-2 text-sm text-red-600 text-center">
                  {fetcher.data.error}
                </div>
              )}
            </div>
          </div>
          
          {/* Formation Field */}
          <div className="lg:col-span-2">
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
                <span className="px-3 py-1 min-w-[140px] text-center text-sm font-medium border border-[var(--border)] rounded bg-[var(--surface)]">
                  Q{currentQuarter}: {currentFormation?.name || 'Default'}
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
            <div className="relative bg-green-700 rounded-lg" style={{ aspectRatio: '3/2', minHeight: '400px' }}>
              {/* Field markings */}
              <div className="absolute inset-3 border-2 border-white rounded">
                {/* Center line */}
                <div className="absolute top-1/2 left-0 right-0 border-t-2 border-white"></div>
                {/* Center circle */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 border-2 border-white rounded-full"></div>
                {/* Top penalty area */}
                <div className="absolute top-0 left-1/3 w-1/3 h-12 border-b-2 border-l-2 border-r-2 border-white"></div>
                {/* Top goal area */}
                <div className="absolute top-0 left-[40%] w-1/5 h-6 border-b-2 border-l-2 border-r-2 border-white"></div>
                {/* Bottom penalty area */}
                <div className="absolute bottom-0 left-1/3 w-1/3 h-12 border-t-2 border-l-2 border-r-2 border-white"></div>
                {/* Bottom goal area */}
                <div className="absolute bottom-0 left-[40%] w-1/5 h-6 border-t-2 border-l-2 border-r-2 border-white"></div>
              </div>
              
              {/* Position slots */}
              {formationPositions.map((position: any) => (
                <PositionSlot
                  key={`${currentQuarter}-${currentFormationIndex}-${position.number}-${position.x}-${position.y}`}
                  position={position}
                  assignedPlayer={currentLineup.get(position.number)}
                  onDrop={handlePositionAssignment}
                  onClear={handleClearPosition}
                  onSitOut={handleSitOut}
                  availablePlayers={availablePlayers}
                  onAssignPlayer={handlePositionAssignment}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}