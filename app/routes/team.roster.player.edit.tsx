import type { Route } from "./+types/team.roster.player.edit";
import { Form, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, players, positions } from "~/db";
import { eq, and, or } from "drizzle-orm";
import { deletePlayerImage } from "~/utils/upload.server";
import { getImageUrl } from "~/utils/image";
import { ImageUploader } from "~/components/ImageUploader";
import { useState } from "react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const playerId = parseInt(params.playerId);
  
  // Get team details and verify ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get player details
  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.teamId, teamId)))
    .limit(1);
  
  if (!player) {
    throw new Response("Player not found", { status: 404 });
  }
  
  // Get positions for this format
  const availablePositions = await db
    .select({
      number: positions.number,
      abbreviation: positions.abbreviation,
      fullName: positions.fullName,
      category: positions.category,
    })
    .from(positions)
    .where(or(
      eq(positions.format, 'all'),
      eq(positions.format, team.format)
    ))
    .orderBy(positions.number);
  
  return data({
    team,
    player,
    positions: availablePositions,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  const teamId = parseInt(params.teamId);
  const playerId = parseInt(params.playerId);
  
  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Verify player exists and belongs to team
  const [existingPlayer] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.teamId, teamId)))
    .limit(1);
  
  if (!existingPlayer) {
    throw new Response("Player not found", { status: 404 });
  }
  
  // Get form data
  const name = formData.get("name") as string;
  const jerseyNumberStr = formData.get("jerseyNumber") as string;
  const jerseyNumber = jerseyNumberStr ? parseInt(jerseyNumberStr, 10) : null;
  const description = formData.get("description") as string;
  const preferredPositions = formData.getAll("positions") as string[];
  const profilePictureUrl = formData.get("profilePictureUrl") as string;
  const removeCurrentPicture = formData.get("removeCurrentPicture") === "true";
  
  // Basic validation
  if (!name || name.trim().length === 0) {
    return data(
      { error: "Player name is required" },
      { status: 400 }
    );
  }
  
  try {
    let profilePicturePath = existingPlayer.profilePicture;
    
    // Handle profile picture removal
    if (removeCurrentPicture && existingPlayer.profilePicture) {
      // If it's a local file, delete it
      if (existingPlayer.profilePicture.startsWith('/images/')) {
        await deletePlayerImage(existingPlayer.profilePicture);
      }
      profilePicturePath = null;
    }
    
    // Handle new profile picture URL from UploadThing
    if (profilePictureUrl && !removeCurrentPicture) {
      // If old picture is a local file, delete it
      if (existingPlayer.profilePicture && existingPlayer.profilePicture.startsWith('/images/')) {
        await deletePlayerImage(existingPlayer.profilePicture);
      }
      profilePicturePath = profilePictureUrl;
    }
    
    // Update player
    await db.update(players)
      .set({
        name: name.trim(),
        jerseyNumber: jerseyNumber,
        description: description?.trim() || null,
        preferredPositions: preferredPositions.length > 0 ? JSON.stringify(preferredPositions) : null,
        profilePicture: profilePicturePath,
      })
      .where(eq(players.id, playerId));
    
    return redirect(`/dashboard/team/${teamId}/roster`);
  } catch (error) {
    console.error("Error updating player:", error);
    return data(
      { error: "Failed to update player. Please try again." },
      { status: 500 }
    );
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Edit ${loaderData?.player?.name || 'Player'} - AYSO Game Day` },
    { name: "description", content: "Edit player information" },
  ];
}

export default function EditPlayer({ loaderData, actionData }: Route.ComponentProps) {
  const { team, player, positions } = loaderData;
  const error = actionData?.error;
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Group positions by category
  const positionsByCategory = positions.reduce((acc: any, pos: any) => {
    if (!acc[pos.category]) acc[pos.category] = [];
    acc[pos.category].push(pos);
    return acc;
  }, {});
  
  // Parse existing preferred positions
  const existingPositions = player.preferredPositions 
    ? JSON.parse(player.preferredPositions) 
    : [];
  
  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Edit Player</h1>
          <p className="mt-2 text-[var(--muted)]">
            Update {player.name}'s information for {team.name} ({team.format})
          </p>
        </div>
        
        {/* Error message */}
        {error && (
          <div className="mb-6 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        
        <Form method="post" className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="p-6 space-y-6">
            {/* Player name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Player Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={player.name}
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Alex Johnson"
              />
            </div>

            {/* Jersey Number */}
            <div>
              <label htmlFor="jerseyNumber" className="block text-sm font-medium mb-1">
                Jersey Number (Optional)
              </label>
              <input
                id="jerseyNumber"
                name="jerseyNumber"
                type="number"
                min="0"
                max="99"
                defaultValue={player.jerseyNumber ?? ""}
                className="w-32 rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., 10"
              />
            </div>

            {/* Profile Picture Upload */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Profile Picture
              </label>
              
              {/* Hidden input to store uploaded image URL */}
              <input
                type="hidden"
                name="profilePictureUrl"
                value={uploadedImageUrl || ""}
              />
              
              {/* Show upload error if any */}
              {uploadError && (
                <div className="mb-3 p-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">
                  {uploadError}
                </div>
              )}
              
              <ImageUploader
                currentImage={uploadedImageUrl || player.profilePicture}
                onUploadComplete={(url) => {
                  setUploadedImageUrl(url);
                  setUploadError(null);
                }}
                onUploadError={(error) => {
                  setUploadError(error);
                }}
                endpoint="playerImage"
              />
              
              {/* Option to remove picture */}
              {(player.profilePicture || uploadedImageUrl) && (
                <label className="flex items-center gap-2 mt-3">
                  <input
                    type="checkbox"
                    name="removeCurrentPicture"
                    value="true"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setUploadedImageUrl(null);
                      }
                    }}
                    className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm text-red-600">Remove profile picture</span>
                </label>
              )}
            </div>
            
            {/* Description/notes */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-1">
                Notes (Optional)
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={player.description || ""}
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Fast runner, good at defense, prefers left side"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Add any notes about the player's strengths, preferences, or special considerations
              </p>
            </div>
            
            {/* Preferred positions */}
            <div>
              <label className="block text-sm font-medium mb-3">
                Preferred Positions (Optional)
              </label>
              <p className="text-xs text-[var(--muted)] mb-3">
                Select positions this player prefers or excels at. This helps with rotation planning.
              </p>
              
              {Object.entries(positionsByCategory).map(([category, categoryPositions]) => (
                <div key={category} className="mb-4">
                  <h4 className="text-sm font-medium text-[var(--muted)] mb-2 capitalize">
                    {category}s
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(categoryPositions as any[]).map((pos) => (
                      <label
                        key={pos.abbreviation}
                        className="flex items-center gap-2 p-2 border border-[var(--border)] rounded hover:bg-[var(--bg)] cursor-pointer transition"
                      >
                        <input
                          type="checkbox"
                          name="positions"
                          value={pos.abbreviation}
                          defaultChecked={existingPositions.includes(pos.abbreviation)}
                          className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                        />
                        <span className="text-sm">
                          <span className="font-medium">{pos.abbreviation}</span>
                          <span className="text-[var(--muted)] ml-1">- {pos.fullName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Form actions */}
            <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Update Player
              </button>
              <a
                href={`/dashboard/team/${team.id}/roster`}
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
              >
                Cancel
              </a>
            </div>
          </div>
        </Form>
        
        {/* Tips */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Tips for Updating Player Info</h3>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Keep player information up to date for better team management</li>
            <li>• Update preferred positions as players develop new skills</li>
            <li>• Use notes to track important changes or special considerations</li>
            <li>• Profile pictures help with quick player identification during games</li>
          </ul>
        </div>
      </div>
    </div>
  );
}