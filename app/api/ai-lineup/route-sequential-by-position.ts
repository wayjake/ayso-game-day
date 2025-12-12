// Sequential lineup generation with position-based planning phases
// Phase 1: Plan substitutes per quarter
// Phase 2: Assign goalkeepers per quarter
// Phase 3: Assign field positions per quarter
// Phase 4: Analyze and validate

import { data } from "react-router";
import type { GameFormat, QuarterWithDetails } from './types';
import {
  getTeam,
  getGame,
  getQuarterFormations,
  getTeamPlayers,
  getCurrentAssignments,
  getAbsentInjuredPlayers,
  getPastGamesAndAssignments,
  calculatePositionHistory,
  buildPlayersContext,
  buildCurrentLineup,
  buildAbsentInjuredContext,
} from './data-fetchers';
import { buildFormationContext } from './prompt-builder';
import { generateSingleQuarterLineup } from './ai-client-sequential';

interface SubstitutePlan {
  [quarter: number]: number[]; // playerId[]
}

interface GoalkeeperPlan {
  [quarter: number]: number; // playerId
}

interface PositionAssignment {
  positionNumber: number;
  playerId: number;
}

interface QuarterPlan {
  [quarter: number]: PositionAssignment[];
}

export async function handleSequentialByPositionGeneration(formData: FormData, user: any) {
  try {
    const gameId = parseInt(formData.get("gameId") as string);
    const teamId = parseInt(formData.get("teamId") as string);
    const userInput = formData.get("userInput") as string;

    // 1. Fetch all necessary data
    const team = await getTeam(teamId, user.id);
    if (!team) {
      return data({ success: false, error: "Team not found" }, { status: 404 });
    }

    const game = await getGame(gameId, teamId);
    if (!game) {
      return data({ success: false, error: "Game not found" }, { status: 404 });
    }

    const quarterFormationInfo = await getQuarterFormations(game, team.format as GameFormat);
    const teamPlayers = await getTeamPlayers(teamId);
    const currentAssignments = await getCurrentAssignments(gameId);
    const absentInjuredPlayers = await getAbsentInjuredPlayers(gameId);
    const { pastGames, pastAssignments } = await getPastGamesAndAssignments(teamId, game.gameDate);

    // 2. Process and build context
    const positionHistory = calculatePositionHistory(teamPlayers, pastAssignments);
    const playersContext = buildPlayersContext(teamPlayers, positionHistory);
    const currentLineup = buildCurrentLineup(currentAssignments);
    const absentInjuredContext = buildAbsentInjuredContext(absentInjuredPlayers);
    const positionsPerQuarter = quarterFormationInfo[1].positions.length;
    const formationContext = buildFormationContext(quarterFormationInfo);

    console.log('\n=== PHASE-BASED SEQUENTIAL LINEUP GENERATION ===\n');

    // PHASE 1: Plan substitutes for all quarters
    console.log('PHASE 1: Planning substitutes for all quarters...');
    const substitutePlan = await planSubstitutes({
      teamPlayers,
      playersContext,
      positionsPerQuarter,
      absentInjuredContext,
      userInput,
      format: team.format as GameFormat,
      currentLineup,
      quarterFormationInfo,
    });

    // PHASE 2: Assign goalkeepers for all quarters
    console.log('PHASE 2: Assigning goalkeepers for all quarters...');
    const goalkeeperPlan = await planGoalkeepers({
      teamPlayers,
      playersContext,
      substitutePlan,
      format: team.format as GameFormat,
      userInput,
      absentInjuredContext,
      currentLineup,
    });

    // PHASE 3: Assign field positions for all quarters
    console.log('PHASE 3: Assigning field positions for all quarters...');
    const positionPlan = await planFieldPositions({
      teamPlayers,
      playersContext,
      substitutePlan,
      goalkeeperPlan,
      quarterFormationInfo,
      formationContext,
      userInput,
      currentLineup,
    });

    // PHASE 4: Analyze and validate
    console.log('PHASE 4: Analyzing final lineup...');
    const analysis = await analyzeFinalLineup({
      teamPlayers,
      playersContext,
      substitutePlan,
      goalkeeperPlan,
      positionPlan,
      format: team.format as GameFormat,
      absentInjuredContext,
    });

    if (!analysis.isValid) {
      return data({
        success: false,
        error: 'Lineup validation failed',
        validationErrors: analysis.errors,
      }, { status: 400 });
    }

    // 5. Convert to frontend format
    const quarterResults: QuarterWithDetails[] = [];
    for (let q = 1; q <= 4; q++) {
      const assignments = positionPlan[q] || [];
      const substitutes = (substitutePlan[q] || []).map((playerId: number) => {
        const player = playersContext.find(p => p.id === playerId);

        // Check if this player is absent/injured for this quarter
        const absentInjuredInfo = absentInjuredContext.find(ai => {
          const isAbsentThisQuarter = !ai.quarter || ai.quarter === q;
          return ai.playerId === playerId && isAbsentThisQuarter;
        });

        return {
          playerId,
          playerName: player?.name || 'Unknown',
          // Include absent/injured info if applicable
          isAbsentInjured: !!absentInjuredInfo,
          absentInjuredReason: absentInjuredInfo?.reason
        };
      });

      const players: Record<number, number> = {};
      const changes: Array<{
        positionNumber: number;
        positionName: string;
        playerId: number;
        playerName: string;
        isChange: boolean;
      }> = [];

      assignments.forEach(assignment => {
        players[assignment.positionNumber] = assignment.playerId;

        const player = playersContext.find(p => p.id === assignment.playerId);
        const formationInfo = quarterFormationInfo[q];
        const positionObj = formationInfo.positions.find((p: any) => p.number === assignment.positionNumber);
        const positionName = positionObj?.abbreviation || `Pos ${assignment.positionNumber}`;
        const existingPlayerId = currentLineup[q]?.[assignment.positionNumber];
        const isChange = existingPlayerId !== assignment.playerId;

        changes.push({
          positionNumber: assignment.positionNumber,
          positionName,
          playerId: assignment.playerId,
          playerName: player?.name || 'Unknown',
          isChange,
        });
      });

      changes.sort((a, b) => a.positionNumber - b.positionNumber);

      quarterResults.push({
        number: q,
        players,
        changes,
        substitutes,
      });
    }

    return data({
      success: true,
      message: analysis.summary,
      quarters: quarterResults,
    });

  } catch (error) {
    console.error("Error generating sequential lineup:", error);
    return data(
      { success: false, error: "Failed to generate lineup suggestions" },
      { status: 500 }
    );
  }
}

