// Autonomous iterative AI lineup generation
// The AI generates its own strategy and prompts, iterating until complete

import { data } from "react-router";
import type {
  GameFormat,
  QuarterWithDetails,
  AutonomousIterationResponse,
  IterationLog,
  PlayerContext,
  AIQuarter
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
  buildAbsentInjuredContext,
} from './data-fetchers';
import { buildFormationContext, savePromptToFile, saveResponseToFile } from './prompt-builder';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';

const MAX_ITERATIONS = 10; // Safety limit to prevent infinite loops

interface AutonomousGenerationContext {
  teamPlayers: any[];
  playersContext: PlayerContext[];
  quarterFormationInfo: any;
  formationContext: string;
  currentLineup: any;
  absentInjuredContext: any[];
  userInput: string;
  format: GameFormat;
  positionsPerQuarter: number;
}

export async function handleAutonomousGeneration(formData: FormData, user: any) {
  try {
    const gameId = parseInt(formData.get("gameId") as string);
    const teamId = parseInt(formData.get("teamId") as string);
    const userInput = formData.get("userInput") as string;

    console.log('\n=== AUTONOMOUS ITERATIVE AI LINEUP GENERATION ===\n');
    console.log(`Game ID: ${gameId}, Team ID: ${teamId}`);
    console.log(`User Input: ${userInput}`);

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

    console.log(`\nContext Summary:`);
    console.log(`- Total players: ${teamPlayers.length}`);
    console.log(`- Positions per quarter: ${positionsPerQuarter}`);
    console.log(`- Format: ${team.format}`);
    console.log(`- Absent/Injured: ${absentInjuredContext.length}`);

    // 3. Set up autonomous generation context
    const context: AutonomousGenerationContext = {
      teamPlayers,
      playersContext,
      quarterFormationInfo,
      formationContext,
      currentLineup,
      absentInjuredContext,
      userInput,
      format: team.format as GameFormat,
      positionsPerQuarter
    };

    // 4. Run autonomous iteration loop
    const iterationLogs: IterationLog[] = [];
    const result = await runAutonomousIterations(context, iterationLogs);

    // 5. Log all iterations
    console.log('\n=== ITERATION SUMMARY ===');
    iterationLogs.forEach(log => {
      console.log(`\nIteration ${log.iteration} [${log.timestamp}]:`);
      console.log(`Step: ${log.step}`);
      console.log(`Strategy: ${log.strategy}`);
    });

    // 6. Check for errors
    if (result.error) {
      return data({
        success: false,
        error: result.errorMessage || 'Unknown error during autonomous generation',
        iterations: iterationLogs
      }, { status: 400 });
    }

    // 7. Validate final lineup exists
    if (!result.finalLineup || !result.finalLineup.quarters) {
      return data({
        success: false,
        error: 'AI did not produce a final lineup',
        iterations: iterationLogs
      }, { status: 400 });
    }

    // 8. Convert to frontend format
    const quarterResults: QuarterWithDetails[] = result.finalLineup.quarters.map((quarter: AIQuarter) => {
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

        // Check if this player is absent/injured for this quarter
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

    console.log('\n=== AUTONOMOUS GENERATION COMPLETE ===\n');
    console.log(`Total iterations: ${iterationLogs.length}`);
    console.log(`Final reasoning: ${result.reasoning}\n`);

    return data({
      success: true,
      message: `Successfully generated lineup using autonomous AI approach (${iterationLogs.length} iterations)`,
      quarters: quarterResults,
      iterations: iterationLogs.length,
      reasoning: result.reasoning
    });

  } catch (error) {
    console.error("Error in autonomous generation:", error);
    return data(
      { success: false, error: "Failed to generate lineup with autonomous approach" },
      { status: 500 }
    );
  }
}

async function runAutonomousIterations(
  context: AutonomousGenerationContext,
  logs: IterationLog[]
): Promise<AutonomousIterationResponse> {

  let iteration = 0;
  let currentPrompt: string | null = null;
  let accumulatedContext: any = {};

  // Initial prompt with full context
  const initialPrompt = buildInitialPrompt(context);
  currentPrompt = initialPrompt;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n--- ITERATION ${iteration}/${MAX_ITERATIONS} ---`);

    // Call AI with current prompt
    const response = await callAutonomousAI(currentPrompt, iteration === 1, context, accumulatedContext);

    // Log this iteration
    const log: IterationLog = {
      iteration,
      step: response.currentStep,
      strategy: response.nextStrategy || 'No next strategy',
      results: response.currentResults,
      timestamp: new Date().toISOString()
    };
    logs.push(log);

    console.log(`Step: ${response.currentStep}`);
    console.log(`Reasoning: ${response.reasoning}`);
    console.log(`Complete: ${response.isComplete}`);

    // Update accumulated context with current results
    accumulatedContext = {
      ...accumulatedContext,
      [`iteration_${iteration}`]: response.currentResults
    };

    // Check if complete
    if (response.isComplete) {
      console.log('\n✅ AI reports completion');

      // Run final validation step
      console.log('\n--- FINAL VALIDATION ---');
      console.log('Running validation and correction pass...');

      const validationPrompt = buildValidationPrompt(context, response.finalLineup);
      const validationResponse = await callAutonomousAI(validationPrompt, false, context, accumulatedContext);

      // Log validation iteration
      const validationLog: IterationLog = {
        iteration: iteration + 1,
        step: 'Final validation and correction',
        strategy: validationResponse.nextStrategy || 'Validation complete',
        results: validationResponse.currentResults,
        timestamp: new Date().toISOString()
      };
      logs.push(validationLog);

      console.log(`Validation: ${validationResponse.currentStep}`);
      console.log(`Reasoning: ${validationResponse.reasoning}`);

      // Use validated lineup if provided, otherwise use original
      if (validationResponse.finalLineup) {
        console.log('✅ Validation complete - using corrected lineup');
        return validationResponse;
      } else {
        console.log('✅ Validation complete - no changes needed');
        return response;
      }
    }

    // Check for errors
    if (response.error) {
      console.log('\n❌ AI reports error');
      return response;
    }

    // Check if AI provided next strategy
    if (!response.nextStrategy) {
      console.log('\n⚠️ AI did not provide next strategy but not complete - treating as error');
      return {
        ...response,
        error: true,
        errorMessage: 'AI did not provide next strategy but marked incomplete'
      };
    }

    // Build the next prompt ourselves with full context + accumulated results
    currentPrompt = buildNextPrompt(context, response.nextStrategy, accumulatedContext);
    console.log(`Next strategy: ${response.nextStrategy}`);
  }

  // Max iterations reached
  console.log('\n⚠️ Max iterations reached without completion');
  return {
    isComplete: false,
    currentStep: 'Max iterations reached',
    currentResults: accumulatedContext,
    nextPrompt: null,
    nextStrategy: null,
    reasoning: `Reached maximum ${MAX_ITERATIONS} iterations without completing lineup`,
    error: true,
    errorMessage: `Maximum ${MAX_ITERATIONS} iterations reached without completion`
  };
}

function buildInitialPrompt(context: AutonomousGenerationContext): string {
  const absentSection = context.absentInjuredContext.length > 0
    ? `\n\nABSENT/INJURED PLAYERS (cannot play):\n${context.absentInjuredContext.map(ai => {
        const player = context.playersContext.find(p => p.id === ai.playerId);
        const quarterInfo = ai.quarter ? ` Q${ai.quarter} only` : ' ALL QUARTERS';
        return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}`;
      }).join('\n')}`
    : '';

  const currentLineupSection = buildCurrentLineupSection(context);

  return `You are an expert AYSO soccer coach tasked with creating a complete 4-quarter game lineup.

🎯 YOUR TASK:
Generate a complete lineup for all 4 quarters that meets AYSO Fair Play rules and user requirements.

You have FULL AUTONOMY to decide:
1. What strategy to use (e.g., plan substitutes first, assign by position, quarter-by-quarter, etc.)
2. What intermediate steps you need to take
3. What information you need to process next
4. When you're done

📋 FULL CONTEXT:

USER REQUEST: ${context.userInput}

GAME FORMAT: ${context.format}
Total players: ${context.teamPlayers.length}
Positions per quarter: ${context.positionsPerQuarter}
Substitutes per quarter: ${context.teamPlayers.length - context.positionsPerQuarter}

${context.formationContext}

PLAYERS:
${JSON.stringify(context.playersContext, null, 2)}
${absentSection}
${currentLineupSection}

AYSO FAIR PLAY RULES:
1. Each player must play at LEAST 3 out of 4 quarters (75% rule)
2. Goalkeepers must play consecutive quarters (Q1+Q2 or Q2+Q3 or Q3+Q4)
3. Goalkeeper limits: 7v7=2 quarters, 9v9=3 quarters, 11v11=4 quarters
4. Absent/injured players cannot be assigned to play

🎯 STRATEGIC GUIDANCE:

You can break this down however you want. Some strategies to consider:
- Plan all substitutes first (who sits out when)
- Assign goalkeepers for all quarters first
- Go quarter-by-quarter
- Assign by position type (all defenders, then midfielders, then forwards)
- Any other creative approach

When assigning positions, prefer consistency - keep players in the same or similar positions across quarters when possible to minimize unnecessary shifts.

In your first iteration:
1. Analyze the complete problem and constraints
2. Decide on your overall strategy
3. Begin executing your first step
4. Use the autonomous_iteration tool to report:
   - currentStep: what you accomplished
   - currentResults: concrete decisions (player IDs, positions, etc.)
   - nextStrategy: what you want to do next
   - reasoning: why you chose this approach

We'll provide you with the full context again in the next iteration along with your accumulated results.

Start now!`;
}

function buildCurrentLineupSection(context: AutonomousGenerationContext): string {
  let section = '';
  for (let q = 1; q <= 4; q++) {
    const existing = context.currentLineup[q];
    if (existing && Object.keys(existing).length > 0) {
      const assignments = Object.entries(existing).map(([posNum, playerId]) => {
        const player = context.playersContext.find(p => p.id === playerId);
        const formationInfo = context.quarterFormationInfo[q];
        const positionObj = formationInfo?.positions.find((p: any) => p.number === parseInt(posNum));
        const positionName = positionObj?.abbreviation || `Pos${posNum}`;
        return `${positionName}(${posNum}): ${player?.name || 'Unknown'} (${playerId})`;
      }).join(', ');
      section += `\nQ${q} Current: ${assignments}`;
    }
  }

  if (section) {
    return `\n\nCURRENT LINEUP (you can use as reference or modify):${section}\n`;
  }

  return '';
}

function buildValidationPrompt(
  context: AutonomousGenerationContext,
  proposedLineup: any
): string {
  const absentSection = context.absentInjuredContext.length > 0
    ? `\n\nABSENT/INJURED PLAYERS (cannot play):\n${context.absentInjuredContext.map(ai => {
        const player = context.playersContext.find(p => p.id === ai.playerId);
        const quarterInfo = ai.quarter ? ` Q${ai.quarter} only` : ' ALL QUARTERS';
        return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}`;
      }).join('\n')}`
    : '';

  return `FINAL VALIDATION AND CORRECTION

You have generated a complete lineup. Now validate it against all AYSO rules and make any necessary corrections.

PROPOSED LINEUP:
${JSON.stringify(proposedLineup, null, 2)}

PLAYERS (for reference):
${JSON.stringify(context.playersContext, null, 2)}
${absentSection}

GAME FORMAT: ${context.format}
Total players: ${context.teamPlayers.length}
Positions per quarter: ${context.positionsPerQuarter}

VALIDATION CHECKLIST:

1. ✓ Each quarter has exactly ${context.positionsPerQuarter} assignments (positions 1-${context.positionsPerQuarter})
2. ✓ Each quarter's substitutes array includes ALL players not in assignments (should be ${context.teamPlayers.length - context.positionsPerQuarter} players)
3. ✓ Every player plays at least 3 out of 4 quarters (75% rule)
4. ✓ Goalkeepers play consecutive quarters (Q1+Q2 or Q2+Q3 or Q3+Q4)
5. ✓ Goalkeeper limits: 7v7≤2 quarters, 9v9≤3 quarters, 11v11≤4 quarters
6. ✓ No player assigned to multiple positions in same quarter
7. ✓ No player both in assignments AND substitutes in same quarter
8. ✓ Absent/injured players are only in substitutes, never in assignments
9. ✓ All player IDs are valid (from the players list)

YOUR TASK:
Check each rule above. If ALL rules pass, set isComplete=true with currentResults showing validation passed.
If ANY rule fails, make corrections and provide the corrected finalLineup.

Use the autonomous_iteration tool to report validation results.`;
}

function buildNextPrompt(
  context: AutonomousGenerationContext,
  nextStrategy: string,
  accumulatedResults: any
): string {
  const absentSection = context.absentInjuredContext.length > 0
    ? `\n\nABSENT/INJURED PLAYERS (cannot play):\n${context.absentInjuredContext.map(ai => {
        const player = context.playersContext.find(p => p.id === ai.playerId);
        const quarterInfo = ai.quarter ? ` Q${ai.quarter} only` : ' ALL QUARTERS';
        return `- ${player?.name || 'Unknown'} (ID: ${ai.playerId})${quarterInfo}: ${ai.reason}`;
      }).join('\n')}`
    : '';

  const currentLineupSection = buildCurrentLineupSection(context);

  return `Continue working on the AYSO soccer lineup.

CURRENT TASK: ${nextStrategy}

ACCUMULATED RESULTS FROM PREVIOUS STEPS:
${JSON.stringify(accumulatedResults, null, 2)}

📋 FULL CONTEXT (reminder):

USER REQUEST: ${context.userInput}

GAME FORMAT: ${context.format}
Total players: ${context.teamPlayers.length}
Positions per quarter: ${context.positionsPerQuarter}
Substitutes per quarter: ${context.teamPlayers.length - context.positionsPerQuarter}

${context.formationContext}

PLAYERS:
${JSON.stringify(context.playersContext, null, 2)}
${absentSection}
${currentLineupSection}

AYSO FAIR PLAY RULES:
1. Each player must play at LEAST 3 out of 4 quarters (75% rule)
2. Goalkeepers must play consecutive quarters (Q1+Q2 or Q2+Q3 or Q3+Q4)
3. Goalkeeper limits: 7v7=2 quarters, 9v9=3 quarters, 11v11=4 quarters
4. Absent/injured players cannot be assigned to play

POSITION CONSISTENCY:
Keep players in the same or similar positions across the quarters they play. Minimize unnecessary position changes.

Execute the current task and report your results using the autonomous_iteration tool.`;
}

async function callAutonomousAI(
  prompt: string,
  isFirstIteration: boolean,
  context: AutonomousGenerationContext,
  accumulatedContext: any
): Promise<AutonomousIterationResponse> {

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const systemPrompt = `You are an autonomous AI agent capable of strategic planning and iterative problem-solving.
You are helping create AYSO soccer game lineups.

You have the ability to:
1. Analyze complex problems
2. Break them down into steps
3. Execute steps iteratively
4. Generate your own prompts for next steps
5. Decide when you're done

Use the autonomous_iteration tool to report your progress, next steps, and final results.`;

  // Prompt is already complete (buildNextPrompt includes accumulated context)
  const fullPrompt = prompt;

  console.log(`\nCalling Anthropic API...`);
  console.log(`Prompt length: ${fullPrompt.length} chars`);

  // Save iteration prompt for debugging
  const debugDir = path.join(process.cwd(), 'debug');
  await fs.mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const iterationFile = path.join(debugDir, `${timestamp}-autonomous-iteration-${!isFirstIteration ? 'N' : '1'}.txt`);

  try {
    await fs.writeFile(iterationFile, `ITERATION ${!isFirstIteration ? 'N' : '1'}\n\nSYSTEM PROMPT:\n${systemPrompt}\n\n---\n\nUSER PROMPT:\n${fullPrompt}\n`, 'utf-8');
  } catch (err) {
    console.warn('Failed to save iteration prompt:', err);
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      temperature: 1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: fullPrompt
        }
      ],
      tools: [{
        name: "autonomous_iteration",
        description: "Execute one iteration of autonomous lineup planning. Report current progress, results, and next steps.",
        input_schema: {
          type: "object",
          properties: {
            isComplete: {
              type: "boolean",
              description: "Set to true if you have completed the lineup and have final results ready. Set to false if you need more iterations."
            },
            currentStep: {
              type: "string",
              description: "Description of what you accomplished in this iteration (e.g., 'Planned substitute rotation for all quarters', 'Assigned goalkeepers')"
            },
            currentResults: {
              type: "object",
              description: "The concrete results/decisions from this iteration as structured data. Examples: {'substitutes': {1: [playerId, ...], 2: [...], ...}}, {'goalkeepers': {1: playerId, 2: playerId, ...}}, {'Q1_assignments': [{positionNumber: 1, playerId: 123}, ...]}"
            },
            nextStrategy: {
              type: ["string", "null"],
              description: "Brief description of what you want to accomplish in the next iteration. Set to null if isComplete is true. Examples: 'Assign goalkeepers for all quarters', 'Fill remaining field positions', 'Validate and finalize lineup'"
            },
            reasoning: {
              type: "string",
              description: "Your reasoning for the decisions made in this iteration and why you chose this approach."
            },
            finalLineup: {
              type: "object",
              description: "The complete final lineup. ONLY include when isComplete is true.",
              properties: {
                quarters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      number: {
                        type: "number",
                        description: "Quarter number (1-4)"
                      },
                      assignments: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            positionNumber: { type: "number" },
                            playerId: { type: "number" }
                          },
                          required: ["positionNumber", "playerId"]
                        }
                      },
                      substitutes: {
                        type: "array",
                        items: { type: "number" },
                        description: "Player IDs sitting out this quarter. MUST include ALL players not in assignments"
                      }
                    },
                    required: ["number", "assignments", "substitutes"]
                  }
                }
              }
            },
            error: {
              type: "boolean",
              description: "Set to true if you encountered an error that prevents completion"
            },
            errorMessage: {
              type: "string",
              description: "If error is true, explain what went wrong"
            }
          },
          required: ["isComplete", "currentStep", "currentResults", "reasoning"]
        }
      }],
      tool_choice: {
        type: "tool",
        name: "autonomous_iteration"
      }
    });

    // Extract the tool use from the response
    const toolUse = message.content.find((block: any) => block.type === 'tool_use');

    if (!toolUse || !toolUse.input) {
      throw new Error('No tool use found in Anthropic response');
    }

    const response = toolUse.input as AutonomousIterationResponse;

    // Save response for debugging
    const responseFile = iterationFile.replace('.txt', '-response.json');
    try {
      await fs.writeFile(responseFile, JSON.stringify(response, null, 2), 'utf-8');
      console.log(`Saved response to: ${path.basename(responseFile)}`);
    } catch (err) {
      console.warn('Failed to save response:', err);
    }

    return response;

  } catch (error) {
    console.error('Error calling AI:', error);
    return {
      isComplete: false,
      currentStep: 'Error',
      currentResults: {},
      nextPrompt: null,
      nextStrategy: null,
      reasoning: `Error calling AI: ${error}`,
      error: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
