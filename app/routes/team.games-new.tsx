import type { Route } from "./+types/team.games-new";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, games } from "~/db";
import { eq, and } from "drizzle-orm";
import { GameFormFields, readGameForm } from "~/components/GameFormFields";
import { serializeGameNotes } from "~/utils/game-notes";
import { Alert, Card, Page, PageHeader, buttonClass } from "~/components/ui";
import { CalendarCheck, Lightbulb } from "@phosphor-icons/react";

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
    { title: "Schedule game - AYSO Game Day" },
    { name: "description", content: "Schedule a new game for your team" },
  ];
}

export default function NewGame({ loaderData, actionData }: Route.ComponentProps) {
  const { team } = loaderData;
  const error = actionData?.error;
  const gamesUrl = `/dashboard/team/${team.id}/games`;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: gamesUrl, label: "Games" }}
        title="Schedule game"
        description={`Add a ${team.format} game. You'll plan the lineup next.`}
      />

      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <GameFormFields />

          {/* Form actions */}
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to={gamesUrl} className={buttonClass({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
            <button type="submit" className={buttonClass({ size: "lg" })}>
              <CalendarCheck size={20} weight="bold" />
              Schedule game
            </button>
          </div>
        </Form>
      </Card>

      {/* Tips */}
      <aside className="mt-6 rounded-2xl bg-primary-soft p-5 text-primary-ink">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb size={18} weight="fill" />
          Scheduling tips
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm marker:text-primary/60">
          <li>Schedule games as soon as you get the season calendar.</li>
          <li>Add the field so parents know where to go.</li>
          <li>Use notes for anything unusual, like tournaments or makeup games.</li>
          <li>You can plan lineups and rotations after scheduling the game.</li>
        </ul>
      </aside>
    </Page>
  );
}
