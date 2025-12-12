// GPT-5 approach: Single call with reasoning and structured output
// Uses Zod schema to get strongly-typed JSON directly from the model

import { data } from "react-router";
import type {
  GameFormat,
  QuarterWithDetails,
  IterationLog,
  PlayerContext,
} from './types';
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
  buildAbsentInjuredContext,
} from './data-fetchers';
import { buildFormationContext } from './prompt-builder';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const MAX_ITERATIONS = 10;

// Zod schema for the lineup response
const LineupAssignmentSchema = z.object({
  positionNumber: z.number(),
  playerId: z.number(),
});

const QuarterSchema = z.object({
  number: z.number(),
  assignments: z.array(LineupAssignmentSchema),
  substitutes: z.array(z.number()),
});

const LineupResponseSchema = z.object({
  quarters: z.array(QuarterSchema),
  message: z.string(),
});

// TypeScript type derived from Zod schema
type LineupResponse = z.infer<typeof LineupResponseSchema>;

interface HybridGenerationContext {
  teamPlayers: any[];
  playersContext: PlayerContext[];
  quarterFormationInfo: any;
  formationContext: string;
  currentLineup: any;
  pastGamesContext: any[];
  absentInjuredContext: any[];
  userInput: string;
  format: GameFormat;
  positionsPerQuarter: number;
}