// PHASE 1: Plan which players will be substitutes in each quarter
async function planSubstitutes(params: {
  teamPlayers: any[];
  playersContext: any[];
  positionsPerQuarter: number;
  absentInjuredContext: any[];
  userInput: string;
  format: GameFormat;
  currentLineup: Record<number, Record<number, number>>;
  quarterFormationInfo: any;
}): Promise<SubstitutePlan> {
  console.log('\n--- PHASE 1: SUBSTITUTE PLANNING ---');
  const { teamPlayers, playersContext, positionsPerQuarter, absentInjuredContext, userInput, format, currentLineup, quarterFormationInfo } = params;

  console.log(`Total players: ${teamPlayers.length}`);
  console.log(`Positions per quarter: ${positionsPerQuarter}`);
  console.log(`Substitutes needed per quarter: ${teamPlayers.length - positionsPerQuarter}`);
  console.log(`Absent/Injured players: ${absentInjuredContext.length}`);

  // Build current lineup context
  let currentLineupSection = '';
  for (let q = 1; q <= 4; q++) {
    const existing = currentLineup[q];
    if (existing && Object.keys(existing).length > 0) {
      const playingIds = Object.values(existing);
      const playerNames = playingIds.map(id => {
        const player = playersContext.find(p => p.id === id);
        return `${player?.name || 'Unknown'} (${id})`;
      }).join(', ');
      currentLineupSection += `\nQ${q}: ${playerNames}`;
    }
  }
  if (currentLineupSection) {
    currentLineupSection = `\n\nCURRENT LINEUP (for reference):${currentLineupSection}\nYou can use this as a base but feel free to make improvements.`;
  }

  const systemPrompt = `You are an AYSO soccer coach planning which players will be SUBSTITUTES (sit out) for each quarter of a game.

AYSO Fair Play Rules:
- Each player must play at LEAST 3 out of 4 quarters
- This means each player can sit out AT MOST 1 quarter
- ${teamPlayers.length} total players, ${positionsPerQuarter} play per quarter
- Therefore ${teamPlayers.length - positionsPerQuarter} players must sit out each quarter

Your task: Decide which players sit out in Q1, Q2, Q3, and Q4 to ensure fair rotation.

Return JSON format:
{
  "substitutes": {
    "1": [playerId, playerId, ...],
    "2": [playerId, playerId, ...],
    "3": [playerId, playerId, ...],
    "4": [playerId, playerId, ...]
  }
}`;

  const absentSection = absentInjuredContext.length > 0
    ? `\n\nABSENT/INJURED PLAYERS (must sit ALL quarters):\n${absentInjuredContext.map(ai => {
        const player = playersContext.find(p => p.id === ai.playerId);
        return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId}): ${ai.reason}`;
      }).join('\n')}`
    : '';

  const userMessage = `User request: ${userInput}

