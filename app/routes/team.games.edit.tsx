import type { Route } from "./+types/team.games.edit";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, games } from "~/db";
import { eq, and, sql } from "drizzle-orm";
import { GameFormFields, readGameForm } from "~/components/GameFormFields";
import { gameNotesText, parseGameNotes, serializeGameNotes } from "~/utils/game-notes";
import { notifyFamilies } from "~/utils/schedule.server";
import { formatGameDateTime } from "~/utils/dates";
import { Alert, Card, Page, PageHeader, buttonClass } from "~/components/ui";
import { teamIdFromCode } from "~/utils/team-access.server";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";
import { checkGameTournament, tournamentChoices } from "~/utils/tournaments.server";
import { todayISO } from "~/utils/dates";

async function loadGame(request: Request, params: Route.LoaderArgs["params"]) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));
  const gameId = parseId(params.gameId) ?? ""; // Not an id: matches nothing, so 404s below
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
  return data({ team, game, notesText: gameNotesText(game.notes), tournaments: await tournamentChoices(team.id, todayISO(), game.tournamentId) });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { team, game } = await loadGame(request, params);
  const formData = await request.formData();
  const parsed = readGameForm(formData);

  if ("error" in parsed) {
    return data({ error: parsed.error }, { status: 400 });
  }
  const inTournament = await checkGameTournament(team.id, formData.get("tournamentId"), parsed.values.gameDate);
  if ("error" in inTournament) return data({ error: inTournament.error }, { status: 400 });

  // Keep the lineup planner's saved formations; only the text is from the form
  await db
    .update(games)
    .set({
      ...parsed.values,
      tournamentId: inTournament.tournamentId,
      notes: serializeGameNotes({ ...parseGameNotes(game.notes), text: parsed.notesText }),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(games.id, game.id));

  const moved =
    game.gameDate !== parsed.values.gameDate ||
    game.gameTime !== parsed.values.gameTime ||
    game.field !== parsed.values.field;
  if (moved && game.status !== "cancelled") {
    await notifyFamilies(team.id, {
      title: `Game changed: vs ${parsed.values.opponent}`,
      body: `Now ${formatGameDateTime(parsed.values.gameDate, parsed.values.gameTime)}${parsed.values.field ? ` at ${parsed.values.field}` : ""}.`,
      tag: `game-${game.id}`,
    });
  }

  return redirect(`${teamPath(team)}/games`);
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Edit game - BenchTalk" },
    { name: "description", content: "Edit a scheduled game" },
  ];
}

export default function EditGame({ loaderData, actionData }: Route.ComponentProps) {
  const { team, game, notesText, tournaments } = loaderData;
  const error = actionData?.error;
  const gamesUrl = `${teamPath(team)}/games`;

  return (
    <Page width="narrow">
      <PageHeader back={{ to: gamesUrl, label: "Schedule" }} title="Edit game" description={`vs ${game.opponent}`} />

      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <GameFormFields
            tournaments={tournaments}
            defaults={{
              tournamentId: game.tournamentId,
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
