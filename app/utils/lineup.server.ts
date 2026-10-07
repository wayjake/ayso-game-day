import { db, players, assignments, sitOuts } from "~/db";
import { and, eq, inArray } from "drizzle-orm";

// Everything a read-only lineup view needs beyond the team and game rows
export async function getLineupRows(teamId: number, gameId: number) {
  const [teamPlayers, savedAssignments, absences] = await Promise.all([
    db
      .select({
        id: players.id,
        name: players.name,
        jerseyNumber: players.jerseyNumber,
        profilePicture: players.profilePicture,
        preferredPositions: players.preferredPositions,
      })
      .from(players)
      .where(eq(players.teamId, teamId))
      .orderBy(players.name),
    db
      .select({
        playerId: assignments.playerId,
        positionNumber: assignments.positionNumber,
        quarter: assignments.quarter,
        isSittingOut: assignments.isSittingOut,
      })
      .from(assignments)
      .where(eq(assignments.gameId, gameId)),
    db
      .select({
        playerId: sitOuts.playerId,
        quarter: sitOuts.quarter,
        reason: sitOuts.reason,
      })
      .from(sitOuts)
      .where(and(eq(sitOuts.gameId, gameId), inArray(sitOuts.reason, ["absent", "injured"]))),
  ]);

  return { players: teamPlayers, assignments: savedAssignments, absences };
}
