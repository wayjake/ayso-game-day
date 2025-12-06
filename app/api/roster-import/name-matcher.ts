// Fuzzy name matching using Levenshtein distance

import type {
  ExistingPlayer,
  MatchCandidate,
  MatchResult,
  NameMatchConfig,
  ExtractedPlayer,
} from './types';

const DEFAULT_CONFIG: NameMatchConfig = {
  exactMatchThreshold: 1.0,
  fuzzyMatchThreshold: 0.75,
  considerFirstNameOnly: true,
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalize a name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces
}

/**
 * Calculate similarity score (0-1) between two names
 */
export function calculateNameSimilarity(
  extractedName: string,
  existingName: string
): number {
  const norm1 = normalizeName(extractedName);
  const norm2 = normalizeName(existingName);

  // Exact match
  if (norm1 === norm2) return 1.0;

  // Empty strings
  if (norm1.length === 0 || norm2.length === 0) return 0;

  // Calculate Levenshtein distance
  const maxLen = Math.max(norm1.length, norm2.length);
  const distance = levenshteinDistance(norm1, norm2);
  const similarity = 1 - distance / maxLen;

  return similarity;
}

/**
 * Extract first name from full name
 */
function getFirstName(fullName: string): string {
  return normalizeName(fullName).split(' ')[0] || '';
}

/**
 * Find the best matching existing player for an extracted name
 */
export function findBestMatch(
  extractedName: string,
  existingPlayers: ExistingPlayer[],
  config: NameMatchConfig = DEFAULT_CONFIG
): MatchCandidate | null {
  let bestMatch: MatchCandidate | null = null;

  for (const player of existingPlayers) {
    // Full name comparison
    const fullScore = calculateNameSimilarity(extractedName, player.name);

    // First name only comparison (with penalty)
    let firstNameScore = 0;
    if (config.considerFirstNameOnly) {
      const extractedFirst = getFirstName(extractedName);
      const existingFirst = getFirstName(player.name);
      if (extractedFirst && existingFirst) {
        firstNameScore = calculateNameSimilarity(extractedFirst, existingFirst) * 0.9;
      }
    }

    const score = Math.max(fullScore, firstNameScore);

    // Check for exact match
    if (score >= config.exactMatchThreshold) {
      return { existingPlayer: player, score, matchType: 'exact' };
    }

    // Check for fuzzy match
    if (score >= config.fuzzyMatchThreshold) {
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { existingPlayer: player, score, matchType: 'fuzzy' };
      }
    }
  }

  return bestMatch;
}

/**
 * Process all extracted players against existing roster
 */
export function matchExtractedToExisting(
  extractedPlayers: ExtractedPlayer[],
  existingPlayers: ExistingPlayer[],
  config?: Partial<NameMatchConfig>
): MatchResult[] {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  return extractedPlayers.map((extracted) => {
    const match = findBestMatch(extracted.name, existingPlayers, fullConfig);

    if (match) {
      return {
        tempId: extracted.tempId,
        extractedName: extracted.name,
        matchType: match.matchType,
        existingPlayerId: match.existingPlayer.id,
        existingPlayerName: match.existingPlayer.name,
        similarityScore: match.score,
      };
    }

    return {
      tempId: extracted.tempId,
      extractedName: extracted.name,
      matchType: 'new' as const,
    };
  });
}
