// Shared TypeScript types for AI lineup API

export interface PlayerContext {
  id: number;
  name: string;
  description: string;
  preferredPositions: string[];
  positionHistory: Record<string, number> | null; // e.g., { "GK": 4, "RB": 5, "CB": 8, "LB": 2 }
}

export interface QuarterFormationInfo {
  name: string;
  positions: Array<{
    number: number;
    abbreviation: string;
    x: number;
    y: number;
  }>;
}

export interface CurrentLineup {
  [quarter: number]: {
    [positionNumber: number]: number; // playerId
  };
}

export interface AbsentInjuredContext {
  playerId: number;
  quarter: number | null;
  reason: string;
}

export interface PastGameContext {
  date: string;
  opponent: string;
  lineup: CurrentLineup;
}

export interface AIAssignment {
  positionNumber: number;
  playerId: number;
}

export interface AIQuarter {
  number: number;
  assignments: AIAssignment[];
  substitutes: number[];
}

export interface AIResponse {
  message: string;
  quarters: AIQuarter[];
}

// Single quarter response for sequential planning
export interface SingleQuarterAIResponse {
  error: boolean;
  errorMessage?: string;
  quarter?: {
    number: number;
    assignments: AIAssignment[];
    substitutes: number[];
  };
}

// Context for planning a specific quarter
export interface QuarterPlanningContext {
  quarterNumber: number;
  previousQuarters: Array<{
    number: number;
    assignments: AIAssignment[];
    substitutes: number[];
  }>;
  remainingQuartersNeeded: Record<number, number>; // playerId -> quarters still needed
}

// Enhanced context for quarter-specific must-play logic
export interface QuarterContext {
  quarterNumber: 1 | 2 | 3 | 4;
  mustPlayPlayerIds: number[];                    // Players who MUST play this quarter (sat previous quarter)
  previousSubstitutes: number[];                  // Who sat out last quarter
  playersQuarterCounts: Record<number, number>;  // playerId -> quarters played so far
}

export interface QuarterWithDetails {
  number: number;
  players: Record<number, number>;
  changes: Array<{
    positionNumber: number;
    positionName: string;
    playerId: number;
    playerName: string;
    isChange: boolean;
  }>;
  substitutes: Array<{
    playerId: number;
    playerName: string;
  }>;
}

export interface ValidationError {
  playerId: number;
  playerName: string;
  quartersPlayed: number;
  issue: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export type GameFormat = '7v7' | '9v9' | '11v11';

// Autonomous iterative AI response types
export interface AutonomousIterationResponse {
  isComplete: boolean;
  currentStep: string;
  currentResults: any;
  nextStrategy: string | null;
  reasoning: string;
  finalLineup?: {
    quarters: AIQuarter[];
  };
  error?: boolean;
  errorMessage?: string;
}

// Iteration log for debugging
export interface IterationLog {
  iteration: number;
  step: string;
  strategy: string;
  results: any;
  timestamp: string;
}
