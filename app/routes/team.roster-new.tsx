import type { Route } from "./+types/team.roster-new";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, positions } from "~/db";
import { eq, and, or } from "drizzle-orm";
import { ImageUploader } from "~/components/ImageUploader";
import { useState } from "react";
import { Alert, Button, Card, Page, PageHeader, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { Lightbulb, Plus } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
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
    positions: availablePositions,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  const teamId = parseInt(params.teamId);
  
  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get form data
  const name = formData.get("name") as string;
  const jerseyNumberStr = formData.get("jerseyNumber") as string;
  const jerseyNumber = jerseyNumberStr ? parseInt(jerseyNumberStr, 10) : null;
  const description = formData.get("description") as string;
  const preferredPositions = formData.getAll("positions") as string[];
  const profilePictureUrl = formData.get("profilePictureUrl") as string;
  
  // Basic validation
  if (!name || name.trim().length === 0) {
    return data(
      { error: "Player name is required" },
      { status: 400 }
    );
  }
  
  try {
    // Create player with UploadThing URL if provided
    const [newPlayer] = await db.insert(players).values({
      teamId: teamId,
      name: name.trim(),
      jerseyNumber: jerseyNumber,
      description: description?.trim() || null,
      preferredPositions: preferredPositions.length > 0 ? JSON.stringify(preferredPositions) : null,
      profilePicture: profilePictureUrl || null,
    }).returning({ id: players.id });
    
    return redirect(`/dashboard/team/${teamId}/roster`);
  } catch (error) {
    console.error("Error creating player:", error);
    return data(
      { error: "Failed to create player. Please try again." },
      { status: 500 }
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Add player - AYSO Game Day" },
    { name: "description", content: "Add a new player to your team roster" },
  ];
}

export default function NewPlayer({ loaderData, actionData }: Route.ComponentProps) {
  const { team, positions } = loaderData;
  const error = actionData?.error;
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Group positions by category
  const positionsByCategory = positions.reduce((acc: any, pos: any) => {
    if (!acc[pos.category]) acc[pos.category] = [];
    acc[pos.category].push(pos);
    return acc;
  }, {});
  
  return (
    <Page width="narrow">
      <PageHeader
        title="Add player"
        description={`Add a player to your ${team.format} roster.`}
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
                className={inputClass}
                placeholder="e.g. 10"
              />
            </div>
          </div>

          {/* Profile Picture Upload */}
          <div>
            <span className={labelClass}>
              Photo <span className="font-normal text-subtle">(optional)</span>
            </span>

            {/* Hidden input to store uploaded image URL */}
            <input
              type="hidden"
              name="profilePictureUrl"
              value={uploadedImageUrl || ""}
            />

            {/* Show upload error if any */}
            {uploadError && <Alert className="mb-3">{uploadError}</Alert>}

            <ImageUploader
              currentImage={uploadedImageUrl}
              onUploadComplete={(url) => {
                setUploadedImageUrl(url);
                setUploadError(null);
              }}
              onUploadError={(error) => {
                setUploadError(error);
              }}
              endpoint="playerImage"
            />
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
            <Button type="submit">
              <Plus size={18} weight="bold" />
              Add player
            </Button>
          </div>
        </Form>
      </Card>

      {/* Tips */}
      <div className="mt-6 flex gap-3 rounded-xl bg-primary-soft p-4 text-primary-ink">
        <Lightbulb size={20} className="mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">Roster tips</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
            <li>Add every player at the start of the season so game planning is easier.</li>
            <li>Use notes for things like parent contacts or medical considerations.</li>
            <li>Preferred positions help the rotation engine build fair lineups.</li>
            <li>You can edit a player any time from the roster page.</li>
          </ul>
        </div>
      </div>
    </Page>
  );
}

// Checkbox chip for a position; highlights when checked
const positionOptionClass =
  "flex cursor-pointer items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-transparent transition hover:ring-line-strong has-[:checked]:bg-primary-soft has-[:checked]:ring-primary";
