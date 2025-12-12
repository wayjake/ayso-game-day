// Anthropic API client for sequential quarter-by-quarter lineup generation
import type { SingleQuarterAIResponse } from './types';

export async function generateSingleQuarterLineup(params: {
  systemPrompt: string;
  userMessage: string;
}): Promise<SingleQuarterAIResponse> {
  const { systemPrompt, userMessage } = params;

  // Use Anthropic SDK
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage
      }
    ],
    tools: [{
      name: "plan_quarter",
      description: "Plan a single quarter of the lineup. CRITICAL: If there are must-play players specified in the prompt, they MUST be included in assignments. Return error if constraints cannot be met (including if you cannot assign all must-play players).",
      input_schema: {
        type: "object",
        properties: {
          error: {
            type: "boolean",
            description: "Set to true if you cannot create a valid lineup for this quarter that meets all constraints. This includes: not enough players available, cannot satisfy 3/4 rule with remaining quarters, cannot assign all must-play players, or any other impossible constraint."
          },
          errorMessage: {
            type: "string",
            description: "If error is true, explain why the quarter cannot be planned. Be specific about which constraint failed (e.g., 'Cannot assign all must-play players to positions - need 9 positions but only 7 must-play players fit the formation', 'Only 6 players have quarters remaining but need 9 positions filled')"
          },
          quarter: {
            type: "object",
            description: "The quarter lineup. Only provide if error is false. MUST include all must-play players if any were specified.",
            properties: {
              number: {
                type: "number",
                description: "Quarter number (1-4)"
              },
              assignments: {
                type: "array",
                description: "Player assignments to field positions. CRITICAL: If must-play players were specified in the prompt, ALL of them MUST appear in this array. Assign them to positions matching their positionHistory.",
                items: {
                  type: "object",
                  properties: {
                    positionNumber: {
                      type: "number",
                      description: "Position number from the formation"
                    },
                    playerId: {
                      type: "number",
                      description: "ID of the player assigned to this position"
                    }
                  },
                  required: ["positionNumber", "playerId"]
                }
              },
              substitutes: {
                type: "array",
                description: "Array of player IDs sitting out this quarter. Must include ALL players not in assignments. These players will become must-play for the next quarter (if there is one).",
                items: {
                  type: "number",
                  description: "Player ID of a player sitting out this quarter"
                }
              }
            },
            required: ["number", "assignments", "substitutes"]
          }
        },
        required: ["error"]
      }
    }],
    tool_choice: {
      type: "tool",
      name: "plan_quarter"
    }
  });

  // Extract the tool use from the response
  const toolUse = message.content.find((block) => block.type === 'tool_use');

  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('No tool use found in Anthropic response');
  }

  return toolUse.input as SingleQuarterAIResponse;
}
