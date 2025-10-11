# Autonomous Iterative AI Lineup Generation

## Overview

The autonomous approach gives full control to the AI to determine its own strategy, prompts, and execution plan for generating game lineups. Instead of following predefined phases or sequential steps, the AI autonomously:

1. **Analyzes the problem** - Reviews all constraints, players, and requirements
2. **Generates a strategy** - Decides how to break down the problem
3. **Creates its own prompts** - Generates the next prompt it needs to execute
4. **Iterates until complete** - Continues until it reports completion or hits max iterations
5. **Produces final lineup** - Returns a complete 4-quarter lineup

## Key Features

### 🤖 Full AI Autonomy
- AI decides the strategy (e.g., plan substitutes first, go quarter-by-quarter, etc.)
- AI generates its own prompts for each iteration
- AI determines when the task is complete

### 📊 Comprehensive Logging
- Every iteration is logged with timestamp, step description, and results
- Full iteration history returned in the response
- Easy debugging through iteration logs

### 🔄 Iterative Approach
- Max 10 iterations (configurable via `MAX_ITERATIONS`)
- Each iteration builds on previous results
- Accumulated context passed to subsequent iterations

### ✅ Structured Responses
Each iteration returns:
```typescript
{
  isComplete: boolean,           // true when final lineup ready
  currentStep: string,           // what the AI did this iteration
  currentResults: object,        // decisions/results from this step
  nextPrompt: string | null,     // next prompt to execute (null if complete)
  nextStrategy: string | null,   // description of next strategy
  reasoning: string,             // AI's reasoning for this step
  finalLineup?: {                // only when isComplete=true
    quarters: [...]
  },
  error?: boolean,
  errorMessage?: string
}
```

## How It Works

### Initial Iteration

The AI receives **full context** including:
- All players with position history and preferences
- Formation details and positions
- AYSO Fair Play rules
- Current lineup (if any)
- Absent/injured players
- User's specific requests

The AI then:
1. Analyzes the complete problem
2. Decides on an overall strategy
3. Executes the first step of that strategy
4. Generates the prompt for the next step

### Subsequent Iterations

Each iteration:
1. Receives accumulated results from all previous iterations
2. Executes the current prompt
3. Returns results and next prompt
4. Continues until complete

### Completion

The AI reports completion by:
- Setting `isComplete: true`
- Providing the `finalLineup` with all 4 quarters
- Setting `nextPrompt: null`

## File Structure

```
app/api/ai-lineup/
├── route-autonomous.ts          # Main autonomous handler
├── types.ts                      # Includes AutonomousIterationResponse
└── README-AUTONOMOUS.md          # This file
```

## Usage

The autonomous approach is now the default in `route.ts`:

```typescript
if (action === "generate") {
  const { handleAutonomousGeneration } = await import('./route-autonomous');
  return handleAutonomousGeneration(formData, user);
}
```

## Response Format

Successful response includes:
```typescript
{
  success: true,
  message: "Successfully generated lineup using autonomous AI approach (N iterations)",
  quarters: QuarterWithDetails[],  // Standard quarter format
  iterations: number,              // Total iterations used
  reasoning: string                // Final reasoning from AI
}
```

## Logging Output

Console logs show:
```
=== AUTONOMOUS ITERATIVE AI LINEUP GENERATION ===

Game ID: 123, Team ID: 456
User Input: "Create a balanced lineup"

Context Summary:
- Total players: 14
- Positions per quarter: 9
- Format: 9v9
- Absent/Injured: 0

--- ITERATION 1/10 ---
Calling Anthropic API...
Prompt length: 3245 chars
API Response length: 1823 chars
Step: Planning substitute rotation strategy
Reasoning: I'll first determine which players should sit out each quarter...
Complete: false
Next strategy: Assign goalkeepers for all quarters

--- ITERATION 2/10 ---
...

=== ITERATION SUMMARY ===

Iteration 1 [2025-10-09T19:31:27.964Z]:
Step: Planning substitute rotation strategy
Strategy: Assign goalkeepers for all quarters

Iteration 2 [2025-10-09T19:31:35.123Z]:
Step: Assigning goalkeepers with consecutive rule
Strategy: Assign field positions by experience

...

=== AUTONOMOUS GENERATION COMPLETE ===

Total iterations: 4
Final reasoning: Created balanced lineup meeting all AYSO requirements...
```

## Advantages

1. **Flexibility** - AI can adapt strategy based on specific constraints
2. **Transparency** - Full iteration history shows AI's decision process
3. **Robustness** - AI can recover from partial solutions or constraints
4. **Extensibility** - Easy to add new constraints or requirements

## Comparison with Other Approaches

| Approach | Strategy | Iterations | Control |
|----------|----------|------------|---------|
| **Original** | Single-pass all quarters | 1 | Fixed prompts |
| **Sequential** | Quarter-by-quarter | 4 (one per quarter) | Fixed sequence |
| **By-Position** | 4 phases (subs, GK, field, validate) | 4 | Fixed phases |
| **Autonomous** | AI-generated strategy | 1-10 | Full AI control |

## Configuration

Adjust `MAX_ITERATIONS` in `route-autonomous.ts`:

```typescript
const MAX_ITERATIONS = 10; // Safety limit
```

## Error Handling

The system handles errors at multiple levels:
1. **AI-reported errors** - AI sets `error: true` with message
2. **Max iterations** - Returns error if not complete after max iterations
3. **API errors** - Catches and returns API failures
4. **Missing lineup** - Validates finalLineup exists when complete

## Future Enhancements

Potential improvements:
- Allow user to configure max iterations
- Add iteration timeout limits
- Support for partial lineup acceptance
- Interactive mode where user can provide feedback between iterations
- Strategy selection hints (e.g., "prefer quarter-by-quarter approach")
