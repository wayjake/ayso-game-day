// OpenAI approach: single call with reasoning and structured output, one retry
// with the validation errors if the first lineup breaks a rule.
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

export const maxDuration = 120;

// Newest model first. If the API rejects it (unknown model, unsupported
// parameter) we fall back to the last model verified with this route.
// Set OPENAI_LINEUP_MODEL to pin a different one.
const PRIMARY_MODEL = process.env.OPENAI_LINEUP_MODEL || "gpt-6.1-sol";
const FALLBACK_MODEL = "gpt-5.2-2025-12-11";

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

export interface HybridGenerationContext {
  teamPlayers: any[];
  playersContext: PlayerContext[];
  quarterFormationInfo: any;
  formationContext: string;
  currentLineup: any;
  pastGamesContext: any[];
  absentInjuredContext: any[];
  userInput: string;
  format: GameFormat;
  availability: Availability;
}

const QUARTERS = [1, 2, 3, 4] as const;

// Who can play each quarter, and how many positions can actually be filled.
// The prompt and the validator both read from this so they can't disagree.
export interface Availability {
  availableByQuarter: Record<number, Set<number>>;
  positionsByQuarter: Record<number, number[]>;
  // min(formation positions, available players): fewer than the formation means playing short
  slotsByQuarter: Record<number, number>;
  absentQuartersByPlayer: Map<number, { quarters: number[]; reason: string }>;
}

export function buildAvailability(
  teamPlayers: { id: number }[],
  absentInjuredContext: { playerId: number; quarter: number | null; reason: string }[],
  quarterFormationInfo: Record<number, { positions: { number: number }[] }>
): Availability {
  const absentQuartersByPlayer = new Map<number, { quarters: number[]; reason: string }>();
  for (const ai of absentInjuredContext) {
    const quarters = ai.quarter ? [ai.quarter] : [...QUARTERS];
    const entry = absentQuartersByPlayer.get(ai.playerId) ?? { quarters: [], reason: ai.reason };
    entry.quarters = [...new Set([...entry.quarters, ...quarters])].sort();
    absentQuartersByPlayer.set(ai.playerId, entry);
  }

  const availableByQuarter: Record<number, Set<number>> = {};
  const positionsByQuarter: Record<number, number[]> = {};
  const slotsByQuarter: Record<number, number> = {};

  for (const q of QUARTERS) {
    availableByQuarter[q] = new Set(
      teamPlayers
        .filter((p) => !absentQuartersByPlayer.get(p.id)?.quarters.includes(q))
        .map((p) => p.id)
    );
    positionsByQuarter[q] = (quarterFormationInfo[q]?.positions ?? []).map((p) => p.number).sort((a, b) => a - b);
    slotsByQuarter[q] = Math.min(positionsByQuarter[q].length, availableByQuarter[q].size);
  }

  return { availableByQuarter, positionsByQuarter, slotsByQuarter, absentQuartersByPlayer };
}

export async function handleOpenAIHybridGeneration(formData: FormData, user: any) {
  try {
    const gameId = parseInt(formData.get("gameId") as string);
    const teamId = parseInt(formData.get("teamId") as string);
    const userInput = formData.get("userInput") as string;

    console.log('\n=== AI LINEUP GENERATION ===\n');
    console.log(`Game ID: ${gameId}, Team ID: ${teamId}`);
    console.log(`User Input: ${userInput}`);
    console.log(`Model: ${PRIMARY_MODEL} (fallback ${FALLBACK_MODEL}) with structured output\n`);

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
    const formationContext = buildFormationContext(quarterFormationInfo);
    const availability = buildAvailability(teamPlayers, absentInjuredContext, quarterFormationInfo);

    console.log(`Context Summary:`);
    console.log(`- Total players: ${teamPlayers.length}`);
    console.log(`- Available / slots per quarter: ${QUARTERS.map(q => `Q${q} ${availability.availableByQuarter[q].size}/${availability.slotsByQuarter[q]}`).join(', ')}`);
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
      availability,
    };

    // 4. Generate structured lineup
    console.log('\n=== GENERATING LINEUP WITH STRUCTURED OUTPUT ===');
    let attempt = await generateLineup(buildReasoningPrompt(context), PRIMARY_MODEL);

    if (!attempt) {
      return data({
        success: false,
        error: 'Failed to generate lineup'
      }, { status: 400 });
    }

    // 5. Procedural validation, with one retry that shows the model its mistakes
    console.log('\n=== VALIDATION ===');
    let validation = validateLineup(attempt.lineup, context);

    if (!validation.isValid) {
      console.warn('Validation failed, retrying once:', validation.errors);
      const retry = await generateLineup(buildReasoningPrompt(context, validation.errors), attempt.model);
      if (retry) {
        attempt = retry;
        validation = validateLineup(attempt.lineup, context);
      }
    }

    if (!validation.isValid) {
      console.error('Validation failed:', validation.errors);
      return data({
        success: false,
        error: ['Lineup validation failed:', ...validation.errors.map(e => `• ${e}`)].join('\n'),
        validationErrors: validation.errors
      }, { status: 400 });
    }
    console.log(`✅ All validation checks passed (model: ${attempt.model})`);

    const extractedLineup = attempt.lineup;
    const message = [extractedLineup.message, ...validation.notes].filter(Boolean).join('\n\n');

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
    console.log(`Final message: ${message}\n`);

    return data({
      success: true,
      message,
      quarters: quarterResults
    });

  } catch (error) {
    console.error("Error in AI lineup generation:", error);
    return data(
      { success: false, error: "Failed to generate lineup" },
      { status: 500 }
    );
  }
}

