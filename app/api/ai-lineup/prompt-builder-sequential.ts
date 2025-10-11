// Prompt building for sequential quarter-by-quarter planning
import type {
  PlayerContext,
  QuarterFormationInfo,
  GameFormat,
  QuarterPlanningContext,
  AbsentInjuredContext
} from './types';
import { getAgeSpecificRules } from './prompt-builder';

export function buildQuarterSystemPrompt(params: {
  format: GameFormat;
  totalPlayers: number;
  positionsPerQuarter: number;
  quarterNumber: number;
  quartersRemaining: number;
}): string {
  const { format, totalPlayers, positionsPerQuarter, quarterNumber, quartersRemaining } = params;
  const ageSpecificRules = getAgeSpecificRules(format);

  return `You are an expert AYSO soccer coach assistant planning Quarter ${quarterNumber} of 4.

          AGE SPECIFIC RULES:
          ${ageSpecificRules}

          FIELD FORMAT:
          ${format}

          ⚠️ CRITICAL CONSTRAINTS FOR THIS QUARTER:
          1. Must fill ALL ${positionsPerQuarter} field positions
          2. Must-play players (if any) MUST be assigned to positions
          3. All other positions can be filled with any available players
          4. GOALKEEPER CONSECUTIVE RULE: If a player was GK in the previous quarter (Q${quarterNumber - 1}), they MUST be GK again in Q${quarterNumber} to maintain consecutive goalkeeper quarters

          🚨 ERROR HANDLING:
          If you CANNOT create a valid lineup (not enough eligible players, impossible to meet constraints, etc.):
          - Set error: true
          - Provide errorMessage explaining why
          - Do NOT provide quarter data

          🎯 POSITION ASSIGNMENT STRATEGY:
          - Each player has "positionHistory" showing specific position experience (e.g., {"RB": 12, "CB": 4})
          - ALWAYS assign players to their MOST FREQUENT position from history
          - Example: {"RB": 12, "CB": 4, "LB": 1} → assign to RB
          - Position abbreviations match the "Position mapping" provided
          - If positionHistory is null, use preferredPositions
          - CONSISTENCY: When possible, keep players in the same position they played in previous quarters of THIS GAME for continuity


          Return the quarter lineup if possible, or an error if constraints cannot be met.`;
}

