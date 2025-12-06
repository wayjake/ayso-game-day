// Types for the AI-powered roster import feature

export interface ExtractedPlayer {
  tempId: string;
  name: string;
  jerseyNumber?: number;
  preferredPositions?: string[];
  notes?: string;
  confidence: number; // 0-1 extraction confidence
}

export interface MatchResult {
  tempId: string;
  extractedName: string;
  matchType: 'exact' | 'fuzzy' | 'new';
  existingPlayerId?: number;
  existingPlayerName?: string;
  similarityScore?: number; // 0-1 for fuzzy matches
}

export interface ExtractResponse {
  success: boolean;
  extractedPlayers?: ExtractedPlayer[];
  matchResults?: MatchResult[];
  extractionNotes?: string;
  error?: string;
}

export interface ImportPlayerData {
  tempId: string;
  name: string;
  jerseyNumber?: number;
  preferredPositions?: string[];
  notes?: string;
  action: 'create' | 'update' | 'skip';
  existingPlayerId?: number;
}

export interface ImportResponse {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors?: string[];
}

export interface ExistingPlayer {
  id: number;
  name: string;
}

export interface MatchCandidate {
  existingPlayer: ExistingPlayer;
  score: number;
  matchType: 'exact' | 'fuzzy';
}

export interface NameMatchConfig {
  exactMatchThreshold: number; // Default: 1.0
  fuzzyMatchThreshold: number; // Default: 0.75
  considerFirstNameOnly: boolean; // Default: true
}

// AI extraction tool response shape
export interface AIExtractionResult {
  players: Array<{
    name: string;
    jerseyNumber?: number;
    preferredPositions?: string[];
    notes?: string;
    confidence: number;
  }>;
  extractionNotes?: string;
}
