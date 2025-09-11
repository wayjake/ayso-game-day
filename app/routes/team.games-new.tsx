import type { Route } from "./+types/team.games-new";
import { Form, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, games } from "~/db";
import { eq, and } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
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
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get form data
  const opponent = formData.get("opponent") as string;
  const gameDate = formData.get("gameDate") as string;
  const gameTime = formData.get("gameTime") as string;
  const field = formData.get("field") as string;
  const homeAway = formData.get("homeAway") as string;
  const notes = formData.get("notes") as string;
  
  // Basic validation
  if (!opponent || opponent.trim().length === 0) {
    return data(
      { error: "Opponent is required" },
      { status: 400 }
    );
  }
  
  if (!gameDate) {
    return data(
      { error: "Game date is required" },
      { status: 400 }
    );
  }
  
  if (!homeAway || (homeAway !== 'home' && homeAway !== 'away')) {
    return data(
      { error: "Home/Away selection is required" },
      { status: 400 }
    );
  }
  
  try {
    // Create game
    const [newGame] = await db.insert(games).values({
      teamId: teamId,
      opponent: opponent.trim(),
      gameDate: gameDate,
      gameTime: gameTime?.trim() || null,
      field: field?.trim() || null,
      homeAway: homeAway as 'home' | 'away',
      notes: notes?.trim() || null,
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
            {/* Opponent */}
            <div>
              <label htmlFor="opponent" className="block text-sm font-medium mb-1">
                Opponent Team <span className="text-red-500">*</span>
              </label>
              <input
                id="opponent"
                name="opponent"
                type="text"
                required
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Eagles, Lions, Sharks"
              />
            </div>
            
            {/* Game date and time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="gameDate" className="block text-sm font-medium mb-1">
                  Game Date <span className="text-red-500">*</span>
                </label>
                <input
                  id="gameDate"
                  name="gameDate"
                  type="date"
                  required
                  onClick={(e) => {
                    e.currentTarget.showPicker?.();
                  }}
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                />
              </div>
              
              <div>
                <label htmlFor="gameTime" className="block text-sm font-medium mb-1">
                  Game Time (Optional)
                </label>
                <input
                  id="gameTime"
                  name="gameTime"
                  type="time"
                  onClick={(e) => {
                    e.currentTarget.showPicker?.();
                  }}
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                />
              </div>
            </div>
            
            {/* Home/Away */}
            <div>
              <label className="block text-sm font-medium mb-3">
                Home or Away Game <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 p-3 border border-[var(--border)] rounded hover:bg-[var(--bg)] cursor-pointer transition">
                  <input
                    type="radio"
                    name="homeAway"
                    value="home"
                    required
                    className="border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm font-medium">🏠 Home Game</span>
                </label>
                <label className="flex items-center gap-2 p-3 border border-[var(--border)] rounded hover:bg-[var(--bg)] cursor-pointer transition">
                  <input
                    type="radio"
                    name="homeAway"
                    value="away"
                    required
                    className="border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm font-medium">✈️ Away Game</span>
                </label>
              </div>
            </div>
            
            {/* Field */}
            <div>
              <label htmlFor="field" className="block text-sm font-medium mb-1">
                Field/Location (Optional)
              </label>
              <input
                id="field"
                name="field"
                type="text"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Field 1, Central Park, Away Team Field"
              />
            </div>
            
            {/* Notes */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium mb-1">
                Game Notes (Optional)
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Bring extra water, early warm-up, tournament game"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Add any special instructions or reminders for this game
              </p>
            </div>
            
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