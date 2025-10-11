// Main route file for AI lineup API
import type { Route } from "./+types/route";
import { data } from "react-router";
import type { QuarterWithDetails, GameFormat } from './types';
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
  buildPastGamesContext,
  buildAbsentInjuredContext
} from './data-fetchers';
import {
  buildSystemPrompt,
  buildFormationContext,
  buildUserMessage,
  savePromptToFile,
  saveResponseToFile
} from './prompt-builder';
import { generateLineupWithAnthropic } from './ai-client';
import { validateAYSOCompliance } from './validation';

// Lazy load server-only modules for auth
async function getAuth() {
  const { getUser } = await import("~/utils/auth.server");
  return { getUser };
}

export async function loader() {
  return new Response("Method not allowed", { status: 405 });
}

export async function action({ request }: Route.ActionArgs) {
  const { getUser } = await getAuth();
  const user = await getUser(request);

  if (!user) {
    return data({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  // Handle transcription action (still uses OpenAI Whisper)
  if (action === "transcribe") {
    return handleTranscription(formData);
  }

  // Handle lineup generation action (uses Anthropic with sequential quarter planning)
  if (action === "generate") {
    // Use OpenAI hybrid approach (GPT-5-chat reasoning + GPT-5-nano extraction)
    const { handleOpenAIHybridGeneration } = await import('./route-openai-hybrid');
    return handleOpenAIHybridGeneration(formData, user);

    // Other approaches (kept for reference):
    // Anthropic autonomous:
    // const { handleAutonomousGeneration } = await import('./route-autonomous');
    // return handleAutonomousGeneration(formData, user);

    // Anthropic sequential by position:
    // const { handleSequentialByPositionGeneration } = await import('./route-sequential-by-position');
    // return handleSequentialByPositionGeneration(formData, user);

    // Anthropic sequential:
    // const { handleSequentialLineupGeneration } = await import('./route-sequential');
    // return handleSequentialLineupGeneration(formData, user);
  }

  return data({ success: false, error: "Invalid action" }, { status: 400 });
}

async function handleTranscription(formData: FormData) {
  try {
    const audioFile = formData.get("audio") as File;
    if (!audioFile) {
      return data({ success: false, error: "No audio file provided" }, { status: 400 });
    }

    // Use OpenAI Whisper for transcription
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });

    return data({ success: true, text: transcription.text });
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return data({ success: false, error: "Failed to transcribe audio" }, { status: 500 });
  }
}

async function handleLineupGeneration(formData: FormData, user: any) {
  try {
    const gameId = parseInt(formData.get("gameId") as string);
    const teamId = parseInt(formData.get("teamId") as string);
    const userInput = formData.get("userInput") as string;
    const previousMessage = formData.get("previousMessage") as string | null;

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
    const pastGamesContext = buildPastGamesContext(pastGames, pastAssignments);
    const absentInjuredContext = buildAbsentInjuredContext(absentInjuredPlayers);

    // 3. Build prompts
    const positionsPerQuarter = quarterFormationInfo[1].positions.length;
    const systemPrompt = buildSystemPrompt({
      format: team.format as GameFormat,
      totalPlayers: teamPlayers.length,
      positionsPerQuarter
    });

    const formationContext = buildFormationContext(quarterFormationInfo);
    const userMessage = buildUserMessage({
      userInput,
      previousMessage,
      totalPlayers: teamPlayers.length,
      formationContext,
      playersContext,
      currentLineup,
      absentInjuredContext,
      positionsPerQuarter
    });

    // 4. Save prompts for debugging
    const promptFile = await savePromptToFile(systemPrompt, userMessage);

    // 5. Call AI to generate lineup
    const aiResponse = await generateLineupWithAnthropic({
      systemPrompt,
      userMessage
    });

    // 6. Save AI response for debugging
    await saveResponseToFile(aiResponse, promptFile);

    // 7. Validate AYSO compliance
    const validation = validateAYSOCompliance(aiResponse, playersContext, team.format as GameFormat);

    if (!validation.isValid) {
      const errorMessages = validation.errors.map(err =>
        `${err.playerName}: ${err.issue}`
      );
      const errorSummary = `AI lineup suggestion violates AYSO Fair Play rules:\n\n${errorMessages.join('\n')}`;
      console.error('AYSO Validation Failed:', errorSummary);

      return data({
        success: false,
        error: errorSummary
      }, { status: 400 });
    }

    // 8. Convert to frontend format with detailed changes
    const quartersWithDetails: QuarterWithDetails[] = aiResponse.quarters.map((quarter) => {
      const qNum = quarter.number;
      const currentQuarterLineup = currentLineup[qNum] || {};
      const formationInfo = quarterFormationInfo[qNum];

      const players: Record<number, number> = {};
      const changes: Array<{
        positionNumber: number;
        positionName: string;
        playerId: number;
        playerName: string;
        isChange: boolean;
      }> = [];

      quarter.assignments.forEach((assignment) => {
        players[assignment.positionNumber] = assignment.playerId;

        const player = playersContext.find(p => p.id === assignment.playerId);
        const positionObj = formationInfo.positions.find((p: any) => p.number === assignment.positionNumber);
        const positionName = positionObj?.abbreviation || `Pos ${assignment.positionNumber}`;
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

      // Sort changes by position number
      changes.sort((a, b) => a.positionNumber - b.positionNumber);

      // Map substitutes to include player names
      const substitutes = (quarter.substitutes || []).map((playerId: number) => {
        const player = playersContext.find(p => p.id === playerId);
        return {
          playerId,
          playerName: player?.name || 'Unknown'
        };
      });

      return {
        number: quarter.number,
        players,
        changes,
        substitutes,
      };
    });

    return data({
      success: true,
      message: aiResponse.message,
      quarters: quartersWithDetails,
    });

  } catch (error) {
    console.error("Error generating lineup:", error);
    return data(
      { success: false, error: "Failed to generate lineup suggestions" },
      { status: 500 }
    );
  }
}
