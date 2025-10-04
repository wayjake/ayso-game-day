import type { Route } from "./+types/api.ai-lineup";
import { data } from "react-router";

// Lazy load server-only modules to prevent client bundling
async function getServerModules() {
  const { getUser } = await import("~/utils/auth.server");
  const { db, teams, games, players, assignments, sitOuts, templateFormations } = await import("~/db");
  const { eq, and, lt, desc } = await import("drizzle-orm");
  const OpenAI = (await import("openai")).default;

  return { getUser, db, teams, games, players, assignments, sitOuts, templateFormations, eq, and, lt, desc, OpenAI };
}

export async function loader() {
  return new Response("Method not allowed", { status: 405 });
}

export async function action({ request }: Route.ActionArgs) {
  const { getUser, db, teams, games, players, assignments, sitOuts, templateFormations, eq, and, lt, desc, OpenAI } = await getServerModules();

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const user = await getUser(request);

  if (!user) {
    return data({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  if (action === "transcribe") {
    try {
      const audioFile = formData.get("audio") as File;
      if (!audioFile) {
        return data({ success: false, error: "No audio file provided" }, { status: 400 });
      }

      // Transcribe audio using Whisper
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

  if (action === "generate") {
    try {
      const gameId = parseInt(formData.get("gameId") as string);
      const teamId = parseInt(formData.get("teamId") as string);
      const userInput = formData.get("userInput") as string;
      const previousMessage = formData.get("previousMessage") as string | null;

      // Verify team ownership
      const [team] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
        .limit(1);

      if (!team) {
        return data({ success: false, error: "Team not found" }, { status: 404 });
      }

      // Get current game
      const [game] = await db
        .select()
        .from(games)
        .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
        .limit(1);

      if (!game) {
        return data({ success: false, error: "Game not found" }, { status: 404 });
      }

      // Get quarter-specific formations from game notes
      const gameNotes = game.notes ? JSON.parse(game.notes) : {};
      const quarterFormations = gameNotes.quarterFormations || {};

      // Get formation names from the formations utility
      const { getFormationsByFormat } = await import('~/utils/formations');
      const formationOptions = getFormationsByFormat(team.format as '7v7' | '9v9' | '11v11');
      const formationKeys = Object.keys(formationOptions);

      const quarterFormationInfo: Record<number, any> = {};
      for (let q = 1; q <= 4; q++) {
        const formationIndex = quarterFormations[q] ?? 0;
        const formationKey = formationKeys[formationIndex];
        const formation = (formationOptions as any)[formationKey || formationKeys[0]];

        quarterFormationInfo[q] = {
          name: formationKey || formationKeys[0],
          positions: formation?.positions || [],
        };
      }

      // Get team players with their details
      const teamPlayers = await db
        .select({
          id: players.id,
          name: players.name,
          description: players.description,
          preferredPositions: players.preferredPositions,
        })
        .from(players)
        .where(eq(players.teamId, teamId));

      // Get current lineup assignments
      const currentAssignments = await db
        .select({
          playerId: assignments.playerId,
          positionNumber: assignments.positionNumber,
          positionName: assignments.positionName,
          quarter: assignments.quarter,
          isSittingOut: assignments.isSittingOut,
        })
        .from(assignments)
        .where(eq(assignments.gameId, gameId));

      // Get absent/injured players
      const absentInjuredPlayers = await db
        .select({
          playerId: sitOuts.playerId,
          quarter: sitOuts.quarter,
          reason: sitOuts.reason,
        })
        .from(sitOuts)
        .where(and(
          eq(sitOuts.gameId, gameId),
          //or(eq(sitOuts.reason, 'absent'), eq(sitOuts.reason, 'injured'))
        ));

      // Get last 7 games that occurred before this game
      const pastGames = await db
        .select({
          id: games.id,
          gameDate: games.gameDate,
          opponent: games.opponent,
        })
        .from(games)
        .where(and(
          eq(games.teamId, teamId),
          lt(games.gameDate, game.gameDate)
        ))
        .orderBy(desc(games.gameDate))
        .limit(7);

      // Get assignments for past games
      const pastGameIds = pastGames.map(g => g.id);
      let pastAssignments: any[] = [];

      if (pastGameIds.length > 0) {
        pastAssignments = await db
          .select({
            gameId: assignments.gameId,
            playerId: assignments.playerId,
            positionNumber: assignments.positionNumber,
            positionName: assignments.positionName,
            quarter: assignments.quarter,
          })
          .from(assignments)
          .where(eq(assignments.isSittingOut, false))
          .then(results => results.filter(a => pastGameIds.includes(a.gameId)));
      }

      // Build context for AI
      const playersContext = teamPlayers.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || 'No description',
        preferredPositions: p.preferredPositions ? JSON.parse(p.preferredPositions) : [],
      }));

      // Group current assignments by quarter
      const currentLineup: Record<number, Record<number, number>> = {};
      for (let q = 1; q <= 4; q++) {
        currentLineup[q] = {};
      }
      currentAssignments.forEach(a => {
        if (!a.isSittingOut && a.quarter) {
          currentLineup[a.quarter][a.positionNumber] = a.playerId;
        }
      });

      // Format past games
      const pastGamesContext = pastGames.map(g => {
        const gameAssignments = pastAssignments.filter(a => a.gameId === g.id);
        const lineup: Record<number, Record<number, number>> = {};
        for (let q = 1; q <= 4; q++) {
          lineup[q] = {};
        }
        gameAssignments.forEach(a => {
          if (a.quarter) {
            lineup[a.quarter][a.positionNumber] = a.playerId;
          }
        });
        return {
          date: g.gameDate,
          opponent: g.opponent,
          lineup,
        };
      });

      // Absent/injured context
      const absentInjuredContext = absentInjuredPlayers.map(p => ({
        playerId: p.playerId,
        quarter: p.quarter,
        reason: p.reason,
      }));

      // Build age-specific system prompt
      const ageSpecificRules = getAgeSpecificRules(team.format as '7v7' | '9v9' | '11v11');

      // Calculate mathematical constraints
      const positionsPerQuarter = quarterFormationInfo[1].positions.length;
      const totalPlayerSlots = positionsPerQuarter * 4;
      const avgQuartersPerPlayer = Math.floor(totalPlayerSlots / teamPlayers.length);

      const systemPrompt = `You are an expert AYSO soccer coach assistant. Your job is to help coaches create optimal lineups that follow AYSO Fair Play rules and coaching best practices.

${ageSpecificRules}

MATHEMATICAL CONSTRAINT:
- You have ${teamPlayers.length} total players available
- Each quarter requires ${positionsPerQuarter} players on the field
- Total player-slots across 4 quarters = ${positionsPerQuarter} × 4 = ${totalPlayerSlots} slots
- To distribute fairly: ${totalPlayerSlots} slots ÷ ${teamPlayers.length} players = ~${avgQuartersPerPlayer} quarters per player
- EVERY player must appear in at least 3 quarters
- CRITICAL: Before returning your lineup, count each player ID across ALL quarters to verify compliance

General Coaching Strategy:
- Best players should typically sit out in the third quarter
- Aim for consistency between quarters - minimize position changes when possible
- Once a quarter has been completed (marked as completed: true), DO NOT modify it
- Consider each player's preferred positions and strengths from their descriptions

Current Team Format: ${team.format}

Return your analysis as a brief message (50-800 characters) explaining your recommended changes, followed by the complete 4-quarter lineup. Don't mention the AYSO Fair Play rules in your message.`;

      // Create position mapping for each quarter showing position number -> abbreviation
      const formattedQuarterInfo: Record<number, any> = {};
      for (let q = 1; q <= 4; q++) {
        const qInfo = quarterFormationInfo[q];
        const sortedPositions = [...qInfo.positions].sort((a, b) => a.number - b.number);

        // Create object mapping: { 1: "GK", 2: "RB", 3: "LB", ... }
        const positionMap: Record<number, string> = {};
        sortedPositions.forEach(p => {
          positionMap[p.number] = p.abbreviation;
        });

        formattedQuarterInfo[q] = {
          name: qInfo.name,
          totalPositions: sortedPositions.length,
          positions: positionMap,
          positionNumbers: sortedPositions.map(p => p.number).sort((a, b) => a - b),
        };
      }

      const userMessage = `${previousMessage ? `Previous conversation:\n${previousMessage}\n\n` : ''}Current request: ${userInput}

Formations Selected Per Quarter:
${JSON.stringify(formattedQuarterInfo, null, 2)}

IMPORTANT: You MUST assign a player to EVERY position number listed in each quarter's formation. The position numbers you must fill are listed in "positionNumbers". For example, if positionNumbers is [1,2,3,4,6,7,8,9,10], you must include exactly 9 assignments with those exact position numbers.

Players:
${JSON.stringify(playersContext, null, 2)}

Current Lineup:
${JSON.stringify(currentLineup, null, 2)}

Absent/Injured Players:
${JSON.stringify(absentInjuredContext, null, 2)}

Past 7 Games:
${JSON.stringify(pastGamesContext, null, 2)}

Please suggest an optimal lineup for all 4 quarters, ensuring EVERY position number is filled for each quarter.`;

      // Save prompt to file for debugging
      const fs = await import('fs/promises');
      const path = await import('path');
      const debugDir = path.join(process.cwd(), 'debug');
      await fs.mkdir(debugDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugFile = path.join(debugDir, `ai-lineup-prompt-${timestamp}.txt`);
      await fs.writeFile(debugFile, `SYSTEM PROMPT:\n${systemPrompt}\n\n---\n\nUSER MESSAGE:\n${userMessage}`);
      console.log(`Debug prompt saved to: ${debugFile}`);

      // Call OpenAI with structured output
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-2025-04-14",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "lineup_response",
            strict: true,
            schema: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "Brief explanation of changes (50-800 chars)",
                },
                quarters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      number: {
                        type: "integer",
                        description: "Quarter number (1-4)",
                      },
                      completed: {
                        type: "boolean",
                        description: "Whether this quarter is locked from editing",
                      },
                      assignments: {
                        type: "array",
                        description: "Array of player assignments for this quarter",
                        items: {
                          type: "object",
                          properties: {
                            positionNumber: {
                              type: "integer",
                              description: "Position number (1-11)",
                            },
                            playerId: {
                              type: "integer",
                              description: "Player ID",
                            },
                          },
                          required: ["positionNumber", "playerId"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["number", "completed", "assignments"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["message", "quarters"],
              additionalProperties: false,
            },
          },
        },
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        return data({ success: false, error: "No response from AI" }, { status: 500 });
      }

      const aiResponse = JSON.parse(responseContent);

      // Save AI response to file for debugging
      const responseFile = debugFile.replace('-prompt-', '-response-');
      await fs.writeFile(responseFile, JSON.stringify(aiResponse, null, 2));
      console.log(`Debug response saved to: ${responseFile}`);

      // Validate AYSO compliance
      const validation = validateAYSOCompliance(aiResponse, playersContext, team.format as '7v7' | '9v9' | '11v11');

      if (!validation.isValid) {
        // Build detailed error message
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

      // Convert assignments array to players object format for frontend
      const quartersWithPlayers = aiResponse.quarters.map((quarter: any) => ({
        number: quarter.number,
        completed: quarter.completed,
        players: quarter.assignments.reduce((acc: Record<number, number>, assignment: any) => {
          acc[assignment.positionNumber] = assignment.playerId;
          return acc;
        }, {}),
      }));

      return data({
        success: true,
        message: aiResponse.message,
        quarters: quartersWithPlayers,
      });
    } catch (error) {
      console.error("Error generating lineup:", error);
      return data(
        { success: false, error: "Failed to generate lineup suggestions" },
        { status: 500 }
      );
    }
  }

  return data({ success: false, error: "Invalid action" }, { status: 400 });
}

interface ValidationError {
  playerId: number;
  playerName: string;
  quartersPlayed: number;
  issue: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

function validateAYSOCompliance(
  aiResponse: any,
  teamPlayers: any[],
  format: '7v7' | '9v9' | '11v11'
): ValidationResult {
  const errors: ValidationError[] = [];

  // Count quarters per player
  const playerQuarterCount: Map<number, number> = new Map();
  const playerGoalkeeperCount: Map<number, number> = new Map();

  // Initialize counts
  teamPlayers.forEach(player => {
    playerQuarterCount.set(player.id, 0);
    playerGoalkeeperCount.set(player.id, 0);
  });

  // Count appearances across all quarters
  aiResponse.quarters.forEach((quarter: any) => {
    quarter.assignments.forEach((assignment: any) => {
      const currentCount = playerQuarterCount.get(assignment.playerId) || 0;
      playerQuarterCount.set(assignment.playerId, currentCount + 1);

      // Track goalkeeper appearances (position 1)
      if (assignment.positionNumber === 1) {
        const gkCount = playerGoalkeeperCount.get(assignment.playerId) || 0;
        playerGoalkeeperCount.set(assignment.playerId, gkCount + 1);
      }
    });
  });

  // Validate: Every player plays at least 3 quarters
  teamPlayers.forEach(player => {
    const quartersPlayed = playerQuarterCount.get(player.id) || 0;
    if (quartersPlayed < 3) {
      errors.push({
        playerId: player.id,
        playerName: player.name,
        quartersPlayed,
        issue: `Only plays ${quartersPlayed} quarter${quartersPlayed !== 1 ? 's' : ''} (minimum 3 required by 3/4 Rule)`
      });
    }
  });

  // Validate: No player plays 4 quarters until everyone has played 3 (3/4 Rule)
  const playersAt4Quarters = Array.from(playerQuarterCount.entries())
    .filter(([_, count]) => count === 4)
    .map(([playerId, _]) => playerId);

  const playersBelow3Quarters = Array.from(playerQuarterCount.entries())
    .filter(([_, count]) => count < 3)
    .map(([playerId, _]) => playerId);

  if (playersAt4Quarters.length > 0 && playersBelow3Quarters.length > 0) {
    playersAt4Quarters.forEach(playerId => {
      const player = teamPlayers.find(p => p.id === playerId);
      if (player) {
        errors.push({
          playerId: player.id,
          playerName: player.name,
          quartersPlayed: 4,
          issue: 'Plays 4 quarters while other players have not yet played 3 (violates 3/4 Rule)'
        });
      }
    });
  }

  // Validate goalkeeper limits
  const maxGKQuarters = format === '7v7' ? 2 : format === '9v9' ? 3 : 4;
  if (maxGKQuarters < 4) {
    playerGoalkeeperCount.forEach((gkCount, playerId) => {
      if (gkCount > maxGKQuarters) {
        const player = teamPlayers.find(p => p.id === playerId);
        if (player) {
          errors.push({
            playerId: player.id,
            playerName: player.name,
            quartersPlayed: gkCount,
            issue: `Plays goalkeeper ${gkCount} quarters (maximum ${maxGKQuarters} for ${format})`
          });
        }
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

function getAgeSpecificRules(format: '7v7' | '9v9' | '11v11'): string {
  switch (format) {
    case '11v11':
      return `AYSO U14 (11v11) Fair Play Rules:
- With the 3/4 Rule, all players must play at least 3 quarters per game
- No player should play 4 quarters until everyone has played 3 quarters (3/4 Rule)
- Goalkeeper MAY play all 4 quarters as keeper (as long as 3/4 rule is satisfied)
- There are 11 field positions in this format`;

    case '9v9':
      return `AYSO U12 (9v9) Fair Play Rules:
- With the 3/4 Rule, all players must play at least 3 quarters per game
- No player should play 4 quarters until everyone has played 3 quarters (3/4 Rule)
- Goalkeeper may play MAXIMUM 3 quarters as goalkeeper
- Goalkeeper MUST play another field position during the game (developmental rule - no specialization)
- There are 9 field positions in this format`;

    case '7v7':
      return `AYSO U10 (7v7) Fair Play Rules:
- With the 3/4 Rule, all players must play at least 3 quarters per game
- No player should play 4 quarters until everyone has played 3 quarters (3/4 Rule)
- Goalkeeper may play MAXIMUM 2 quarters as goalkeeper
- Goalkeeper MUST play another field position during the game (developmental rule - no specialization)
- There are 7 field positions in this format`;

    default:
      return '';
  }
}