export async function handleOpenAIHybridGeneration(formData: FormData, user: any) {
  try {
    const gameId = parseInt(formData.get("gameId") as string);
    const teamId = parseInt(formData.get("teamId") as string);
    const userInput = formData.get("userInput") as string;

    console.log('\n=== GPT-5 LINEUP GENERATION ===\n');
    console.log(`Game ID: ${gameId}, Team ID: ${teamId}`);
    console.log(`User Input: ${userInput}`);
    console.log(`Model: gpt-5-2025-08-07 with structured output\n`);

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
    const positionsPerQuarter = quarterFormationInfo[1].positions.length;
    const formationContext = buildFormationContext(quarterFormationInfo);

    console.log(`Context Summary:`);
    console.log(`- Total players: ${teamPlayers.length}`);
    console.log(`- Positions per quarter: ${positionsPerQuarter}`);
    console.log(`- Format: ${team.format}`);
    console.log(`- Past games: ${pastGamesContext.length}`);
    console.log(`- Absent/Injured: ${absentInjuredContext.length}`);

    // 3. Set up context
    const context: HybridGenerationContext = {
      teamPlayers,
      playersContext,
      quarterFormationInfo,
      formationContext,
      currentLineup,
      pastGamesContext,
      absentInjuredContext,
      userInput,
      format: team.format as GameFormat,
      positionsPerQuarter
    };

    // 4. Generate structured lineup with GPT-5
    console.log('\n=== GENERATING LINEUP WITH STRUCTURED OUTPUT ===');
    const extractedLineup = await generateReasoningWithChat(context);

    if (!extractedLineup || !extractedLineup.quarters) {
      return data({
        success: false,
        error: 'Failed to generate lineup'
      }, { status: 400 });
    }

    // 5. Procedural validation
    console.log('\n=== STAGE 3: VALIDATION ===');
    const validation = validateLineup(extractedLineup, context);

    if (!validation.isValid) {
      console.error('Validation failed:', validation.errors);
      return data({
        success: false,
        error: 'Lineup validation failed',
        validationErrors: validation.errors
      }, { status: 400 });
    }
    console.log('✅ All validation checks passed');

    // 6. Convert to frontend format
    const quarterResults: QuarterWithDetails[] = extractedLineup.quarters.map((quarter) => {
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

      quarter.assignments.forEach(assignment => {
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

      changes.sort((a, b) => a.positionNumber - b.positionNumber);

      const substitutes = (quarter.substitutes || []).map((playerId: number) => {
        const player = playersContext.find(p => p.id === playerId);
        const absentInjuredInfo = absentInjuredContext.find(ai => {
          const isAbsentThisQuarter = !ai.quarter || ai.quarter === qNum;
          return ai.playerId === playerId && isAbsentThisQuarter;
        });

        return {
          playerId,
          playerName: player?.name || 'Unknown',
          isAbsentInjured: !!absentInjuredInfo,
          absentInjuredReason: absentInjuredInfo?.reason
        };
      });

      return {
        number: quarter.number,
        players,
        changes,
        substitutes,
      };
    });

    console.log('\n=== LINEUP GENERATION COMPLETE ===');
    console.log(`Final message: ${extractedLineup.message}\n`);

    return data({
      success: true,
      message: extractedLineup.message,
      quarters: quarterResults
    });

  } catch (error) {
    console.error("Error in GPT-5 generation:", error);
    return data(
      { success: false, error: "Failed to generate lineup with GPT-5" },
      { status: 500 }
    );
  }
}

async function generateReasoningWithChat(
  context: HybridGenerationContext
): Promise<LineupResponse | null> {

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const userPrompt = buildReasoningPrompt(context);

  // Save prompts for debugging
  await saveReasoningPrompt('', userPrompt);

  console.log('Calling GPT-5 with structured output (Zod schema)...');
  console.log(`Prompt length: ${userPrompt.length} chars`);

  try {
    const completion = await openai.responses.parse({
      // model: "gpt-5-nano-2025-08-07",
      // model: "gpt-5-mini-2025-08-07",
      // model: "gpt-5-2025-08-07",
      model: "gpt-5.2-2025-12-11",
      input: userPrompt,
      temperature: 1,
      reasoning: { effort: "medium" },
      text: {
        format: {
          name: "lineup",
          strict: true,
          type: "json_schema",
          schema: zodToJsonSchema(LineupResponseSchema, {
            $refStrategy: "none"
          })
        }
      },
    });

    if (!completion?.output_parsed) {
      throw new Error('Response returned empty output');
    }

    console.log(`✅ Generated structured lineup`);

    // Parse and validate with Zod
    const extractedLineup = LineupResponseSchema.parse(completion.output_parsed);

    await saveReasoningOutput(JSON.stringify(extractedLineup, null, 2));
    console.log(`✅ Parsed ${extractedLineup.quarters.length} quarters`);

    return extractedLineup;

  } catch (error) {
    console.error('Error calling GPT-5:', error);
    return null;
  }
}


function buildReasoningPrompt(context: HybridGenerationContext): string {
  const absentSection = context.absentInjuredContext.length > 0
    ? `\n\nABSENT/INJURED PLAYERS:\n${context.absentInjuredContext.map(ai => {
      const player = context.playersContext.find(p => p.id === ai.playerId);
      const quarterInfo = ai.quarter ? ` Q${ai.quarter} only` : ' ALL QUARTERS';
      return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}`;
    }).join('\n')}`
    : '';

  // Build current lineup section if any quarters are already assigned
  let currentLineupSection = '';
  const hasCurrentAssignments = Object.values(context.currentLineup).some(
    (quarter: any) => Object.keys(quarter).length > 0
  );

  if (hasCurrentAssignments) {
    currentLineupSection = '\n\nCURRENT GAME LINEUP (existing assignments):';
    for (let q = 1; q <= 4; q++) {
      const quarterLineup = context.currentLineup[q] || {};
      const assignedPositions = Object.keys(quarterLineup);

      if (assignedPositions.length > 0) {
        currentLineupSection += `\n\nQ${q} Assignments:`;
        assignedPositions.forEach(posNum => {
          const playerId = quarterLineup[posNum];
          const player = context.playersContext.find(p => p.id === playerId);
          const formationInfo = context.quarterFormationInfo[q];
          const positionObj = formationInfo?.positions.find((p: any) => p.number === parseInt(posNum));
          const positionName = positionObj?.abbreviation || `Pos${posNum}`;
          currentLineupSection += `\n  - ${positionName} (${posNum}): ${player?.name || 'Unknown'} (ID: ${playerId})`;
        });
      }
    }
    currentLineupSection += '\n\nNote: Keep these assignments if they work, or adjust as needed for balance.';
  }

  // Build past games section (limit to 5 most recent for token efficiency)
  let pastGamesSection = '';
  if (context.pastGamesContext.length > 0) {
    const recentGames = context.pastGamesContext.slice(0, 5);
    pastGamesSection = '\n\nPAST GAMES LINEUPS (for context on player history):';

    recentGames.forEach(game => {
      pastGamesSection += `\n\n${game.date} vs ${game.opponent}:`;
      for (let q = 1; q <= 4; q++) {
        const quarterLineup = game.lineup[q] || {};
        const assignedPositions = Object.keys(quarterLineup);

        if (assignedPositions.length > 0) {
          const assignments = assignedPositions.map(posNum => {
            const playerId = quarterLineup[posNum];
            const player = context.playersContext.find(p => p.id === playerId);
            return `${posNum}:${player?.name || playerId}`;
          }).join(', ');
          pastGamesSection += `\n  Q${q}: ${assignments}`;
        }
      }
    });
  }

  const availablePlayers = context.teamPlayers.length - context.absentInjuredContext.filter(ai => !ai.quarter).length;
  const subsPerQuarter = availablePlayers - context.positionsPerQuarter;

  return `
        You are an soccer coach creating a complete 4-quarter game lineup for ${context.format}.
        Analyze the context provided and create a balanced lineup
        that plays everyone at least 3 quarters.

        GAME INFO:
        - Total players on roster: ${context.teamPlayers.length}
        - Available players (excluding absent/injured): ${availablePlayers}
        - Positions per quarter: ${context.positionsPerQuarter}
        - Substitutes per quarter: ${subsPerQuarter}

        ${context.formationContext}

        PLAYERS:
        ${JSON.stringify(context.playersContext, null, 2)}
        ${absentSection}
        ${currentLineupSection}
        ${pastGamesSection}

        RULES:
        1. Each player plays at least 3/4 quarters (75% rule)
        2. Goalkeepers play consecutive quarters
        3. GK limits: 7v7≤2, 9v9≤3, 11v11≤4 quarters
        4. Keep players in same positions when possible
        5. Substitutes array must include players not in assignments
        6. Substitutes must not appear in assignments
        7. IMPORTANT: Absent/injured players must NOT be in assignments OR substitutes arrays

        ${context.userInput ? `User request: ${context.userInput}` : ''}`;
}

function validateLineup(
  lineup: LineupResponse,
  context: HybridGenerationContext
): { isValid: boolean; errors: string[] } {

  const errors: string[] = [];
  const { teamPlayers, playersContext, positionsPerQuarter, format, absentInjuredContext } = context;

  console.log('Running procedural validation...');

  // Check each quarter exists
  if (lineup.quarters.length !== 4) {
    errors.push(`Expected 4 quarters, got ${lineup.quarters.length}`);
    return { isValid: false, errors };
  }

  // Track playing time
  const quarterCounts: Record<number, number> = {};
  const gkCounts: Record<number, number> = {};
  teamPlayers.forEach(p => {
    quarterCounts[p.id] = 0;
    gkCounts[p.id] = 0;
  });

  lineup.quarters.forEach(quarter => {
    const qNum = quarter.number;

    // Check quarter has correct number of assignments
    if (quarter.assignments.length !== positionsPerQuarter) {
      errors.push(`Q${qNum}: Expected ${positionsPerQuarter} assignments, got ${quarter.assignments.length}`);
    }

    // Calculate available players (excluding absent/injured for this quarter)
    const absentThisQuarter = absentInjuredContext.filter(ai =>
      ai.playerId && (!ai.quarter || ai.quarter === qNum)
    );
    const availablePlayers = teamPlayers.length - absentThisQuarter.length;

    // Check substitutes + assignments = available players
    const totalInQuarter = quarter.assignments.length + quarter.substitutes.length;
    if (totalInQuarter !== availablePlayers) {
      errors.push(`Q${qNum}: Assignments (${quarter.assignments.length}) + Substitutes (${quarter.substitutes.length}) = ${totalInQuarter}, expected ${availablePlayers} available (${teamPlayers.length} total - ${absentThisQuarter.length} absent)`);
    }

    // Check for duplicate assignments
    const assignedIds = quarter.assignments.map(a => a.playerId);
    const uniqueIds = new Set(assignedIds);
    if (assignedIds.length !== uniqueIds.size) {
      errors.push(`Q${qNum}: Duplicate player assignments detected`);
    }

    // Check player not in both assignments and substitutes
    quarter.assignments.forEach(a => {
      if (quarter.substitutes.includes(a.playerId)) {
        const player = playersContext.find(p => p.id === a.playerId);
        errors.push(`Q${qNum}: ${player?.name} (${a.playerId}) in both assignments and substitutes`);
      }
    });

    // Check absent/injured players not assigned
    absentInjuredContext.forEach(ai => {
      const isAbsentThisQuarter = !ai.quarter || ai.quarter === qNum;
      if (isAbsentThisQuarter) {
        const isAssigned = quarter.assignments.some(a => a.playerId === ai.playerId);
        if (isAssigned) {
          const player = playersContext.find(p => p.id === ai.playerId);
          errors.push(`Q${qNum}: ${player?.name} (${ai.playerId}) is ${ai.reason} but assigned to play`);
        }
      }
    });

    // Track quarter counts
    quarter.assignments.forEach(a => {
      quarterCounts[a.playerId]++;
      if (a.positionNumber === 1) {
        gkCounts[a.playerId]++;
      }
    });
  });

  // Check 75% rule (3/4 quarters minimum)
  playersContext.forEach(player => {
    const quartersPlayed = quarterCounts[player.id] || 0;

    // Account for absent/injured
    const absentQuarters = absentInjuredContext.filter(ai =>
      ai.playerId === player.id && (!ai.quarter || [1, 2, 3, 4].includes(ai.quarter))
    ).length;

    const availableQuarters = 4 - absentQuarters;
    const requiredQuarters = Math.ceil(availableQuarters * 0.75);

    if (availableQuarters > 0 && quartersPlayed < requiredQuarters) {
      errors.push(`${player.name} played ${quartersPlayed}/${availableQuarters} available quarters (needs ${requiredQuarters}+)`);
    }
  });

  // Check goalkeeper limits
  const gkLimits: Record<GameFormat, number> = { '7v7': 2, '9v9': 3, '11v11': 4 };
  const maxGkQuarters = gkLimits[format];

  playersContext.forEach(player => {
    const gkQuarters = gkCounts[player.id] || 0;
    if (gkQuarters > maxGkQuarters) {
      errors.push(`${player.name} played GK ${gkQuarters} quarters (max ${maxGkQuarters} for ${format})`);
    }
  });

  // Check goalkeeper consecutive quarters
  playersContext.forEach(player => {
    const gkQuarters = gkCounts[player.id] || 0;
    if (gkQuarters >= 2) {
      const gkQuarterNumbers: number[] = [];
      lineup.quarters.forEach(q => {
        const gkAssignment = q.assignments.find(a => a.positionNumber === 1);
        if (gkAssignment?.playerId === player.id) {
          gkQuarterNumbers.push(q.number);
        }
      });

      // Check consecutive
      gkQuarterNumbers.sort((a, b) => a - b);
      for (let i = 1; i < gkQuarterNumbers.length; i++) {
        if (gkQuarterNumbers[i] - gkQuarterNumbers[i - 1] !== 1) {
          errors.push(`${player.name} played GK in non-consecutive quarters: ${gkQuarterNumbers.join(', ')}`);
          break;
        }
      }
    }
  });

  console.log(`Validation: ${errors.length === 0 ? '✅ Passed' : `❌ ${errors.length} errors`}`);

  return {
    isValid: errors.length === 0,
    errors
  };
}

async function saveReasoningPrompt(systemMessage: string, userPrompt: string) {
  try {
    const debugDir = path.join(process.cwd(), 'debug');
    await fs.mkdir(debugDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const file = path.join(debugDir, `${timestamp}-openai-hybrid-prompt.txt`);
    const contents = `SYSTEM PROMPT:\n${systemMessage}\n\n---\n\nUSER PROMPT:\n${userPrompt}\n`;
    await fs.writeFile(file, contents, 'utf-8');
    console.log(`Saved prompt to: ${path.basename(file)}`);
  } catch (err) {
    console.warn('Failed to save prompt:', err);
  }
}

async function saveReasoningOutput(text: string) {
  try {
    const debugDir = path.join(process.cwd(), 'debug');
    await fs.mkdir(debugDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const file = path.join(debugDir, `${timestamp}-openai-hybrid-reasoning.txt`);
    await fs.writeFile(file, text, 'utf-8');
    console.log(`Saved reasoning to: ${path.basename(file)}`);
  } catch (err) {
    console.warn('Failed to save reasoning:', err);
  }
}
