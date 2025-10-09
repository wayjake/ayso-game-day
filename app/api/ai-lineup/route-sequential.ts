// Sequential quarter-by-quarter lineup generation
import { data } from "react-router";
import type { GameFormat, AIAssignment, QuarterWithDetails, QuarterPlanningContext, PlayerContext } from './types';
import {
  getTeam,
  getGame,
  getQuarterFormations,
  getTeamPlayers,
  getCurrentAssignments,
  getPastGamesAndAssignments,
  calculatePositionHistory,
  buildPlayersContext,
  buildCurrentLineup,
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
    const { pastGames, pastAssignments } = await getPastGamesAndAssignments(teamId, game.gameDate);

    // 2. Process and build context
    const positionHistory = calculatePositionHistory(teamPlayers, pastAssignments);
    const playersContext = buildPlayersContext(teamPlayers, positionHistory);
    const currentLineup = buildCurrentLineup(currentAssignments);
    const positionsPerQuarter = quarterFormationInfo[1].positions.length;
    const formationContext = buildFormationContext(quarterFormationInfo);

    // 3. Initialize tracking
    const plannedQuarters: QuarterPlanningContext['previousQuarters'] = [];
    const quarterResults: QuarterWithDetails[] = [];
    // Track all players who have been subbed out throughout the game (using Set to avoid duplicates)
    let allSubbedOutPlayers = new Set<number>();

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

        const substitutes = teamPlayers
          .filter(p => !Object.values(existingAssignments).includes(p.id))
          .map(p => p.id);

        plannedQuarters.push({
          number: quarterNum,
          assignments,
          substitutes
        });

        // Add this quarter's substitutes to the cumulative list
        substitutes.forEach(id => allSubbedOutPlayers.add(id));
        continue;
      }

      // Must-play list: players who have been subbed out (naturally empty for Q1)
      const mustPlayPlayerIds = [...allSubbedOutPlayers];

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
        mustPlayPlayerIds
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
        plannedQuarters.push({
          number: quarterResponse.quarter.number,
          assignments: quarterResponse.quarter.assignments,
          substitutes: quarterResponse.quarter.substitutes
        });

        // Add this quarter's substitutes to the cumulative list
        quarterResponse.quarter.substitutes.forEach(id => allSubbedOutPlayers.add(id));

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

        const substitutes = quarterResponse.quarter.substitutes.map((playerId: number) => {
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

    // 5. Validate final lineup
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