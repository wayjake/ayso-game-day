// Data fetching functions for AI lineup API
import type {
  PlayerContext,
  QuarterFormationInfo,
  CurrentLineup,
  AbsentInjuredContext,
  PastGameContext,
  GameFormat
} from './types';

export async function getTeam(teamId: number, userId: number) {
  const { db, teams } = await import('~/db');
  const { eq, and } = await import('drizzle-orm');

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, userId)))
    .limit(1);

  return team;
}

export async function getGame(gameId: number, teamId: number) {
  const { db, games } = await import('~/db');
  const { eq, and } = await import('drizzle-orm');

  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  return game;
}

export async function getQuarterFormations(game: any, teamFormat: GameFormat) {
  const gameNotes = game.notes ? JSON.parse(game.notes) : {};
  const quarterFormations = gameNotes.quarterFormations || {};

  const { getFormationsByFormat } = await import('~/utils/formations');
  const formationOptions = getFormationsByFormat(teamFormat);
  const formationKeys = Object.keys(formationOptions);

  const quarterFormationInfo: Record<number, QuarterFormationInfo> = {};

  for (let q = 1; q <= 4; q++) {
    const formationIndex = quarterFormations[q] ?? 0;
    const formationKey = formationKeys[formationIndex];
    const formation = (formationOptions as any)[formationKey || formationKeys[0]];

    quarterFormationInfo[q] = {
      name: formationKey || formationKeys[0],
      positions: formation?.positions || [],
    };
  }

  return quarterFormationInfo;
}

export async function getTeamPlayers(teamId: number) {
  const { db, players } = await import('~/db');
  const { eq } = await import('drizzle-orm');

  const teamPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      description: players.description,
      preferredPositions: players.preferredPositions,
    })
    .from(players)
    .where(eq(players.teamId, teamId));

  return teamPlayers;
}

export async function getCurrentAssignments(gameId: number) {
  const { db, assignments } = await import('~/db');
  const { eq } = await import('drizzle-orm');

  const currentAssignments = await db
    .select({
      playerId: assignments.playerId,
      positionNumber: assignments.positionNumber,
      positionName: assignments.positionName,
      quarter: assignments.quarter,
      isSittingOut: assignments.isSittingOut,
    })
    .from(assignments)
    .where(eq(assignments.gameId, gameId));

  return currentAssignments;
}

export async function getAbsentInjuredPlayers(gameId: number) {
  const { db, sitOuts } = await import('~/db');
  const { eq } = await import('drizzle-orm');

  const absentInjuredPlayers = await db
    .select({
      playerId: sitOuts.playerId,
      quarter: sitOuts.quarter,
      reason: sitOuts.reason,
    })
    .from(sitOuts)
    .where(eq(sitOuts.gameId, gameId));

  return absentInjuredPlayers;
}

export async function getPastGamesAndAssignments(teamId: number, currentGameDate: string) {
  const { db, games, assignments } = await import('~/db');
  const { eq, and, lt, desc } = await import('drizzle-orm');

  // Get last 7 games that occurred before this game
  const pastGames = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      opponent: games.opponent,
    })
    .from(games)
    .where(and(
      eq(games.teamId, teamId),
      lt(games.gameDate, currentGameDate)
    ))
    .orderBy(desc(games.gameDate))
    .limit(7);

  // Get assignments for past games
  const pastGameIds = pastGames.map(g => g.id);
  let pastAssignments: any[] = [];

  if (pastGameIds.length > 0) {
    pastAssignments = await db
      .select({
        gameId: assignments.gameId,
        playerId: assignments.playerId,
        positionNumber: assignments.positionNumber,
        positionName: assignments.positionName,
        quarter: assignments.quarter,
      })
      .from(assignments)
      .where(eq(assignments.isSittingOut, false))
      .then(results => results.filter(a => pastGameIds.includes(a.gameId)));
  }

  return { pastGames, pastAssignments };
}

export function calculatePositionHistory(
  teamPlayers: any[],
  pastAssignments: any[]
): Map<number, Record<string, number>> {
  const positionHistory = new Map<number, Record<string, number>>();

  teamPlayers.forEach(player => {
    positionHistory.set(player.id, {});
  });

  pastAssignments.forEach(assignment => {
    const history = positionHistory.get(assignment.playerId);
    if (!history) return;

    const positionName = assignment.positionName || `Pos${assignment.positionNumber}`;
    history[positionName] = (history[positionName] || 0) + 1;
  });

  return positionHistory;
}

export function buildPlayersContext(
  teamPlayers: any[],
  positionHistory: Map<number, Record<string, number>>
): PlayerContext[] {
  return teamPlayers.map(p => {
    const history = positionHistory.get(p.id) || {};
    const totalAppearances = Object.values(history).reduce((sum, count) => sum + count, 0);

    return {
      id: p.id,
      name: p.name,
      description: p.description || 'No description',
      preferredPositions: p.preferredPositions ? JSON.parse(p.preferredPositions) : [],
      positionHistory: totalAppearances > 0 ? history : null,
    };
  });
}

export function buildCurrentLineup(currentAssignments: any[]): CurrentLineup {
  const currentLineup: CurrentLineup = {};

  for (let q = 1; q <= 4; q++) {
    currentLineup[q] = {};
  }

  currentAssignments.forEach(a => {
    if (!a.isSittingOut && a.quarter) {
      currentLineup[a.quarter][a.positionNumber] = a.playerId;
    }
  });

  return currentLineup;
}

export function buildPastGamesContext(
  pastGames: any[],
  pastAssignments: any[]
): PastGameContext[] {
  return pastGames.map(g => {
    const gameAssignments = pastAssignments.filter(a => a.gameId === g.id);
    const lineup: CurrentLineup = {};

    for (let q = 1; q <= 4; q++) {
      lineup[q] = {};
    }

    gameAssignments.forEach(a => {
      if (a.quarter) {
        lineup[a.quarter][a.positionNumber] = a.playerId;
      }
    });

    return {
      date: g.gameDate,
      opponent: g.opponent,
      lineup,
    };
  });
}

export function buildAbsentInjuredContext(absentInjuredPlayers: any[]): AbsentInjuredContext[] {
  return absentInjuredPlayers.map(p => ({
    playerId: p.playerId,
    quarter: p.quarter,
    reason: p.reason,
  }));
}
