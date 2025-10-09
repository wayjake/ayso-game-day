// AYSO compliance validation functions
import type { AIResponse, PlayerContext, ValidationError, ValidationResult, GameFormat } from './types';

export function validateAYSOCompliance(
  aiResponse: AIResponse,
  teamPlayers: PlayerContext[],
  format: GameFormat
): ValidationResult {
  const errors: ValidationError[] = [];

  // Count quarters per player
  const playerQuarterCount: Map<number, number> = new Map();
  const playerGoalkeeperCount: Map<number, number> = new Map();

  // Initialize counts
  teamPlayers.forEach(player => {
    playerQuarterCount.set(player.id, 0);
    playerGoalkeeperCount.set(player.id, 0);
  });

  // Count appearances across all quarters
  aiResponse.quarters.forEach((quarter) => {
    quarter.assignments.forEach((assignment) => {
      const currentCount = playerQuarterCount.get(assignment.playerId) || 0;
      playerQuarterCount.set(assignment.playerId, currentCount + 1);

      // Track goalkeeper appearances (position 1)
      if (assignment.positionNumber === 1) {
        const gkCount = playerGoalkeeperCount.get(assignment.playerId) || 0;
        playerGoalkeeperCount.set(assignment.playerId, gkCount + 1);
      }
    });
  });

  // Validate: Every player plays at least 3 quarters
  teamPlayers.forEach(player => {
    const quartersPlayed = playerQuarterCount.get(player.id) || 0;
    if (quartersPlayed < 3) {
      errors.push({
        playerId: player.id,
        playerName: player.name,
        quartersPlayed,
        issue: `Only plays ${quartersPlayed} quarter${quartersPlayed !== 1 ? 's' : ''} (minimum 3 required by 3/4 Rule)`
      });
    }
  });

  // Validate: No player plays 4 quarters until everyone has played 3 (3/4 Rule)
  const playersAt4Quarters = Array.from(playerQuarterCount.entries())
    .filter(([_, count]) => count === 4)
    .map(([playerId, _]) => playerId);

  const playersBelow3Quarters = Array.from(playerQuarterCount.entries())
    .filter(([_, count]) => count < 3)
    .map(([playerId, _]) => playerId);

  if (playersAt4Quarters.length > 0 && playersBelow3Quarters.length > 0) {
    playersAt4Quarters.forEach(playerId => {
      const player = teamPlayers.find(p => p.id === playerId);
      if (player) {
        errors.push({
          playerId: player.id,
          playerName: player.name,
          quartersPlayed: 4,
          issue: 'Plays 4 quarters while other players have not yet played 3 (violates 3/4 Rule)'
        });
      }
    });
  }

  // Validate goalkeeper limits
  const maxGKQuarters = format === '7v7' ? 2 : format === '9v9' ? 3 : 4;
  if (maxGKQuarters < 4) {
    playerGoalkeeperCount.forEach((gkCount, playerId) => {
      if (gkCount > maxGKQuarters) {
        const player = teamPlayers.find(p => p.id === playerId);
        if (player) {
          errors.push({
            playerId: player.id,
            playerName: player.name,
            quartersPlayed: gkCount,
            issue: `Plays goalkeeper ${gkCount} quarters (maximum ${maxGKQuarters} for ${format})`
          });
        }
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
