// AI-powered roster data extraction using Claude vision

import type { AIExtractionResult, ExtractedPlayer } from './types';
import type { FileCategory } from './validation';

const ROSTER_EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant for a youth soccer team management app.
Your task is to extract player roster information from the provided content.

EXTRACTION RULES:
1. Extract player names - look for full names (first and last when available)
2. Extract jersey numbers if present (typically 1-99)
3. Extract preferred positions if mentioned (GK, CB, RB, LB, CM, CDM, CAM, RM, LM, ST, CF, LW, RW)
4. Note any additional info like "captain", age, or grade level in the notes field
5. Ignore header rows, totals, column titles, or non-player data
6. Clean up names: proper case (capitalize first letters), remove extra whitespace
7. If a row seems incomplete (name only partially visible), mark confidence as lower (0.5-0.7)
8. For clear, complete entries, use confidence 0.9-1.0

COMMON FORMATS TO RECOGNIZE:
- Spreadsheet screenshots with columns: Name, Number, Position
- Handwritten roster lists
- Team management app exports
- Email lists with player names
- PDF roster documents
- CSV/text files with player data

OUTPUT FORMAT:
Return data using the extract_roster_data tool with an array of player objects.
Each player should have: name (required), jerseyNumber (optional), preferredPositions (optional array), notes (optional), confidence (required, 0-1).`;

const extractionTool = {
  name: 'extract_roster_data',
  description: 'Extract roster data from the provided content',
  input_schema: {
    type: 'object' as const,
    properties: {
      players: {
        type: 'array',
        description: 'Array of extracted player data',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: "Player's full name",
            },
            jerseyNumber: {
              type: 'number',
              description: 'Jersey number (1-99)',
            },
            preferredPositions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Position abbreviations (GK, CB, RB, LB, CM, etc.)',
            },
            notes: {
              type: 'string',
              description: 'Additional extracted info (captain, age, etc.)',
            },
            confidence: {
              type: 'number',
              description: 'Extraction confidence 0-1',
            },
          },
          required: ['name', 'confidence'],
        },
      },
      extractionNotes: {
        type: 'string',
        description: 'Notes about the extraction process, any issues encountered',
      },
    },
    required: ['players'],
  },
};

/**
 * Convert file buffer to base64
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Get media type for Claude API
 */
function getMediaType(
  fileCategory: FileCategory,
  mimeType: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (fileCategory === 'image') {
    if (mimeType === 'image/png') return 'image/png';
    if (mimeType === 'image/gif') return 'image/gif';
    if (mimeType === 'image/webp') return 'image/webp';
    return 'image/jpeg'; // Default for jpeg/jpg
  }
  // PDF will be converted to image, default to png
  return 'image/png';
}

/**
 * Build message content for Claude based on file type
 */
function buildMessageContent(
  fileContent: string | ArrayBuffer,
  fileCategory: FileCategory,
  mimeType: string
): Array<{ type: string; text?: string; source?: object }> {
  if (fileCategory === 'text') {
    // Text content is sent directly
    return [
      {
        type: 'text',
        text: `Please extract player roster data from this text content:\n\n${fileContent as string}`,
      },
    ];
  }

  // Image content (including converted PDFs)
  const base64Data = bufferToBase64(fileContent as ArrayBuffer);
  const mediaType = getMediaType(fileCategory, mimeType);

  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data,
      },
    },
    {
      type: 'text',
      text: 'Please extract all player roster data from this image. Look for player names, jersey numbers, and positions.',
    },
  ];
}

/**
 * Generate unique temporary IDs for extracted players
 */
function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract roster data from file using Claude AI
 */
export async function extractRosterData(
  fileContent: string | ArrayBuffer,
  fileCategory: FileCategory,
  mimeType: string
): Promise<{ success: true; players: ExtractedPlayer[]; extractionNotes?: string } | { success: false; error: string }> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const content = buildMessageContent(fileContent, fileCategory, mimeType);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: ROSTER_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: content as any,
        },
      ],
      tools: [extractionTool as any],
      tool_choice: { type: 'tool', name: 'extract_roster_data' },
    });

    // Extract tool response
    const toolUse = message.content.find((block: any) => block.type === 'tool_use');

    if (!toolUse || !(toolUse as any).input) {
      return {
        success: false,
        error: 'AI could not extract roster data from this file. Please try a clearer image or different format.',
      };
    }

    const result = (toolUse as any).input as AIExtractionResult;

    // Add temp IDs to extracted players
    const playersWithIds: ExtractedPlayer[] = result.players.map((player) => ({
      ...player,
      tempId: generateTempId(),
    }));

    // Filter out any entries with empty names
    const validPlayers = playersWithIds.filter(
      (p) => p.name && p.name.trim().length > 0
    );

    if (validPlayers.length === 0) {
      return {
        success: false,
        error: 'No player names could be extracted from this file. Please ensure the roster is clearly visible.',
      };
    }

    return {
      success: true,
      players: validPlayers,
      extractionNotes: result.extractionNotes,
    };
  } catch (error) {
    console.error('AI extraction error:', error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('rate_limit')) {
        return {
          success: false,
          error: 'Service temporarily busy. Please try again in a moment.',
        };
      }
      if (error.message.includes('invalid_api_key') || error.message.includes('authentication')) {
        return {
          success: false,
          error: 'Service configuration error. Please contact support.',
        };
      }
    }

    return {
      success: false,
      error: 'Failed to extract roster data. Please try again or use a different file.',
    };
  }
}
