// Sequential quarter-by-quarter lineup generation
import { data } from "react-router";
import type { GameFormat, AIAssignment, QuarterWithDetails, QuarterPlanningContext, PlayerContext } from './types';
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
import {
  buildFormationContext,
  savePromptToFile,
  saveResponseToFile
} from './prompt-builder';
import {
  buildQuarterSystemPrompt,
  buildQuarterUserMessage
} from './prompt-builder-sequential';
import { generateSingleQuarterLineup } from './ai-client-sequential';

// Helper function to check if goalkeeper quarters are consecutive within same half
function checkGoalkeeperConsecutiveQuarters(quarterNumbers: number[]): boolean {
  if (quarterNumbers.length < 2) return true;

  // Sort quarters
  const sorted = quarterNumbers.sort((a, b) => a - b);

  // Check if all quarters are in first half (Q1, Q2) or second half (Q3, Q4)
  const firstHalf = sorted.every(q => q <= 2);
  const secondHalf = sorted.every(q => q >= 3);

  if (!firstHalf && !secondHalf) return false;

  // Check if quarters are consecutive
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== 1) {
      return false;
    }
  }

  return true;
}

// Validation function for final lineup
function validateFinalLineup(params: {
  quarters: QuarterWithDetails[];
  playersContext: PlayerContext[];
  format: GameFormat;
}): { isValid: boolean; errors: string[] } {
  const { quarters, playersContext, format } = params;
  const errors: string[] = [];

  // Count quarters played per player
  const quarterCounts: Record<number, number> = {};
  const goalkeepingCounts: Record<number, number> = {};

  playersContext.forEach(p => {
    quarterCounts[p.id] = 0;
    goalkeepingCounts[p.id] = 0;
  });

  quarters.forEach(quarter => {
    Object.entries(quarter.players).forEach(([posNum, playerId]) => {
      const positionNumber = parseInt(posNum);
      quarterCounts[playerId] = (quarterCounts[playerId] || 0) + 1;

      // Position 1 is always goalkeeper
      if (positionNumber === 1) {
        goalkeepingCounts[playerId] = (goalkeepingCounts[playerId] || 0) + 1;
      }
    });
  });

  // Check 3/4 rule
  playersContext.forEach(player => {
    const quartersPlayed = quarterCounts[player.id] || 0;
    if (quartersPlayed < 3) {
      errors.push(`${player.name} only played ${quartersPlayed} quarters (needs 3+)`);
    }
  });

  // Check goalkeeper limits
  const gkLimits: Record<GameFormat, number> = {
    '7v7': 2,
    '9v9': 3,
    '11v11': 4
  };
  const maxGkQuarters = gkLimits[format];

  playersContext.forEach(player => {
    const gkQuarters = goalkeepingCounts[player.id] || 0;
    if (gkQuarters > maxGkQuarters) {
      errors.push(`${player.name} played goalkeeper ${gkQuarters} quarters (max ${maxGkQuarters} for ${format})`);
    }
  });

  // Check goalkeeper consecutive quarters rule
  playersContext.forEach(player => {
    const gkQuarters = goalkeepingCounts[player.id] || 0;
    if (gkQuarters >= 2) {
      // Find which quarters this player was goalkeeper
      const gkQuarterNumbers: number[] = [];
      quarters.forEach(quarter => {
        if (quarter.players[1] === player.id) {
          gkQuarterNumbers.push(quarter.number);
        }
      });

      // Check if goalkeeper quarters are consecutive within same half
      const isConsecutive = checkGoalkeeperConsecutiveQuarters(gkQuarterNumbers);
      if (!isConsecutive) {
        errors.push(`${player.name} played goalkeeper in quarters ${gkQuarterNumbers.join(', ')} - goalkeeper quarters must be consecutive within the same half (Q1+Q2 or Q3+Q4)`);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

export async function handleSequentialLineupGeneration(formData: FormData, user: any) {
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

    // 3. Initialize tracking
    const plannedQuarters: QuarterPlanningContext['previousQuarters'] = [];
    const quarterResults: QuarterWithDetails[] = [];

    // Debug: Show existing assignments
    console.log('Existing assignments by quarter:');
    for (let q = 1; q <= 4; q++) {
      const existing = currentLineup[q];
      if (existing && Object.keys(existing).length > 0) {
        const playingIds = Object.values(existing);
        const substitutes = teamPlayers.filter(p => !playingIds.includes(p.id)).map(p => p.id);
        console.log(`Q${q} - Playing: ${playingIds.join(', ')}, Substitutes: ${substitutes.join(', ')}`);
      } else {
        console.log(`Q${q} - No existing assignments`);
      }
    }

    // 4. Plan each quarter sequentially
    for (let quarterNum = 1; quarterNum <= 4; quarterNum++) {
      // Check if this quarter already has assignments
      const existingAssignments = currentLineup[quarterNum];
      if (existingAssignments && Object.keys(existingAssignments).length > 0) {
        // Quarter already planned, skip it
        const assignments: AIAssignment[] = Object.entries(existingAssignments).map(([posNum, playerId]) => ({
          positionNumber: parseInt(posNum),
          playerId: playerId as number
        }));

        // Calculate substitutes: players not in the existing assignments
        const playingPlayerIds = Object.values(existingAssignments);
        const substitutes = teamPlayers
          .filter(p => !playingPlayerIds.includes(p.id))
          .map(p => p.id);

        plannedQuarters.push({
          number: quarterNum,
          assignments,
          substitutes
        });

        // Debug logging for existing quarters
        console.log(`Q${quarterNum} Debug - Existing assignments: ${Object.keys(existingAssignments).length} positions`);
        console.log(`Q${quarterNum} Debug - Playing players: ${playingPlayerIds.join(', ')}`);
        console.log(`Q${quarterNum} Debug - Substitutes: ${substitutes.join(', ')}`);

        continue;
      }

      // Must-play list: players who sat out the PREVIOUS quarter only
      const lastQuarter = plannedQuarters[plannedQuarters.length - 1];
      const mustPlayPlayerIds = lastQuarter ? lastQuarter.substitutes : [];

      // Debug logging for must-play calculation
      console.log(`\nQ${quarterNum} Must-play calculation:`);
      console.log(`  Total players: ${teamPlayers.length}`);
      console.log(`  Must-play count: ${mustPlayPlayerIds.length}`);
      console.log(`  Must-play IDs: ${mustPlayPlayerIds.join(', ')}`);

      // Build quarter-specific prompts
      const systemPrompt = buildQuarterSystemPrompt({
        format: team.format as GameFormat,
        totalPlayers: teamPlayers.length,
        positionsPerQuarter,
        quarterNumber: quarterNum,
        quartersRemaining: 4 - quarterNum
      });

      const userMessage = buildQuarterUserMessage({
        userInput,
        quarterNumber: quarterNum,
        quartersRemaining: 4 - quarterNum,
        formationContext,
        playersContext,
        remainingQuartersNeeded: {}, // Not used in simplified logic
        previousQuarters: plannedQuarters,
        positionsPerQuarter,
        mustPlayPlayerIds,
        absentInjuredContext,
        quarterFormationInfo
      });

      // Save prompts for debugging
      const promptFile = await savePromptToFile(systemPrompt, userMessage);

      // Call AI to generate this quarter
      const quarterResponse = await generateSingleQuarterLineup({
        systemPrompt,
        userMessage
      });

      // Save AI response for debugging
      await saveResponseToFile(quarterResponse, promptFile);

      // Check for error
      if (quarterResponse.error) {
        console.error(`Quarter ${quarterNum} planning failed:`, quarterResponse.errorMessage);
        return data({
          success: false,
          error: `Cannot plan Quarter ${quarterNum}: ${quarterResponse.errorMessage || 'Unknown error'}`,
          partialQuarters: quarterResults
        }, { status: 400 });
      }

      // Add quarter to planned quarters
      if (quarterResponse.quarter) {
        const playingPlayerIds = quarterResponse.quarter.assignments.map(a => a.playerId);
        const computedSubstitutes = teamPlayers
          .filter(p => !playingPlayerIds.includes(p.id))
          .map(p => p.id);

        plannedQuarters.push({
          number: quarterResponse.quarter.number,
          assignments: quarterResponse.quarter.assignments,
          substitutes: computedSubstitutes
        });

        // Debug: Show what happened in this AI-generated quarter
        console.log(`\nQ${quarterNum} AI-Generated Results:`);
        console.log(`  Playing: ${quarterResponse.quarter.assignments.map(a => a.playerId).join(', ')}`);
        console.log(`  Substitutes: ${computedSubstitutes.join(', ')}`);

        // Build detailed quarter result
        const formationInfo = quarterFormationInfo[quarterNum];
        const players: Record<number, number> = {};
        const changes: Array<{
          positionNumber: number;
          positionName: string;
          playerId: number;
          playerName: string;
          isChange: boolean;
        }> = [];

        quarterResponse.quarter.assignments.forEach(assignment => {
          players[assignment.positionNumber] = assignment.playerId;

          const player = playersContext.find(p => p.id === assignment.playerId);
          const positionObj = formationInfo.positions.find((p: any) => p.number === assignment.positionNumber);
          const positionName = positionObj?.abbreviation || `Pos ${assignment.positionNumber}`;
          const currentQuarterLineup = currentLineup[quarterNum] || {};
          const existingPlayerId = currentQuarterLineup[assignment.positionNumber];
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

        const substitutes = computedSubstitutes.map((playerId: number) => {
          const player = playersContext.find(p => p.id === playerId);
          return {
            playerId,
            playerName: player?.name || 'Unknown'
          };
        });

        quarterResults.push({
          number: quarterResponse.quarter.number,
          players,
          changes,
          substitutes,
        });
      }
    }

    // 5. Debug: Show quarter-by-quarter player counts
    console.log('\nQuarter-by-quarter player counts:');
    const playerQuarterCounts: Record<number, number> = {};
    teamPlayers.forEach(p => playerQuarterCounts[p.id] = 0);

    // Count from existing assignments
    for (let q = 1; q <= 4; q++) {
      const existing = currentLineup[q];
      if (existing && Object.keys(existing).length > 0) {
        Object.values(existing).forEach(playerId => {
          playerQuarterCounts[playerId as number]++;
        });
      }
    }

    // Count from new quarters
    quarterResults.forEach(quarter => {
      Object.values(quarter.players).forEach(playerId => {
        playerQuarterCounts[playerId]++;
      });
    });

    Object.entries(playerQuarterCounts).forEach(([playerId, count]) => {
      const player = teamPlayers.find(p => p.id === parseInt(playerId));
      console.log(`${player?.name} (${playerId}): ${count} quarters`);
    });

    // 6. Validate final lineup
    const validation = validateFinalLineup({
      quarters: quarterResults,
      playersContext,
      format: team.format as GameFormat
    });

    if (!validation.isValid) {
      console.error('Final lineup validation failed:', validation.errors);
      return data({
        success: false,
        error: 'Lineup validation failed',
        validationErrors: validation.errors,
        quarters: quarterResults
      }, { status: 400 });
    }

    // 6. Return successful result
    return data({
      success: true,
      message: `Successfully planned all 4 quarters with sequential AI assistance.`,
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