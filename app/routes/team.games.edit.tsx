import type { Route } from "./+types/team.games.edit";
import { Form, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games } from "~/db";
import { eq, and, sql } from "drizzle-orm";
import { GameFormFields, readGameForm } from "~/components/GameFormFields";
import { gameNotesText, parseGameNotes, serializeGameNotes } from "~/utils/game-notes";

async function loadGame(request: Request, params: Route.LoaderArgs["params"]) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const gameId = parseInt(params.gameId);
  const { team } = await requireTeamAccess(teamId, user.id);

  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  if (!game) {
    throw new Response("Game not found", { status: 404 });
  }

  return { team, game };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { team, game } = await loadGame(request, params);
  return data({ team, game, notesText: gameNotesText(game.notes) });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { team, game } = await loadGame(request, params);
  const parsed = readGameForm(await request.formData());

  if ("error" in parsed) {
    return data({ error: parsed.error }, { status: 400 });
  }

  // Keep the lineup planner's saved formations; only the text is from the form
  await db
    .update(games)
    .set({
      ...parsed.values,
      notes: serializeGameNotes({ ...parseGameNotes(game.notes), text: parsed.notesText }),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(games.id, game.id));

  return redirect(`/dashboard/team/${team.id}/games`);
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Edit Game - AYSO Game Day" },
    { name: "description", content: "Edit a scheduled game" },
  ];
}

export default function EditGame({ loaderData, actionData }: Route.ComponentProps) {
  const { team, game, notesText } = loaderData;
  const error = actionData?.error;

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Edit Game</h1>
          <p className="mt-2 text-[var(--muted)]">
            {team.name} vs {game.opponent}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <Form method="post" className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="p-6 space-y-6">
            <GameFormFields
              defaults={{
                opponent: game.opponent,
                gameDate: game.gameDate,
                gameTime: game.gameTime,
                field: game.field,
                homeAway: game.homeAway,
                notesText,
              }}
            />

            <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition"
              >
                Save Changes
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
      </div>
    </div>
  );
}
