// Prompt building functions for AI lineup API
import type {
  PlayerContext,
  QuarterFormationInfo,
  CurrentLineup,
  AbsentInjuredContext,
  PastGameContext,
  GameFormat
} from './types';

export function getAgeSpecificRules(format: GameFormat): string {
  switch (format) {
    case '11v11':
      return `AYSO U14 (11v11) Fair Play Rules:
- all players must play at least 3 quarters per game
- Goalkeeper MAY play all 4 quarters as keeper 
- There are 11 field positions in this format`;

    case '9v9':
      return `AYSO U12 (9v9) Fair Play Rules:
- all players must play at least 3 quarters per game
- Goalkeeper may play MAXIMUM 3 quarters as goalkeeper
- Goalkeeper MUST play another field position during the game
- There are 9 field positions in this format`;

    case '7v7':
      return `AYSO U10 (7v7) Fair Play Rules:
- all players must play at least 3 quarters per game
- Goalkeeper may play MAXIMUM 2 quarters as goalkeeper
- There are 7 field positions in this format`;

    default:
      return '';
  }
}

export function buildSystemPrompt(params: {
  format: GameFormat;
  totalPlayers: number;
  positionsPerQuarter: number;
}): string {
  const { format, totalPlayers, positionsPerQuarter } = params;
  const ageSpecificRules = getAgeSpecificRules(format);
  const totalPlayerSlots = positionsPerQuarter * 4;

  return `You are an ayso soccer lineup planner.

  AGE SPECIFIC RULES:
  ${ageSpecificRules}

  CURRENT TEAM GRID SIZE: ${format}

📋 MANDATORY STEP-BY-STEP PROCESS:
1. FIRST: Identify each player's PRIMARY position from their positionHistory (highest count)
2. SECOND: Create a rotation plan ensuring all players get 3+ quarters
3. THIRD: Assign players to their PRIMARY positions when possible
4. FOURTH: Verify by counting each player's appearances across all quarters
5. FIFTH: Only return response after confirming all players play 3+ quarters

🎯 POSITION ASSIGNMENT STRATEGY:
- ALWAYS assign players to their MOST FREQUENT position from history (highest number)
  - Example: positionHistory {"RB": 12, "CB": 4, "LB": 1} → assign to RB (position 2)
  - Example: positionHistory {"CF": 9, "CAM": 2} → assign to CF (position 9)
- The position abbreviations match the "Position mapping" (GK, RB, CB, LB, CDM, RM, CM, ST, CAM, LM, LW, RW)
- use preferredPositions as additional context to where a player should go
- Goalkeeper quarters playing more than one quarter should be (sequential, grouped by half) ie:) in quarter 1 and 2 or 3 and 4`;
}

/**
 * Builds a string describing the formation(s) being used across all quarters.
 * 
 * @param quarterFormationInfo - Object mapping quarter numbers (1-4) to formation info containing:
 *                              - name: Formation name (e.g. "4-3-3")
 *                              - positions: Array of position objects with number and abbreviation
 * @returns A formatted string that either:
 *          - If all quarters use same formation: Shows single formation with position mapping
 *          - If formations vary: Shows formation details per quarter with position mappings
 */
export function buildFormationContext(quarterFormationInfo: Record<number, QuarterFormationInfo>): string {
  const formattedQuarterInfo: Record<number, any> = {};

  for (let q = 1; q <= 4; q++) {
    const qInfo = quarterFormationInfo[q];
    const sortedPositions = [...qInfo.positions].sort((a, b) => a.number - b.number);

    formattedQuarterInfo[q] = {
      name: qInfo.name,
      positions: sortedPositions.map(p => p.number),
      positionMap: sortedPositions.map(p => `${p.number}=${p.abbreviation}`).join(', ')
    };
  }

  // Check if all quarters use the same formation
  const allSameFormation = Object.values(formattedQuarterInfo).every(
    (info, _, arr) => info.name === arr[0].name && JSON.stringify(info.positions) === JSON.stringify(arr[0].positions)
  );

  // Build formation context (deduplicated if same across quarters)
  if (allSameFormation) {
    const positionNumbers = formattedQuarterInfo[1].positions;
    const positionMap = formattedQuarterInfo[1].positionMap;
    return `Formation: ${formattedQuarterInfo[1].name} (all quarters)
Positions to fill: ${JSON.stringify(positionNumbers)}
Position mapping: ${positionMap}`;
  } else {
    let context = 'Formations by Quarter:\n';
    for (let q = 1; q <= 4; q++) {
      const info = formattedQuarterInfo[q];
      context += `  Q${q}: ${info.name} - Positions: ${JSON.stringify(info.positions)}\n`;
      context += `      Position mapping: ${info.positionMap}\n`;
    }
    return context;
  }
}

export function buildUserMessage(params: {
  userInput: string;
  previousMessage: string | null;
  totalPlayers: number;
  formationContext: string;
  playersContext: PlayerContext[];
  currentLineup: CurrentLineup;
  absentInjuredContext: AbsentInjuredContext[];
  positionsPerQuarter: number;
}): string {
  const {
    userInput,
    previousMessage,
    totalPlayers,
    formationContext,
    playersContext,
    currentLineup,
    absentInjuredContext,
    positionsPerQuarter
  } = params;

  // Filter out empty quarters from current lineup
  const nonEmptyLineup: Record<number, any> = {};
  Object.entries(currentLineup).forEach(([quarter, assignments]) => {
    if (Object.keys(assignments).length > 0) {
      nonEmptyLineup[parseInt(quarter)] = assignments;
    }
  });

  const currentLineupSection = Object.keys(nonEmptyLineup).length > 0
    ? `\n\nCurrent Lineup (partial):\n${JSON.stringify(nonEmptyLineup, null, 2)}`
    : '';
  const absentInjuredSection = absentInjuredContext.length > 0
    ? `\n\nAbsent/Injured Players:\n${JSON.stringify(absentInjuredContext, null, 2)}`
    : '';

  return `
        ${previousMessage ? `Previous message from the coach: "${previousMessage}"` : ''}
        ${userInput ? `Message from the coach: "${userInput}"` : ''}
        FORMATION CONTEXT PER QUARTER:
        ${formationContext}

        Players (ALL must play 3+ quarters):
        ${JSON.stringify(playersContext, null, 2)}

        Generate the lineup now based on the current lineup: ${currentLineupSection}
        Ignoring the absent/injured players: ${absentInjuredSection}`;
}
