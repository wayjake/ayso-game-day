// 🎯 Position Change Detection Utilities
// Helps coaches spot player movements between quarters for clear communication

export type PositionChange = {
  playerId: number;
  playerName: string;
  changeType: 'new_in' | 'position_swap' | 'simple_sub' | 'sitting_out' | 'new_position';
  fromPosition?: number;
  toPosition?: number;
  swapsWith?: {
    playerId: number;
    playerName: string;
    fromPosition: number;
    toPosition: number;
  };
};

export type QuarterLineup = Map<number, { playerId: number; name: string }>;

/**
 * 🔄 Analyzes position changes between two quarters
 * Returns detailed information about player movements to help coaches communicate changes
 */
export function calculatePositionChanges(
  previousQuarter: QuarterLineup,
  currentQuarter: QuarterLineup,
  previousSittingOut: Set<number>,
  currentSittingOut: Set<number>
): PositionChange[] {
  const changes: PositionChange[] = [];
  const processedPlayers = new Set<number>();

  // 🔍 Track all players who are on field in either quarter
  const allFieldPositions = new Set([...previousQuarter.keys(), ...currentQuarter.keys()]);

  for (const position of allFieldPositions) {
    const prevPlayer = previousQuarter.get(position);
    const currPlayer = currentQuarter.get(position);

    // Skip if same player in same position - no change
    if (prevPlayer && currPlayer && prevPlayer.playerId === currPlayer.playerId) {
      continue;
    }

    // 🆕 New player coming to this position
    if (currPlayer && !processedPlayers.has(currPlayer.playerId)) {
      const playerPrevPosition = findPlayerPosition(currPlayer.playerId, previousQuarter);

      if (playerPrevPosition !== null) {
        // Player moved from another position
        changes.push({
          playerId: currPlayer.playerId,
          playerName: currPlayer.name,
          changeType: 'new_position',
          fromPosition: playerPrevPosition,
          toPosition: position,
        });
      } else if (previousSittingOut.has(currPlayer.playerId)) {
        // Player came from bench
        changes.push({
          playerId: currPlayer.playerId,
          playerName: currPlayer.name,
          changeType: 'new_in',
          toPosition: position,
        });
      }

      processedPlayers.add(currPlayer.playerId);
    }

    // 🚪 Player leaving this position
    if (prevPlayer && !processedPlayers.has(prevPlayer.playerId)) {
      const playerNewPosition = findPlayerPosition(prevPlayer.playerId, currentQuarter);

      if (playerNewPosition === null) {
        if (currentSittingOut.has(prevPlayer.playerId)) {
          // Player went to bench
          changes.push({
            playerId: prevPlayer.playerId,
            playerName: prevPlayer.name,
            changeType: 'sitting_out',
            fromPosition: position,
          });
        }
        processedPlayers.add(prevPlayer.playerId);
      }
      // A player who moved elsewhere is recorded when the loop reaches their
      // new position. Marking them processed here dropped one side of swaps.
    }
  }

  // 🔄 Detect position swaps (two players switching positions)
  const positionChanges = changes.filter(c => c.changeType === 'new_position');
  const swapPairs = findSwapPairs(positionChanges);

  // Update swap pairs with swap information
  for (const swap of swapPairs) {
    const player1Change = changes.find(c => c.playerId === swap.player1.playerId);
    const player2Change = changes.find(c => c.playerId === swap.player2.playerId);

    if (player1Change && player2Change) {
      player1Change.changeType = 'position_swap';
      player1Change.swapsWith = {
        playerId: swap.player2.playerId,
        playerName: swap.player2.playerName,
        fromPosition: swap.player2.fromPosition!,
        toPosition: swap.player2.toPosition!,
      };

      player2Change.changeType = 'position_swap';
      player2Change.swapsWith = {
        playerId: swap.player1.playerId,
        playerName: swap.player1.playerName,
        fromPosition: swap.player1.fromPosition!,
        toPosition: swap.player1.toPosition!,
      };
    }
  }

  return changes;
}

/**
 * 🔍 Finds which position a player is currently in
 */
function findPlayerPosition(playerId: number, lineup: QuarterLineup): number | null {
  for (const [position, player] of lineup.entries()) {
    if (player.playerId === playerId) {
      return position;
    }
  }
  return null;
}

/**
 * 🔄 Identifies position swap pairs
 */
function findSwapPairs(positionChanges: PositionChange[]) {
  const swaps: Array<{
    player1: PositionChange;
    player2: PositionChange;
  }> = [];

  for (let i = 0; i < positionChanges.length; i++) {
    for (let j = i + 1; j < positionChanges.length; j++) {
      const change1 = positionChanges[i];
      const change2 = positionChanges[j];

      // Check if these two players swapped positions
      if (
        change1.fromPosition === change2.toPosition &&
        change1.toPosition === change2.fromPosition
      ) {
        swaps.push({
          player1: change1,
          player2: change2,
        });
      }
    }
  }

  return swaps;
}

/**
 * 📝 Creates a human-readable description of the position change
 */
export function getChangeDescription(change: PositionChange): string {
  switch (change.changeType) {
    case 'new_in':
      return `Coming in at #${change.toPosition}`;
    case 'sitting_out':
      return `Going to bench from #${change.fromPosition}`;
    case 'position_swap':
      return `Swapping with ${change.swapsWith?.playerName} (#${change.fromPosition} ↔ #${change.toPosition})`;
    case 'new_position':
      return `Moving from #${change.fromPosition} to #${change.toPosition}`;
    default:
      return 'Position change';
  }
}

/**
 * 🎯 Check if a position has any changes
 */
export function hasPositionChange(position: number, changes: PositionChange[]): boolean {
  return changes.some(change =>
    change.toPosition === position || change.fromPosition === position
  );
}

/**
 * 🎯 Get changes affecting a specific position
 */
export function getPositionChanges(position: number, changes: PositionChange[]): PositionChange[] {
  return changes.filter(change =>
    change.toPosition === position || change.fromPosition === position
  );
}

/**
 * 🎯 Check if a player has any changes
 */
export function hasPlayerChange(playerId: number, changes: PositionChange[]): boolean {
  return changes.some(change => change.playerId === playerId);
}

/**
 * 🎯 Get changes for a specific player
 */
export function getPlayerChange(playerId: number, changes: PositionChange[]): PositionChange | undefined {
  return changes.find(change => change.playerId === playerId);
}