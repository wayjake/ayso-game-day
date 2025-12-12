// Anthropic API client for AI lineup generation
import type { AIResponse } from './types';

export async function generateLineupWithAnthropic(params: {
  systemPrompt: string;
  userMessage: string;
}): Promise<AIResponse> {
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
      name: "generate_lineup",
      description: "Generate a complete 4-quarter soccer lineup.",
      input_schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Brief explanation of lineup strategy (50-800 characters)"
          },
          quarters: {
            type: "array",
            description: "Array of 4 quarters with complete player assignments and substitutes",
            items: {
              type: "object",
              properties: {
                number: {
                  type: "number",
                  description: "Quarter number (1-4)"
                },
                assignments: {
                  type: "array",
                  description: `Array of player assignments to field positions for this quarter.`,
                  items: {
                    type: "object",
                    properties: {
                      positionNumber: {
                        type: "number",
                        description: "Position number"
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
                  description: `Array of player IDs who are sitting out (on the bench/substitutes) this quarter. 
                                Must include ALL players not in the assignments array.
                                No player should listed as substitutes more than once.`,
                  items: {
                    type: "number",
                    description: "Player ID of a player sitting out this quarter"
                  }
                }
              },
              required: ["number", "assignments", "substitutes"]
            }
          }
        },
        required: ["message", "quarters"]
      }
    }],
    tool_choice: {
      type: "tool",
      name: "generate_lineup"
    }
  });

  // Extract the tool use from the response
  const toolUse = message.content.find((block) => block.type === 'tool_use');

  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('No tool use found in Anthropic response');
  }

  return toolUse.input as AIResponse;
}
