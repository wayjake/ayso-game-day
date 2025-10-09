// Prompt building for sequential quarter-by-quarter planning
import type {
  PlayerContext,
  QuarterFormationInfo,
  GameFormat,
  QuarterPlanningContext
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

${ageSpecificRules}

🎯 YOUR TASK: Plan ONLY Quarter ${quarterNumber}
- You are planning ONE quarter at a time
- Previous quarters have already been decided (provided in context)
- ${quartersRemaining} quarters remain after this one

⚠️ CRITICAL CONSTRAINTS FOR THIS QUARTER:
1. Must fill ALL ${positionsPerQuarter} field positions
2. Must-play players (if any) MUST be assigned to positions
3. All other positions can be filled with any available players

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

Current Team Format: ${format}

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
}): string {
  const {
    userInput,
    quarterNumber,
    quartersRemaining,
    formationContext,
    playersContext,
    previousQuarters,
    positionsPerQuarter,
    mustPlayPlayerIds
  } = params;

  // Build previous quarters context
  let previousQuartersContext = '';
  if (previousQuarters.length > 0) {
    const lastQuarter = previousQuarters[previousQuarters.length - 1];
    previousQuartersContext = `\n\n📅 PREVIOUS QUARTER (Q${lastQuarter.number}):\n`;
    previousQuartersContext += `  Players who played: ${lastQuarter.assignments.map(a => a.playerId).join(', ')}\n`;
    previousQuartersContext += `  Players who SAT OUT: ${lastQuarter.substitutes.join(', ')}\n`;
  }

  // Get must-play players with their names
  const mustPlayPlayers = mustPlayPlayerIds.map(id => {
    const player = playersContext.find(p => p.id === id);
    return { id, name: player?.name || 'Unknown' };
  });

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
    quarterSpecificInstructions = `
🚨 MUST-PLAY REQUIREMENT (NON-NEGOTIABLE):
These ${mustPlayPlayers.length} players have been SUBBED OUT in previous quarters and MUST play this quarter:
${mustPlayPlayers.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}

⚠️ If you cannot assign all ${mustPlayPlayers.length} must-play players, return error=true.

📋 QUARTER ${quarterNumber} STRATEGY:
1. FIRST: Assign ALL ${mustPlayPlayers.length} must-play players to positions (use their positionHistory)
2. SECOND: Fill remaining ${positionsPerQuarter - mustPlayPlayers.length} positions with other players
3. Put non-playing players in substitutes array`;
  }

  return `User request: ${userInput}

🎯 PLANNING QUARTER ${quarterNumber} OF 4

${formationContext}

📊 PLAYER STATUS:
Total players: ${playersContext.length}
Positions to fill: ${positionsPerQuarter}
Must-play players: ${mustPlayPlayers.length}
${previousQuartersContext}
${quarterSpecificInstructions}

👥 ALL PLAYERS:
${JSON.stringify(playersContext, null, 2)}

🎯 POSITION ASSIGNMENT:
- Use each player's positionHistory to assign them to their most frequent position
- Example: {"RB": 12, "CB": 4} → assign to RB
- Position abbreviations match the "Position mapping" above

⚠️ VALIDATION CHECK:
- You have ${playersContext.length} total players and need ${positionsPerQuarter} positions
- ${mustPlayPlayers.length} players MUST play this quarter
- If you cannot create a valid lineup, return error=true with errorMessage

Generate Quarter ${quarterNumber} lineup now.`;
}
