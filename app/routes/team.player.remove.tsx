import type { Route } from "./+types/team.player.remove";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, guardians, rsvps, contacts, taskAssignments } from "~/db";
import { eq, and } from "drizzle-orm";
import { deletePlayerImage } from "~/utils/upload.server";
import { hasLedgerHistory } from "~/utils/ledger.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const formData = await request.formData();
  const playerId = parseInt(formData.get("playerId") as string);
  
  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);
  
  if (!team) {
    return data(
      { success: false, error: "Team not found" },
      { status: 404 }
    );
  }
  
  try {
    // Get player details before deletion (for cleanup)
    const [player] = await db
      .select()
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.teamId, teamId)))
      .limit(1);
    
    if (!player) {
      return data(
        { success: false, error: "Player not found" },
        { status: 404 }
      );
    }
    
    // Money history has to outlive the roster, so a player with any stays
    if (await hasLedgerHistory(playerId)) {
      return data(
        { success: false, error: `${player.name} has money history on this team (charges or payments), so they can't be removed.` },
        { status: 400 }
      );
    }

    // All or nothing: foreign keys are enforced, so a player with lineup
    // history still can't be deleted, and then nothing else changes either
    await db.transaction(async (tx) => {
      // Parent links, RSVPs and task checkmarks go with the player; their contacts stay as general team contacts
      await tx.delete(guardians).where(eq(guardians.playerId, playerId));
      await tx.delete(rsvps).where(eq(rsvps.playerId, playerId));
      await tx.delete(taskAssignments).where(eq(taskAssignments.playerId, playerId));
      await tx.update(contacts).set({ playerId: null }).where(eq(contacts.playerId, playerId));
      await tx
        .delete(players)
        .where(and(eq(players.id, playerId), eq(players.teamId, teamId)));
    });
    
    // Clean up profile picture if it exists
    if (player.profilePicture) {
      await deletePlayerImage(player.profilePicture);
    }
    
    return data({
      success: true,
      message: `${player.name} has been removed from the team`
    });
  } catch (error) {
    console.error("Error removing player:", error);
    return data(
      { success: false, error: "Failed to remove player. Please try again." },
      { status: 500 }
    );
  }
}