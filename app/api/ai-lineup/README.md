# AI Lineup API

This API generates optimal soccer lineup suggestions using Anthropic's Claude AI while ensuring AYSO Fair Play compliance.

## Architecture Overview

This API was refactored from a monolithic 665-line file into a modular, maintainable structure with clear separation of concerns. Each module has a single responsibility, making the code easier to understand, test, and modify.

### Design Philosophy

**"Motorcycle, not a car"** - Built for speed and flexibility. The modular design allows rapid iteration on prompts and logic without touching database code or AI client configuration.

### Sequential Quarter Planning

The AI now plans **one quarter at a time** instead of all 4 quarters simultaneously. This approach:
- **More reliable**: Easier for AI to reason about one quarter with full context
- **Better error handling**: AI can return error if constraints can't be met
- **Context-aware**: Each quarter knows what happened in previous quarters
- **Clearer validation**: Tracks remaining quarters needed per player in real-time

## File Structure

```
app/api/ai-lineup/
├── README.md                      # This file
├── types.ts                       # TypeScript interfaces and types
├── data-fetchers.ts               # Database queries and data processing
├── prompt-builder.ts              # AI prompt construction (legacy)
├── prompt-builder-sequential.ts   # Quarter-specific prompt construction
├── ai-client.ts                   # Anthropic API integration (legacy)
├── ai-client-sequential.ts        # Single quarter AI calls
├── validation.ts                  # AYSO compliance checks
├── route.ts                       # Main orchestration file
└── route-sequential.ts            # Sequential quarter-by-quarter planning
```

## Module Descriptions

### Sequential Planning Modules (Current Implementation)

#### `route-sequential.ts` - Sequential Quarter Orchestration

Handles quarter-by-quarter lineup generation with context awareness.

**Flow:**
1. Fetch all game/team/player data once
2. Calculate initial "remaining quarters needed" for each player
3. Loop through quarters 1-4:
   - Skip if quarter already has assignments
   - Build quarter-specific context (what happened in previous quarters)
   - Call AI for single quarter
   - If AI returns error, stop and return partial results
   - Update remaining quarters for players who were assigned
4. Return all 4 quarters or error with explanation

**Benefits:**
- AI sees full context of previous quarters
- Tracks remaining quarters per player in real-time
- Can detect impossible situations and return helpful error
- More reliable than planning all quarters at once

#### `ai-client-sequential.ts` - Single Quarter AI Integration

Calls Anthropic Claude to plan ONE quarter with error handling.

**Tool Schema:**
- `error` (boolean) - Set to true if constraints can't be met
- `errorMessage` (string) - Explanation of why planning failed
- `quarter` (object) - Single quarter assignments and substitutes

**Error Cases:**
- Not enough eligible players for positions needed
- Player availability doesn't allow meeting 3/4 rule
- Formation constraints conflict with player availability

#### `prompt-builder-sequential.ts` - Quarter-Specific Prompts

Builds focused prompts for planning a single quarter.

**Key Features:**
- Shows which players MUST play this quarter (last chance)
- Shows remaining quarters for each player
- Includes previous quarters context
- Clear validation rules for this specific quarter

**Example Context:**
```
Planning Quarter 3 of 4
Players who MUST play: Alice (1 quarter remaining), Bob (1 quarter remaining)
Eligible players: 12
Positions to fill: 9
Previous quarters: Q1 (decided), Q2 (decided)
```

### Legacy Modules (Full Planning Approach)

### `types.ts` - Type Definitions

Central location for all TypeScript interfaces and types used across the API.

**Key Types:**
- `PlayerContext` - Player data with position history
- `QuarterFormationInfo` - Formation details per quarter
- `AIResponse` - Structured response from Claude
- `ValidationResult` - AYSO compliance validation results
- `GameFormat` - 7v7, 9v9, or 11v11

**Why separate?** Types define the contract between modules. Centralizing them prevents duplication and ensures consistency.

### `data-fetchers.ts` - Database Layer

All database queries and data transformation logic.