GAME FORMAT: ${format}
Total players: ${teamPlayers.length}
Playing per quarter: ${positionsPerQuarter}
Sitting out per quarter: ${teamPlayers.length - positionsPerQuarter}
${absentSection}
${currentLineupSection}

PLAYERS:
${JSON.stringify(playersContext, null, 2)}

CONSTRAINTS:
1. Each player sits out EXACTLY 0 or 1 quarters (cannot sit out 2+ quarters)
2. Exactly ${teamPlayers.length - positionsPerQuarter} players sit out each quarter
3. Absent/injured players must sit out all 4 quarters
4. Try to distribute sit-outs evenly - if some players sit 0 quarters and others sit 1, that's acceptable

Plan the substitute rotation now.`;

  console.log('Calling AI for substitute planning...');
  const response = await generateSingleQuarterLineup({
    systemPrompt,
    userMessage
  });

  console.log('AI Response received:', response.error ? 'ERROR' : 'SUCCESS');

  // Parse the response to extract substitute plan
  // For now, return a simple rotation (this will be replaced with actual AI response parsing)
  const substitutePlan: SubstitutePlan = {};

  // Simple rotation logic as fallback
  console.log('Using fallback rotation logic for substitute planning...');
  const availablePlayers = teamPlayers.filter(p => {
    return !absentInjuredContext.some(ai => ai.playerId === p.id);
  });

  console.log(`Available players for rotation: ${availablePlayers.length}`);

  const subsPerQuarter = teamPlayers.length - positionsPerQuarter;

  for (let q = 1; q <= 4; q++) {
    substitutePlan[q] = [];

    // CRITICAL: Add absent/injured players FIRST - they MUST sit out
    absentInjuredContext.forEach(ai => {
      // Check if this player is absent for this specific quarter or all quarters
      const isAbsentThisQuarter = !ai.quarter || ai.quarter === q;
      if (isAbsentThisQuarter && !substitutePlan[q].includes(ai.playerId)) {
        substitutePlan[q].push(ai.playerId);
        const player = playersContext.find(p => p.id === ai.playerId);
        console.log(`  Q${q}: ${player?.name || 'Unknown'} (${ai.playerId}) MUST sit out - ${ai.reason}`);
      }
    });

    // Fill remaining sub spots with rotation
    const startIdx = (q - 1) * subsPerQuarter;
    for (let i = 0; i < subsPerQuarter && substitutePlan[q].length < subsPerQuarter; i++) {
      const playerIdx = (startIdx + i) % availablePlayers.length;
      const playerId = availablePlayers[playerIdx].id;
      if (!substitutePlan[q].includes(playerId)) {
        substitutePlan[q].push(playerId);
      }
    }

    // Log quarter details
    const subNames = substitutePlan[q].map(id => {
      const player = playersContext.find(p => p.id === id);
      return `${player?.name || 'Unknown'} (${id})`;
    }).join(', ');
    console.log(`Q${q} Substitutes (${substitutePlan[q].length}): ${subNames}`);
  }

  // Validate each player sits out at most 1 quarter
  const sitOutCounts: Record<number, number> = {};
  teamPlayers.forEach(p => sitOutCounts[p.id] = 0);

  for (let q = 1; q <= 4; q++) {
    substitutePlan[q].forEach(playerId => {
      sitOutCounts[playerId]++;
    });
  }

  console.log('\nSit-out counts per player:');
  Object.entries(sitOutCounts).forEach(([playerId, count]) => {
    const player = playersContext.find(p => p.id === parseInt(playerId));
    console.log(`  ${player?.name || 'Unknown'} (${playerId}): ${count} quarters`);
  });

  console.log('--- PHASE 1 COMPLETE ---\n');
  return substitutePlan;
}

// PHASE 2: Assign goalkeepers for each quarter
async function planGoalkeepers(params: {
  teamPlayers: any[];
  playersContext: any[];
  substitutePlan: SubstitutePlan;
  format: GameFormat;
  userInput: string;
  absentInjuredContext: any[];
  currentLineup: Record<number, Record<number, number>>;
}): Promise<GoalkeeperPlan> {
  console.log('\n--- PHASE 2: GOALKEEPER PLANNING ---');
  const { teamPlayers, playersContext, substitutePlan, format, userInput, absentInjuredContext, currentLineup } = params;

  const gkLimits: Record<GameFormat, number> = {
    '7v7': 2,
    '9v9': 3,
    '11v11': 4
  };

  console.log(`Format: ${format}`);
  console.log(`Max GK quarters: ${gkLimits[format]}`);

  // Build current lineup context
  let currentLineupSection = '';
  for (let q = 1; q <= 4; q++) {
    const existing = currentLineup[q];
    if (existing && existing[1]) { // Position 1 is goalkeeper
      const player = playersContext.find(p => p.id === existing[1]);
      currentLineupSection += `\nQ${q} GK: ${player?.name || 'Unknown'} (${existing[1]})`;
    }
  }
  if (currentLineupSection) {
    currentLineupSection = `\n\nCURRENT GOALKEEPER ASSIGNMENTS (for reference):${currentLineupSection}\nYou can use this as a base but feel free to make improvements.`;
  }

  const systemPrompt = `You are an AYSO soccer coach assigning GOALKEEPERS for each quarter.

