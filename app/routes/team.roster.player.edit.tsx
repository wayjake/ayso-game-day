import type { Route } from "./+types/team.roster.player.edit";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, positions } from "~/db";
import { eq, and, or } from "drizzle-orm";
import { deletePlayerImage } from "~/utils/upload.server";
import { ImageUploader } from "~/components/ImageUploader";
import { useState } from "react";
import { Alert, Button, Card, Page, PageHeader, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { Lightbulb } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const playerId = parseInt(params.playerId);
  
  // Get team details and verify ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
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
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
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
  const [removePhoto, setRemovePhoto] = useState(false);
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
    <Page width="narrow">
      <PageHeader
        title={player.name}
        description="Edit details, photo and preferred positions."
        back={{ to: `/dashboard/team/${team.id}/roster`, label: "Roster" }}
      />

      {/* Error message */}
      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          {/* Player name */}
          <div>
            <label htmlFor="name" className={labelClass}>
              Name <span className="text-danger">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={player.name}
              className={inputClass}
              placeholder="e.g. Alex Johnson"
            />
          </div>

          {/* Jersey Number */}
          <div>
            <label htmlFor="jerseyNumber" className={labelClass}>
              Jersey number <span className="font-normal text-subtle">(optional)</span>
            </label>
            <div className="w-32">
              <input
                id="jerseyNumber"
                name="jerseyNumber"
                type="number"
                min="0"
                max="99"
                defaultValue={player.jerseyNumber ?? ""}
                className={inputClass}
                placeholder="e.g. 10"
              />
            </div>
          </div>

          {/* Profile Picture Upload */}
          <div>
            <span className={labelClass}>Photo</span>

            {/* Hidden input to store uploaded image URL */}
            <input
              type="hidden"
              name="profilePictureUrl"
              value={uploadedImageUrl || ""}
            />

            {/* Show upload error if any */}
            {uploadError && <Alert className="mb-3">{uploadError}</Alert>}

            {/* Remounting on remove clears the uploader's local preview too */}
            <ImageUploader
              key={removePhoto ? "removed" : "photo"}
              currentImage={removePhoto ? null : uploadedImageUrl || player.profilePicture}
              onUploadComplete={(url) => {
                // A fresh upload cancels a pending removal
                setUploadedImageUrl(url);
                setRemovePhoto(false);
                setUploadError(null);
              }}
              onUploadError={(error) => {
                setUploadError(error);
              }}
              endpoint="playerImage"
            />

            {/* Option to remove picture */}
            {(player.profilePicture || uploadedImageUrl || removePhoto) && (
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  name="removeCurrentPicture"
                  value="true"
                  checked={removePhoto}
                  onChange={(e) => {
                    setRemovePhoto(e.target.checked);
                    if (e.target.checked) {
                      setUploadedImageUrl(null);
                    }
                  }}
                  className="h-4 w-4 accent-danger"
                />
                <span className="text-sm font-medium text-danger">Remove photo</span>
              </label>
            )}
          </div>

          {/* Description/notes */}
          <div>
            <label htmlFor="description" className={labelClass}>
              Notes <span className="font-normal text-subtle">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={player.description || ""}
              className={inputClass}
              placeholder="e.g. Fast runner, good at defense, prefers left side"
            />
            <p className={hintClass}>
              Strengths, preferences, or anything else worth remembering on game day.
            </p>
          </div>

          {/* Preferred positions */}
          <fieldset>
            <legend className={labelClass}>
              Preferred positions <span className="font-normal text-subtle">(optional)</span>
            </legend>
            <p className="-mt-0.5 mb-4 text-xs text-muted">
              Positions this player prefers or is strong at. Used when planning rotations.
            </p>

            <div className="space-y-4">
              {Object.entries(positionsByCategory).map(([category, categoryPositions]) => (
                <div key={category}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                    {category}s
                  </h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(categoryPositions as any[]).map((pos) => (
                      <label key={pos.abbreviation} className={positionOptionClass}>
                        <input
                          type="checkbox"
                          name="positions"
                          value={pos.abbreviation}
                          defaultChecked={existingPositions.includes(pos.abbreviation)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 text-sm">
                          <span className="font-semibold">{pos.abbreviation}</span>
                          <span className="ml-1 text-muted">{pos.fullName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          {/* Form actions */}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link
              to={`/dashboard/team/${team.id}/roster`}
              className={buttonClass({ variant: "secondary" })}
            >
              Cancel
            </Link>
            <Button type="submit">Save changes</Button>
          </div>
        </Form>
      </Card>

      {/* Tips */}
      <div className="mt-6 flex gap-3 rounded-xl bg-primary-soft p-4 text-primary-ink">
        <Lightbulb size={20} className="mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">Keeping player info current</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
            <li>Up-to-date details make team management easier.</li>
            <li>Update preferred positions as players develop new skills.</li>
            <li>Use notes to track important changes or special considerations.</li>
            <li>Photos help you spot players quickly during games.</li>
          </ul>
        </div>
      </div>
    </Page>
  );
}

// Checkbox chip for a position; highlights when checked
const positionOptionClass =
  "flex cursor-pointer items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-transparent transition hover:ring-line-strong has-[:checked]:bg-primary-soft has-[:checked]:ring-primary";
