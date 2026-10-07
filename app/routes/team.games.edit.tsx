import type { Route } from "./+types/team.games.edit";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games } from "~/db";
import { eq, and, sql } from "drizzle-orm";
import { GameFormFields, readGameForm } from "~/components/GameFormFields";
import { gameNotesText, parseGameNotes, serializeGameNotes } from "~/utils/game-notes";
import { Alert, Card, Page, PageHeader, buttonClass } from "~/components/ui";

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
    { title: "Edit game - AYSO Game Day" },
    { name: "description", content: "Edit a scheduled game" },
  ];
}

export default function EditGame({ loaderData, actionData }: Route.ComponentProps) {
  const { team, game, notesText } = loaderData;
  const error = actionData?.error;
  const gamesUrl = `/dashboard/team/${team.id}/games`;

  return (
    <Page width="narrow">
      <PageHeader back={{ to: gamesUrl, label: "Games" }} title="Edit game" description={`vs ${game.opponent}`} />

      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
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

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to={gamesUrl} className={buttonClass({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
            <button type="submit" className={buttonClass({ size: "lg" })}>
              Save changes
            </button>
          </div>
        </Form>
      </Card>
    </Page>
  );
}