**Functions:**
- `getTeam()` - Fetch team with ownership verification
- `getGame()` - Fetch game details
- `getQuarterFormations()` - Load formation configurations
- `getTeamPlayers()` - Fetch player roster
- `getCurrentAssignments()` - Get existing lineup assignments
- `getAbsentInjuredPlayers()` - Get unavailable players
- `getPastGamesAndAssignments()` - Historical game data
- `calculatePositionHistory()` - Analyze player position trends
- `buildPlayersContext()` - Format player data for AI
- `buildCurrentLineup()` - Structure current assignments
- `buildPastGamesContext()` - Format historical data
- `buildAbsentInjuredContext()` - Format unavailable players

**Why separate?** Isolating database logic makes it easy to:
- Modify queries without touching AI logic
- Add caching layers
- Test data transformations independently
- Optimize database performance

### `prompt-builder.ts` - Prompt Engineering

AI prompt construction and composition. **This is where you iterate on prompts.**

**Functions:**
- `getAgeSpecificRules()` - AYSO rules for each age group
- `buildSystemPrompt()` - Claude's system instructions
- `buildFormationContext()` - Formation data for AI
- `buildUserMessage()` - User request with game context
- `savePromptToFile()` - Debug prompt logging
- `saveResponseToFile()` - Debug response logging

**Why separate?** Prompts change frequently during development. This module lets you:
- Iterate on prompts without touching data fetching or API calls
- Test different prompt strategies easily
- Version control prompt changes
- A/B test prompt variations

**Prompt Strategy:**
1. **System Prompt** - Sets Claude's role and constraints
   - AYSO Fair Play rules (age-specific)
   - Mathematical constraints (3/4 rule)
   - Verification process
   - Coaching considerations

2. **User Message** - Provides game-specific context
   - Formation details
   - Player data with position history
   - Current lineup state
   - Constraints (absent/injured players)

### `ai-client.ts` - Anthropic Integration

Handles all communication with Anthropic's Claude API.

**Function:**
- `generateLineupWithAnthropic()` - Call Claude with tool use

**Implementation Details:**
- Uses Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Implements tool calling for structured output
- Tool schema enforces lineup format
- Returns validated `AIResponse`

**Why Anthropic?**
- Superior reasoning for complex constraints
- Native tool calling (structured outputs)
- Better instruction following
- More reliable AYSO rule compliance

**Why separate?** Makes it easy to:
- Switch AI providers
- Update model versions
- Modify tool schemas
- Add retries or fallbacks

### `validation.ts` - AYSO Compliance

Post-generation validation of lineup suggestions.

**Function:**
- `validateAYSOCompliance()` - Verify AYSO Fair Play rules

**Validation Rules:**
1. **3/4 Rule** - Every player plays minimum 3 quarters
2. **No 4-Quarter Players** - Until everyone has played 3
3. **Goalkeeper Limits** - Age-appropriate rotation
   - 7v7: Max 2 quarters as GK
   - 9v9: Max 3 quarters as GK
   - 11v11: No limit (4 quarters allowed)

**Why separate?** Validation logic:
- Can be tested independently
- Easy to add new AYSO rules
- Clear error reporting
- Reusable in other contexts

### `route.ts` - Orchestration

Main entry point that coordinates all modules.

**Flow:**
1. Authenticate user
2. Parse request action (`transcribe` or `generate`)
3. For lineup generation:
   - Fetch all data (data-fetchers)
   - Build prompts (prompt-builder)
   - Call AI (ai-client)
   - Validate response (validation)
   - Transform for frontend
4. Return formatted response

**Two Actions:**
- `transcribe` - Voice to text (uses OpenAI Whisper)
- `generate` - Generate lineup (uses Anthropic Claude)

**Why separate?** The orchestrator:
- Has a clear high-level flow
- Doesn't care about implementation details
- Makes it easy to see the big picture
- Can be tested with mocked modules

## Data Flow

### Sequential Quarter Planning Flow

