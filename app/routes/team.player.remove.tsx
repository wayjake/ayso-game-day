import type { Route } from "./+types/team.player.remove";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, players } from "~/db";
import { eq, and } from "drizzle-orm";
import { deletePlayerImage } from "~/utils/upload.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const formData = await request.formData();
  const playerId = parseInt(formData.get("playerId") as string);
  
  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
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
    
    // Delete player from database
    await db
      .delete(players)
      .where(and(eq(players.id, playerId), eq(players.teamId, teamId)));
    
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