export function buildQuarterUserMessage(params: {
  userInput: string;
  quarterNumber: number;
  quartersRemaining: number;
  formationContext: string;
  playersContext: PlayerContext[];
  remainingQuartersNeeded: Record<number, number>;
  previousQuarters: QuarterPlanningContext['previousQuarters'];
  positionsPerQuarter: number;
  mustPlayPlayerIds: number[];
  absentInjuredContext: AbsentInjuredContext[];
  quarterFormationInfo: Record<number, { positions: Array<{ number: number; abbreviation: string }> }>;
}): string {
  const {
    userInput,
    quarterNumber,
    quartersRemaining,
    formationContext,
    playersContext,
    previousQuarters,
    positionsPerQuarter,
    mustPlayPlayerIds,
    absentInjuredContext,
    quarterFormationInfo
  } = params;

  // Build previous quarters context with position details
  let previousQuartersContext = '';
  let previousGoalkeeper: { playerId: number; playerName: string; quarter: number } | null = null;

  if (previousQuarters.length > 0) {
    previousQuartersContext = `\n\n📅 PREVIOUS QUARTERS:\n`;
    previousQuarters.forEach(pq => {
      const formationInfo = quarterFormationInfo[pq.number];
      previousQuartersContext += `\nQ${pq.number} Assignments:\n`;

      // Show position assignments with position names
      pq.assignments.forEach(assignment => {
        const player = playersContext.find(p => p.id === assignment.playerId);
        const positionObj = formationInfo?.positions.find((p: any) => p.number === assignment.positionNumber);
        const positionName = positionObj?.abbreviation || `Pos${assignment.positionNumber}`;
        previousQuartersContext += `  - ${positionName} (${assignment.positionNumber}): ${player?.name || 'Unknown'} (ID: ${assignment.playerId})\n`;

        // Track goalkeeper from previous quarter
        if (assignment.positionNumber === 1 && pq.number === quarterNumber - 1) {
          previousGoalkeeper = {
            playerId: assignment.playerId,
            playerName: player?.name || 'Unknown',
            quarter: pq.number
          };
        }
      });

      // Show who sat out
      if (pq.substitutes.length > 0) {
        const substituteNames = pq.substitutes.map(id => {
          const player = playersContext.find(p => p.id === id);
          return `${player?.name || 'Unknown'} (${id})`;
        }).join(', ');
        previousQuartersContext += `  SAT OUT: ${substituteNames}\n`;
      }
    });
  }

  // Build absent/injured context
  let absentInjuredSection = '';
  if (absentInjuredContext.length > 0) {
    absentInjuredSection = `\n\n🚫 ABSENT/INJURED PLAYERS (DO NOT ASSIGN):\n`;
    absentInjuredContext.forEach(ai => {
      const player = playersContext.find(p => p.id === ai.playerId);
      const quarterInfo = ai.quarter ? ` for Q${ai.quarter}` : ' for all quarters';
      absentInjuredSection += `  - ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}\n`;
    });
  }

  // Get all players who have sat out at any point (cumulative tracking for context)
  const allPlayersWhoSatOut = new Set<number>();
  previousQuarters.forEach(pq => {
    pq.substitutes.forEach(id => allPlayersWhoSatOut.add(id));
  });

  // Separate into immediate must-play (from last quarter) and others who sat out earlier
  const mustPlayPlayers = mustPlayPlayerIds.map(id => {
    const player = playersContext.find(p => p.id === id);
    return { id, name: player?.name || 'Unknown' };
  });

  // Get other players who sat out in earlier quarters (not last quarter)
  const otherPlayersWhoSatOut = Array.from(allPlayersWhoSatOut)
    .filter(id => !mustPlayPlayerIds.includes(id))
    .map(id => {
      const player = playersContext.find(p => p.id === id);
      return { id, name: player?.name || 'Unknown' };
    });

  // Add goalkeeper consecutive warning if applicable
  let goalkeeperWarning = '';
  if (previousGoalkeeper && quarterNumber >= 2 && quarterNumber <= 4) {
    goalkeeperWarning = `\n\n⚽ GOALKEEPER CONSECUTIVE RULE (CRITICAL):
  ${previousGoalkeeper.playerName} (ID: ${previousGoalkeeper.playerId})  should play in this quarter if it's likely they will play GK again in this game.`;
  }

  // Quarter-specific instructions
  let quarterSpecificInstructions = '';

  if (quarterNumber === 1) {
    quarterSpecificInstructions = `
      📋 QUARTER 1 STRATEGY:
      - All players are available
      - Create a balanced lineup considering position history
      - Select ${positionsPerQuarter} players to play
      - The remaining players will sit out`;
  } else {
    // Build the players who sat out section
    let playersWhoSatOutSection = '';

    if (mustPlayPlayers.length > 0) {
      playersWhoSatOutSection += `\n🚨 PRIORITY 1 - MUST PLAY (SAT OUT Q${quarterNumber - 1}):\n`;
      playersWhoSatOutSection += mustPlayPlayers.map(p => `- ${p.name} (ID: ${p.id})`).join('\n');
    }

    if (otherPlayersWhoSatOut.length > 0) {
      playersWhoSatOutSection += `\n\n📊 ALREADY SAT OUT (earlier quarters):\n`;
      playersWhoSatOutSection += otherPlayersWhoSatOut.map(p => `- ${p.name} (ID: ${p.id})`).join('\n');
      playersWhoSatOutSection += `\n⚠️ These players already sat out earlier, so prefer playing them if possible, but prioritize Q${quarterNumber - 1} subs first`;
    }

    quarterSpecificInstructions = `
        🚨 PLAYERS WHO HAVE SAT OUT THIS GAME:
        ${playersWhoSatOutSection}

        ⚠️ You MUST assign all ${mustPlayPlayers.length} Priority 1 players, or return error=true.

        📋 QUARTER ${quarterNumber} STRATEGY:
        1. FIRST: Assign goalkeeper per consecutive rule (if applicable)
        2. SECOND: Assign ALL ${mustPlayPlayers.length} Priority 1 must-play players to positions (use their positionHistory)
        3. THIRD: Fill remaining positions, preferring players who already sat out earlier
        4. Put non-playing players in substitutes array`;
  }

  return `User request: ${userInput}

          🎯 PLANNING QUARTER ${quarterNumber} OF 4

          ${formationContext}

          📊 PLAYER STATUS:
          Total players: ${playersContext.length}
          Positions to fill: ${positionsPerQuarter}
          Must-play players: ${mustPlayPlayers.length}
          ${previousQuartersContext}
          ${goalkeeperWarning}
          ${absentInjuredSection}
          ${quarterSpecificInstructions}

          👥 ALL PLAYERS:
          ${JSON.stringify(playersContext, null, 2)}

          🎯 POSITION ASSIGNMENT PRIORITIES:
          1. HIGHEST: Goalkeeper consecutive rule (if applicable)
          2. HIGH: Must-play players (players who sat out last quarter)
          3. MEDIUM: Position consistency - keep players in same positions from previous quarters of this game when possible
          4. BASE: Use positionHistory to assign players to their most frequent position
            - Example: {"RB": 12, "CB": 4} → assign to RB
            - Position abbreviations match the "Position mapping" above

          ⚠️ VALIDATION CHECK:
          - You have ${playersContext.length} total players and need ${positionsPerQuarter} positions
          - ${mustPlayPlayers.length} players MUST play this quarter
          - If you cannot create a valid lineup, return error=true with errorMessage

          Generate Quarter ${quarterNumber} lineup now.`;
}