```
User Request
    ↓
route.ts → route-sequential.ts
    ↓
data-fetchers.ts → Fetch game/team/player data
    ↓
data-fetchers.ts → Calculate position history
    ↓
FOR EACH QUARTER (1-4):
    ↓
    Calculate remaining quarters needed per player
    ↓
    prompt-builder-sequential.ts → Build quarter-specific prompt
    ↓
    ai-client-sequential.ts → Call Anthropic Claude
    ↓
    Check for error response
    ↓
    If error: Return with explanation
    ↓
    If success: Update remaining quarters, continue to next
    ↓
END FOR
    ↓
route-sequential.ts → Transform all quarters for frontend
    ↓
Response to User (all 4 quarters or error with partial results)
```

## How to Modify Prompts

**Quick prompt changes** - Edit `prompt-builder.ts`:

1. **Change system instructions:**
   ```typescript
   // In buildSystemPrompt()
   return `You are an expert AYSO coach...
   NEW INSTRUCTION HERE
   ...`;
   ```

2. **Change user message format:**
   ```typescript
   // In buildUserMessage()
   return `Current request: ${userInput}
   NEW CONTEXT HERE
   ...`;
   ```

3. **Test immediately** - No other files need changes!

## How to Switch AI Models

**Change model** - Edit `ai-client.ts`:

```typescript
const message = await anthropic.messages.create({
  model: "claude-sonnet-4-5-20250929", // Change this
  max_tokens: 8000,
  // ...
});
```

## Debugging

Prompts and responses are automatically saved to `debug/` folder:
- Format: `YYYY-MM-DDTHH-mm-ss-ai-lineup-prompt.txt`
- Format: `YYYY-MM-DDTHH-mm-ss-ai-lineup-response.txt`

**To debug issues:**
1. Check `debug/` folder for recent prompt/response
2. Review what was sent to Claude
3. Review what Claude returned
4. Iterate on prompt in `prompt-builder.ts`

## Environment Variables

Required in `.env`:

```bash
# Anthropic API (for lineup generation)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI API (for voice transcription only)
OPENAI_API_KEY=sk-...
```

## Adding New Features

### Example: Add weather data to lineup suggestions

1. **Add type** (`types.ts`):
   ```typescript
   export interface WeatherContext {
     temperature: number;
     conditions: string;
   }
   ```

2. **Fetch data** (`data-fetchers.ts`):
   ```typescript
   export async function getWeather(date: string) {
     // Fetch weather API
   }
   ```

3. **Include in prompt** (`prompt-builder.ts`):
   ```typescript
   export function buildUserMessage(params: {..., weather: WeatherContext}) {
     return `...
     Weather: ${weather.temperature}°F, ${weather.conditions}
     ...`;
   }
   ```

4. **Call from orchestrator** (`route.ts`):
   ```typescript
   const weather = await getWeather(game.gameDate);
   const userMessage = buildUserMessage({..., weather});
   ```

Done! No changes to AI client or validation needed.

## Testing Strategy

Each module can be tested independently:

```typescript
// Test data fetching
const players = await getTeamPlayers(teamId);
expect(players).toHaveLength(12);

// Test prompt building
const prompt = buildSystemPrompt({ format: '9v9', ... });
expect(prompt).toContain('3/4 Rule');

// Test validation
const result = validateAYSOCompliance(aiResponse, players, '9v9');
expect(result.isValid).toBe(true);
```

## Performance Considerations

- **Caching opportunities** - Team, player, formation data rarely changes
- **Parallel fetching** - Can fetch team/game/players simultaneously
- **Prompt optimization** - Shorter prompts = faster responses, lower cost
- **Streaming** (future) - Could stream Claude's response for better UX

## Future Improvements

- [ ] Add caching layer for frequently accessed data
- [ ] Implement conversation history for multi-turn refinement
- [ ] Add A/B testing framework for prompt variations
- [ ] Support for streaming responses
- [ ] Add unit tests for each module
- [ ] Performance monitoring and logging
- [ ] Rate limiting and retry logic

## Architecture Benefits

✅ **Modularity** - Each file has one job
✅ **Testability** - Modules can be tested independently
✅ **Maintainability** - Easy to find and fix issues
✅ **Flexibility** - Swap implementations without breaking others
✅ **Debuggability** - Clear data flow, easy to trace issues
✅ **Iteration Speed** - Change prompts without touching data/API code

---

**Built with the motorcycle philosophy: Fast, flexible, and easy to fix.**