AYSO Goalkeeper Rules for ${format}:
- Goalkeepers must play CONSECUTIVE quarters (Q1+Q2, or Q3+Q4, etc.)
- Maximum ${gkLimits[format]} quarters as goalkeeper per player
- Each goalkeeper must also play a field position during the game

Your task: Assign goalkeeper (position 1) for quarters 1, 2, 3, and 4.

Return JSON format:
{
  "goalkeepers": {
    "1": playerId,
    "2": playerId,
    "3": playerId,
    "4": playerId
  }
}`;

  // Get available (non-substitute) players per quarter
  const playingPlayersPerQuarter: Record<number, number[]> = {};
  for (let q = 1; q <= 4; q++) {
    playingPlayersPerQuarter[q] = teamPlayers
      .filter(p => !substitutePlan[q]?.includes(p.id))
      .map(p => p.id);

    console.log(`Q${q} available players: ${playingPlayersPerQuarter[q].length}`);

    // Verify no absent/injured players are in the playing list
    const absentPlaying = playingPlayersPerQuarter[q].filter(pid => {
      return absentInjuredContext.some(ai => {
        const isAbsentThisQuarter = !ai.quarter || ai.quarter === q;
        return ai.playerId === pid && isAbsentThisQuarter;
      });
    });

    if (absentPlaying.length > 0) {
      console.error(`  ⚠️ ERROR: Q${q} has absent/injured players in playing list: ${absentPlaying.join(', ')}`);
    }
  }

  const absentSection = absentInjuredContext.length > 0
    ? `\n\n🚫 ABSENT/INJURED PLAYERS (CANNOT PLAY):\n${absentInjuredContext.map(ai => {
        const player = playersContext.find(p => p.id === ai.playerId);
        const quarterInfo = ai.quarter ? ` Q${ai.quarter} only` : ' ALL QUARTERS';
        return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}`;
      }).join('\n')}`
    : '';

  const userMessage = `User request: ${userInput}

GAME FORMAT: ${format}
Max GK quarters: ${gkLimits[format]}

PLAYERS (with GK experience):
${JSON.stringify(playersContext.map(p => ({
  id: p.id,
  name: p.name,
  description: p.description,
  preferredPositions: p.preferredPositions,
  gkExperience: p.positionHistory?.['GK'] || 0
})), null, 2)}

PLAYERS AVAILABLE EACH QUARTER:
Q1: ${playingPlayersPerQuarter[1]?.join(', ')}
Q2: ${playingPlayersPerQuarter[2]?.join(', ')}
Q3: ${playingPlayersPerQuarter[3]?.join(', ')}
Q4: ${playingPlayersPerQuarter[4]?.join(', ')}
${absentSection}
${currentLineupSection}

CONSTRAINTS:
1. 🚫 CRITICAL: DO NOT assign absent/injured players as goalkeepers
2. GK must play CONSECUTIVE quarters (Q1+Q2 OR Q2+Q3 OR Q3+Q4, etc.)
3. Max ${gkLimits[format]} quarters per player as GK
4. Player must be available (not sitting out) to play GK
5. Prefer players with GK experience or preference

Assign goalkeepers now.`;

  console.log('Calling AI for goalkeeper planning...');
  const response = await generateSingleQuarterLineup({
    systemPrompt,
    userMessage
  });

  console.log('AI Response received:', response.error ? 'ERROR' : 'SUCCESS');

  // Simple fallback logic
  console.log('Using fallback logic for goalkeeper planning...');
  const goalkeeperPlan: GoalkeeperPlan = {};

  // Find players with GK experience (excluding absent/injured players who can't play any quarters)
  const fullyAbsentPlayerIds = new Set(
    absentInjuredContext
      .filter(ai => !ai.quarter) // No specific quarter means absent all quarters
      .map(ai => ai.playerId)
  );

  const gkCandidates = playersContext
    .filter(p => {
      // CRITICAL: Exclude players who are absent all quarters
      if (fullyAbsentPlayerIds.has(p.id)) {
        console.log(`  Excluding ${p.name} (ID: ${p.id}) from GK candidates - absent all quarters`);
        return false;
      }

      const hasGKPref = p.preferredPositions?.includes('GK');
      const hasGKHistory = (p.positionHistory?.['GK'] || 0) > 0;
      return hasGKPref || hasGKHistory;
    })
    .sort((a, b) => (b.positionHistory?.['GK'] || 0) - (a.positionHistory?.['GK'] || 0));

  console.log(`GK candidates found: ${gkCandidates.length}`);
  gkCandidates.forEach(p => {
    console.log(`  - ${p.name} (ID: ${p.id}): ${p.positionHistory?.['GK'] || 0} GK quarters`);
  });

  // Helper function to check if a player is available for a quarter
  const isPlayerAvailableForQuarter = (playerId: number, quarter: number): boolean => {
    return !absentInjuredContext.some(ai => {
      const isAbsentThisQuarter = !ai.quarter || ai.quarter === quarter;
      return ai.playerId === playerId && isAbsentThisQuarter;
    });
  };

  // Assign first GK candidate to Q1+Q2 (must be available for both)
  let gk1 = gkCandidates.find(p =>
    isPlayerAvailableForQuarter(p.id, 1) && isPlayerAvailableForQuarter(p.id, 2)
  );

  if (!gk1) {
    // Fallback: find any available player
    gk1 = playersContext.find(p =>
      isPlayerAvailableForQuarter(p.id, 1) && isPlayerAvailableForQuarter(p.id, 2)
    );
  }

  if (gk1) {
    goalkeeperPlan[1] = gk1.id;
    goalkeeperPlan[2] = gk1.id;
    console.log(`Q1+Q2 Goalkeeper: ${gk1.name} (ID: ${gk1.id})`);
  } else {
    console.error('⚠️ ERROR: Cannot find available goalkeeper for Q1+Q2');
  }

  // Assign second GK candidate to Q3+Q4 (different from first, must be available for both)
  let gk2 = gkCandidates.find(p =>
    p.id !== gk1?.id &&
    isPlayerAvailableForQuarter(p.id, 3) &&
    isPlayerAvailableForQuarter(p.id, 4)
  );

  if (!gk2) {
    // Fallback: find any available player
    gk2 = playersContext.find(p =>
      p.id !== gk1?.id &&
      isPlayerAvailableForQuarter(p.id, 3) &&
      isPlayerAvailableForQuarter(p.id, 4)
    );
  }

  if (gk2) {
    goalkeeperPlan[3] = gk2.id;
    goalkeeperPlan[4] = gk2.id;
    console.log(`Q3+Q4 Goalkeeper: ${gk2.name} (ID: ${gk2.id})`);
  } else {
    console.error('⚠️ ERROR: Cannot find available goalkeeper for Q3+Q4');
  }

  // Validate GK assignments don't conflict with substitutes or absent/injured
  for (let q = 1; q <= 4; q++) {
    const gkId = goalkeeperPlan[q];
    if (!gkId) continue;

    if (substitutePlan[q]?.includes(gkId)) {
      console.error(`⚠️ ERROR: GK for Q${q} (${gkId}) is in substitute list!`);
    }

    if (!isPlayerAvailableForQuarter(gkId, q)) {
      const player = playersContext.find(p => p.id === gkId);
      console.error(`⚠️ ERROR: GK for Q${q} ${player?.name} (${gkId}) is absent/injured!`);
    }
  }

  console.log('--- PHASE 2 COMPLETE ---\n');
  return goalkeeperPlan;
}

// PHASE 3: Assign field positions for all quarters
async function planFieldPositions(params: {
  teamPlayers: any[];
  playersContext: any[];
  substitutePlan: SubstitutePlan;
  goalkeeperPlan: GoalkeeperPlan;
  quarterFormationInfo: any;
  formationContext: string;
  userInput: string;
  currentLineup: Record<number, Record<number, number>>;
}): Promise<QuarterPlan> {
  console.log('\n--- PHASE 3: FIELD POSITION PLANNING ---');
  const { teamPlayers, playersContext, substitutePlan, goalkeeperPlan, quarterFormationInfo, formationContext, userInput, currentLineup } = params;

  const positionPlan: QuarterPlan = {};

  for (let q = 1; q <= 4; q++) {
    console.log(`\nPlanning Quarter ${q}...`);
    const playingPlayers = teamPlayers
      .filter(p => !substitutePlan[q]?.includes(p.id))
      .map(p => p.id);

    const goalkeeperPlayerId = goalkeeperPlan[q];
    const fieldPlayers = playingPlayers.filter(id => id !== goalkeeperPlayerId);
    const formationInfo = quarterFormationInfo[q];
    const fieldPositions = formationInfo.positions.filter((pos: any) => pos.number !== 1);

    console.log(`  Total playing: ${playingPlayers.length}`);
    console.log(`  Goalkeeper: ${goalkeeperPlayerId}`);
    console.log(`  Field players: ${fieldPlayers.length}`);
    console.log(`  Field positions to fill: ${fieldPositions.length}`);

    // Build current lineup context for this quarter
    let currentLineupSection = '';
    const existing = currentLineup[q];
    if (existing && Object.keys(existing).length > 1) { // More than just GK
      currentLineupSection = '\n\nCURRENT FIELD POSITIONS (for reference):\n';
      Object.entries(existing).forEach(([posNum, playerId]) => {
        if (parseInt(posNum) !== 1) { // Skip GK, already assigned
          const player = playersContext.find(p => p.id === playerId);
          const positionObj = formationInfo.positions.find((p: any) => p.number === parseInt(posNum));
          const positionName = positionObj?.abbreviation || `Pos${posNum}`;
          currentLineupSection += `${positionName} (${posNum}): ${player?.name || 'Unknown'} (${playerId})\n`;
        }
      });
      currentLineupSection += 'You can use this as a base but feel free to make improvements.';
    }

    const systemPrompt = `You are an AYSO soccer coach assigning field positions for Quarter ${q}.

Goalkeeper is already assigned: ${goalkeeperPlayerId}
Remaining players to assign: ${fieldPlayers.length}
Field positions to fill: ${fieldPositions.length}

Return JSON format:
{
  "assignments": [
    { "positionNumber": 2, "playerId": 123 },
    { "positionNumber": 3, "playerId": 456 },
    ...
  ]
}`;

    const userMessage = `User request: ${userInput}

QUARTER ${q} FIELD POSITION ASSIGNMENT

${formationContext}

GOALKEEPER (already assigned):
Position 1 (GK): Player ${goalkeeperPlayerId}
${currentLineupSection}

FIELD PLAYERS TO ASSIGN:
${fieldPlayers.map(id => {
  const player = playersContext.find(p => p.id === id);
  return `- ${player?.name} (ID: ${id}): ${JSON.stringify(player?.positionHistory || {})}`;
}).join('\n')}

FIELD POSITIONS TO FILL:
${fieldPositions.map((pos: any) => `- ${pos.number}: ${pos.abbreviation}`).join('\n')}

INSTRUCTIONS:
1. Assign each field player to their best position based on positionHistory
2. Each player assigned exactly once
3. Each position filled exactly once

Assign field positions now.`;

    console.log(`  Calling AI for Q${q} field positions...`);
    const response = await generateSingleQuarterLineup({
      systemPrompt,
      userMessage
    });

    console.log(`  AI Response received:`, response.error ? 'ERROR' : 'SUCCESS');

    // Intelligent fallback logic using position history
    console.log(`  Using intelligent fallback logic for Q${q} field positions...`);
    const assignments: PositionAssignment[] = [];

    // Add goalkeeper
    assignments.push({
      positionNumber: 1,
      playerId: goalkeeperPlayerId
    });
    const gkPlayer = playersContext.find(p => p.id === goalkeeperPlayerId);
    console.log(`    Pos 1 (GK): ${gkPlayer?.name || 'Unknown'} (${goalkeeperPlayerId})`);

    // Track which players have been assigned
    const assignedPlayerIds = new Set([goalkeeperPlayerId]);

    // Greedy assignment: for each position, find the best available player based on experience
    fieldPositions.forEach((pos: any) => {
      const positionAbbr = pos.abbreviation;

      // Find the best available player for this position based on position history
      let bestPlayer: any = null;
      let bestExperience = -1;

      fieldPlayers.forEach(playerId => {
        // Skip if already assigned
        if (assignedPlayerIds.has(playerId)) return;

        const player = playersContext.find(p => p.id === playerId);
        const experience = player?.positionHistory?.[positionAbbr] || 0;

        if (experience > bestExperience || (experience === bestExperience && !bestPlayer)) {
          bestPlayer = player;
          bestExperience = experience;
        }
      });

      // Fallback: if no player found (shouldn't happen), use first available
      if (!bestPlayer) {
        const fallbackId = fieldPlayers.find(id => !assignedPlayerIds.has(id));
        bestPlayer = playersContext.find(p => p.id === fallbackId);
      }

      if (bestPlayer) {
        assignments.push({
          positionNumber: pos.number,
          playerId: bestPlayer.id
        });
        assignedPlayerIds.add(bestPlayer.id);

        const expDisplay = bestExperience > 0 ? ` [${bestExperience} quarters]` : ' [no exp]';
        console.log(`    Pos ${pos.number} (${positionAbbr}): ${bestPlayer.name} (${bestPlayer.id})${expDisplay}`);
      }
    });

    positionPlan[q] = assignments;
  }

  console.log('--- PHASE 3 COMPLETE ---\n');
  return positionPlan;
}

// PHASE 4: Analyze and validate the final lineup
async function analyzeFinalLineup(params: {
  teamPlayers: any[];
  playersContext: any[];
  substitutePlan: SubstitutePlan;
  goalkeeperPlan: GoalkeeperPlan;
  positionPlan: QuarterPlan;
  format: GameFormat;
  absentInjuredContext: any[];
}): Promise<{ isValid: boolean; errors: string[]; summary: string }> {
  console.log('\n--- PHASE 4: ANALYSIS & VALIDATION ---');
  const { teamPlayers, playersContext, substitutePlan, goalkeeperPlan, positionPlan, format, absentInjuredContext } = params;

  const errors: string[] = [];

  console.log('Validating absent/injured players are not assigned...');
  // Check that absent/injured players are not assigned to play
  absentInjuredContext.forEach(ai => {
    const player = playersContext.find(p => p.id === ai.playerId);
    const playerName = player?.name || `Player ${ai.playerId}`;

    // Check if this player is marked absent for specific quarter or all quarters
    const affectedQuarters = ai.quarter ? [ai.quarter] : [1, 2, 3, 4];

    affectedQuarters.forEach(q => {
      const assignments = positionPlan[q] || [];
      const isAssigned = assignments.some(a => a.playerId === ai.playerId);

      if (isAssigned) {
        console.log(`  ❌ ${playerName} assigned in Q${q} but marked as ${ai.reason}`);
        errors.push(`${playerName} is assigned in Q${q} but marked as ${ai.reason}`);
      } else {
        // Verify they're in the substitute list
        const isSubstitute = substitutePlan[q]?.includes(ai.playerId);
        if (isSubstitute) {
          console.log(`  ✅ ${playerName} correctly marked as substitute in Q${q} (${ai.reason})`);
        } else {
          console.log(`  ⚠️  ${playerName} not playing but not in substitute list for Q${q}`);
        }
      }
    });
  });
  console.log('');

  console.log('Validating AYSO 3/4 rule (adjusted for absent/injured)...');
  // Check 3/4 rule (adjusted for absent/injured players)
  playersContext.forEach(player => {
    // Count quarters where player is absent/injured
    const absentQuarters = new Set<number>();
    absentInjuredContext.forEach(ai => {
      if (ai.playerId === player.id) {
        if (ai.quarter) {
          absentQuarters.add(ai.quarter);
        } else {
          // Absent all quarters
          [1, 2, 3, 4].forEach(q => absentQuarters.add(q));
        }
      }
    });

    const totalQuarters = 4;
    const availableQuarters = totalQuarters - absentQuarters.size;
    const requiredQuarters = Math.max(0, Math.ceil(availableQuarters * 0.75)); // 3/4 of available

    let quartersPlayed = 0;
    for (let q = 1; q <= 4; q++) {
      if (!absentQuarters.has(q) && !substitutePlan[q]?.includes(player.id)) {
        quartersPlayed++;
      }
    }

    if (absentQuarters.size === 4) {
      console.log(`  ⚠️  ${player.name}: Absent all 4 quarters`);
    } else if (quartersPlayed < requiredQuarters) {
      console.log(`  ❌ ${player.name}: ${quartersPlayed}/${availableQuarters} available quarters (needs ${requiredQuarters}+, absent ${absentQuarters.size})`);
      errors.push(`${player.name} only played ${quartersPlayed}/${availableQuarters} available quarters (needs ${requiredQuarters}+)`);
    } else {
      const absentNote = absentQuarters.size > 0 ? `, absent ${absentQuarters.size}` : '';
      console.log(`  ✅ ${player.name}: ${quartersPlayed}/${availableQuarters} quarters${absentNote}`);
    }
  });

  console.log('\nValidating goalkeeper limits...');
  // Check goalkeeper limits
  const gkLimits: Record<GameFormat, number> = {
    '7v7': 2,
    '9v9': 3,
    '11v11': 4
  };

  const gkCounts: Record<number, number> = {};
  playersContext.forEach(p => gkCounts[p.id] = 0);

  for (let q = 1; q <= 4; q++) {
    const gkId = goalkeeperPlan[q];
    if (gkId) {
      gkCounts[gkId] = (gkCounts[gkId] || 0) + 1;
    }
  }

  playersContext.forEach(player => {
    const gkQuarters = gkCounts[player.id] || 0;
    if (gkQuarters > 0) {
      if (gkQuarters > gkLimits[format]) {
        console.log(`  ❌ ${player.name}: ${gkQuarters} GK quarters (max ${gkLimits[format]})`);
        errors.push(`${player.name} played GK ${gkQuarters} quarters (max ${gkLimits[format]} for ${format})`);
      } else {
        console.log(`  ✅ ${player.name}: ${gkQuarters} GK quarters (max ${gkLimits[format]})`);
      }
    }
  });

  const summary = `Generated lineup for all 4 quarters with phase-based planning. ${teamPlayers.length} players assigned to ${format} formation.`;

  console.log('\n' + (errors.length === 0 ? '✅ VALIDATION PASSED' : `❌ VALIDATION FAILED (${errors.length} errors)`));
  console.log('--- PHASE 4 COMPLETE ---\n');

  return {
    isValid: errors.length === 0,
    errors,
    summary
  };
}
