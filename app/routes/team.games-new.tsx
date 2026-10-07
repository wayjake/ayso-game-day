import type { Route } from "./+types/team.games-new";
import { Form, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, games } from "~/db";
import { eq, and } from "drizzle-orm";
import { GameFormFields, readGameForm } from "~/components/GameFormFields";
import { serializeGameNotes } from "~/utils/game-notes";

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
  
  return data({
    team,
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
  
  const parsed = readGameForm(formData);
  if ("error" in parsed) {
    return data({ error: parsed.error }, { status: 400 });
  }

  try {
    // Create game
    const [newGame] = await db.insert(games).values({
      teamId: teamId,
      ...parsed.values,
      notes: serializeGameNotes({ text: parsed.notesText }),
    }).returning();
    
    // Redirect to lineup planning page for the new game
    return redirect(`/dashboard/team/${teamId}/games/${newGame.id}/lineup`);
  } catch (error) {
    console.error("Error creating game:", error);
    return data(
      { error: "Failed to create game. Please try again." },
      { status: 500 }
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Schedule Game - AYSO Game Day" },
    { name: "description", content: "Schedule a new game for your team" },
  ];
}

export default function NewGame({ loaderData, actionData }: Route.ComponentProps) {
  const { team } = loaderData;
  const error = actionData?.error;
  
  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Schedule New Game</h1>
          <p className="mt-2 text-[var(--muted)]">
            Schedule a game for {team.name} ({team.format})
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
            <GameFormFields />

            {/* Form actions */}
            <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Schedule Game
              </button>
              <a
                href={`/dashboard/team/${team.id}/games`}
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
              >
                Cancel
              </a>
            </div>
          </div>
        </Form>
        
        {/* Tips */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Tips for Game Scheduling</h3>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Schedule games as soon as you receive the season calendar</li>
            <li>• Add field information to help parents with directions</li>
            <li>• Use notes for special game requirements (tournaments, makeup games, etc.)</li>
            <li>• You can plan lineups and rotations after scheduling the game</li>
          </ul>
        </div>
      </div>
    </div>
  );
}