async function callModel(openai: OpenAI, model: string, prompt: string): Promise<LineupResponse> {
  const completion = await openai.responses.parse({
    model,
    input: prompt,
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

  return LineupResponseSchema.parse(completion.output_parsed);
}

async function generateLineup(
  prompt: string,
  model: string
): Promise<{ lineup: LineupResponse; model: string } | null> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Save prompts for debugging
  await saveReasoningPrompt('', prompt);

  console.log(`Calling ${model} with structured output (Zod schema)...`);
  console.log(`Prompt length: ${prompt.length} chars`);

  try {
    let usedModel = model;
    let lineup: LineupResponse;
    try {
      lineup = await callModel(openai, model, prompt);
    } catch (error) {
      // A 4xx means the request itself was rejected (unknown model, unsupported
      // parameter), so the fallback model can still answer it
      const rejected = error instanceof OpenAI.APIError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (!rejected || model === FALLBACK_MODEL) throw error;
      console.warn(`${model} rejected the request (${(error as InstanceType<typeof OpenAI.APIError>).status}): ${(error as Error).message}. Falling back to ${FALLBACK_MODEL}.`);
      usedModel = FALLBACK_MODEL;
      lineup = await callModel(openai, FALLBACK_MODEL, prompt);
    }

    await saveReasoningOutput(JSON.stringify(lineup, null, 2));
    console.log(`✅ ${usedModel} returned ${lineup.quarters.length} quarters`);

    return { lineup, model: usedModel };

  } catch (error) {
    console.error(`Error calling ${model}:`, error);
    return null;
  }
}


export function buildReasoningPrompt(context: HybridGenerationContext, previousErrors: string[] = []): string {
  const { availableByQuarter, positionsByQuarter, slotsByQuarter, absentQuartersByPlayer } = context.availability;

  const absentSection = absentQuartersByPlayer.size > 0
    ? `\n\nABSENT/INJURED PLAYERS (must NOT appear in assignments or substitutes for these quarters):\n${[...absentQuartersByPlayer.entries()].map(([playerId, { quarters, reason }]) => {
      const player = context.playersContext.find(p => p.id === playerId);
      const quarterInfo = quarters.length === 4 ? 'whole game' : quarters.map(q => `Q${q}`).join(', ');
      return `- ${player?.name || 'Unknown'} (ID: ${playerId}): ${reason}, ${quarterInfo}`;
    }).join('\n')}`
    : '';

  const quarterPlan = QUARTERS.map(q => {
    const available = availableByQuarter[q].size;
    const positions = positionsByQuarter[q].length;
    const slots = slotsByQuarter[q];
    if (available < positions) {
      return `- Q${q}: ${available} available players for ${positions} positions. PLAY SHORT: assign all ${available} players (exactly ${slots} assignments), leave ${positions - available} position(s) empty, never the goalkeeper (position 1). 0 substitutes.`;
    }
    return `- Q${q}: ${available} available players for ${positions} positions. Exactly ${slots} assignments and ${available - slots} substitutes.`;
  }).join('\n');

  const retrySection = previousErrors.length > 0
    ? `\n\nYOUR PREVIOUS LINEUP FAILED THESE CHECKS. Fix every one of them:\n${previousErrors.map(e => `- ${e}`).join('\n')}`
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

  return `
        You are an soccer coach creating a complete 4-quarter game lineup for ${context.format}.
        Analyze the context provided and create a balanced lineup
        that plays everyone at least 3 quarters.

        GAME INFO:
        - Total players on roster: ${context.teamPlayers.length}
        - Players and positions by quarter:
        ${quarterPlan}

        ${context.formationContext}

        PLAYERS:
        ${JSON.stringify(context.playersContext, null, 2)}
        ${absentSection}
        ${currentLineupSection}
        ${pastGamesSection}

        RULES:
        1. Each player plays at least 3 quarters, or every quarter they are available if that is fewer than 3 (75% rule)
        2. Goalkeepers play consecutive quarters
        3. GK limits: 7v7≤2, 9v9≤3, 11v11≤4 quarters
        4. Keep players in same positions when possible
        5. Each quarter has exactly the number of assignments listed above. Every positionNumber comes from that quarter's formation and is used at most once. Position 1 (GK) is always filled.
        6. Substitutes are exactly the available players who are not in assignments
        7. IMPORTANT: Absent/injured players must NOT be in assignments OR substitutes for the quarters they are out
        ${retrySection}

        ${context.userInput ? `User request: ${context.userInput}` : ''}`;
}

export function validateLineup(
  lineup: LineupResponse,
  context: HybridGenerationContext
): { isValid: boolean; errors: string[]; notes: string[] } {

  const errors: string[] = [];
  const notes: string[] = [];
  const { teamPlayers, playersContext, format, availability } = context;
  const { availableByQuarter, positionsByQuarter, slotsByQuarter, absentQuartersByPlayer } = availability;
  const nameOf = (id: number) => playersContext.find(p => p.id === id)?.name ?? `Unknown player ${id}`;
  const rosterIds = new Set(teamPlayers.map(p => p.id));

  console.log('Running procedural validation...');

  // Check each quarter exists exactly once
  const quarterNumbers = lineup.quarters.map(q => q.number).sort();
  if (lineup.quarters.length !== 4 || quarterNumbers.join(',') !== '1,2,3,4') {
    errors.push(`Expected quarters 1-4, got ${quarterNumbers.join(', ') || 'none'}`);
    return { isValid: false, errors, notes };
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
    const available = availableByQuarter[qNum];
    const validPositions = new Set(positionsByQuarter[qNum]);
    const slots = slotsByQuarter[qNum];

    // Right number of players on the field (fewer than the formation when playing short)
    if (quarter.assignments.length !== slots) {
      const short = slots < positionsByQuarter[qNum].length ? ` (only ${available.size} players available, so play short)` : '';
      errors.push(`Q${qNum}: Expected ${slots} assignments, got ${quarter.assignments.length}${short}`);
    }

    // Positions must exist in this quarter's formation, once each, and GK is always filled
    const positionNumbers = quarter.assignments.map(a => a.positionNumber);
    const invalidPositions = positionNumbers.filter(n => !validPositions.has(n));
    if (invalidPositions.length > 0) {
      errors.push(`Q${qNum}: Position(s) ${[...new Set(invalidPositions)].join(', ')} are not in this quarter's formation`);
    }
    if (positionNumbers.length !== new Set(positionNumbers).size) {
      errors.push(`Q${qNum}: The same position is assigned to more than one player`);
    }
    if (slots > 0 && !positionNumbers.includes(1)) {
      errors.push(`Q${qNum}: No goalkeeper (position 1) assigned`);
    }

    // Check for duplicate assignments
    const assignedIds = quarter.assignments.map(a => a.playerId);
    if (assignedIds.length !== new Set(assignedIds).size) {
      errors.push(`Q${qNum}: Duplicate player assignments detected`);
    }

    // Check player not in both assignments and substitutes
    quarter.assignments.forEach(a => {
      if (quarter.substitutes.includes(a.playerId)) {
        errors.push(`Q${qNum}: ${nameOf(a.playerId)} (${a.playerId}) in both assignments and substitutes`);
      }
    });

    // Everyone on the field or bench must be on the roster and available this quarter
    [...assignedIds, ...quarter.substitutes].forEach(id => {
      if (!rosterIds.has(id)) {
        errors.push(`Q${qNum}: Player ID ${id} is not on this team`);
      } else if (!available.has(id)) {
        const reason = absentQuartersByPlayer.get(id)?.reason ?? 'unavailable';
        const where = assignedIds.includes(id) ? 'assigned to play' : 'listed as a substitute';
        errors.push(`Q${qNum}: ${nameOf(id)} (${id}) is ${reason} but ${where}`);
      }
    });

    // Every available player is either playing or on the bench
    const accountedFor = new Set([...assignedIds, ...quarter.substitutes]);
    const missing = [...available].filter(id => !accountedFor.has(id));
    if (missing.length > 0) {
      errors.push(`Q${qNum}: ${missing.map(id => `${nameOf(id)} (${id})`).join(', ')} missing from both assignments and substitutes`);
    }

    // Track quarter counts
    quarter.assignments.forEach(a => {
      if (!rosterIds.has(a.playerId)) return;
      quarterCounts[a.playerId]++;
      if (a.positionNumber === 1) {
        gkCounts[a.playerId]++;
      }
    });
  });

  // Check 75% rule (3 quarters, or every available quarter if fewer). When
  // injuries leave fewer field spots than that adds up to, it can't be met, so
  // note it instead of failing every attempt.
  const requiredQuarters = (playerId: number) =>
    Math.min(3, QUARTERS.filter(q => availableByQuarter[q].has(playerId)).length);
  const totalRequired = playersContext.reduce((sum, p) => sum + requiredQuarters(p.id), 0);
  const totalSlots = QUARTERS.reduce((sum, q) => sum + slotsByQuarter[q], 0);

  if (totalRequired <= totalSlots) {
    playersContext.forEach(player => {
      const required = requiredQuarters(player.id);
      const quartersPlayed = quarterCounts[player.id] || 0;
      if (required > 0 && quartersPlayed < required) {
        const availableQuarters = QUARTERS.filter(q => availableByQuarter[q].has(player.id)).length;
        errors.push(`${player.name} played ${quartersPlayed}/${availableQuarters} available quarters (needs ${required}+)`);
      }
    });
  } else {
    notes.push(`Note: with ${totalSlots} field spots across the game, not every player can get 3 quarters, so the 3/4 rule couldn't be fully met.`);
  }

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
    errors,
    notes
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
