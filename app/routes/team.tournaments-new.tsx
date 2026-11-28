import type { Route } from "./+types/team.tournaments-new";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { createTournament } from "~/utils/tournaments.server";
import { readTournamentForm } from "~/utils/tournaments";
import { TournamentFormFields } from "~/components/TournamentFormFields";
import { Alert, Card, Page, PageHeader, buttonClass } from "~/components/ui";
import { Trophy } from "@phosphor-icons/react";
import { teamPath } from "~/utils/team-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  await requireTeamAccess(teamId, user.id);
  const parsed = readTournamentForm(await request.formData());
  if ("error" in parsed) return data({ error: parsed.error }, { status: 400 });
  const t = await createTournament(teamId, parsed.values, user.id);
  return redirect(teamPath(params.teamCode, `tournaments/${t.id}`));
}

export function meta() {
  return [{ title: "Add tournament - BenchTalk" }];
}

export default function NewTournament({ actionData, params }: Route.ComponentProps) {
  const gamesUrl = teamPath(params.teamCode, "games");
  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: gamesUrl, label: "Schedule" }}
        title="Add tournament"
        description="One event for the whole tournament. Its games go in it next, each with its own time and RSVPs."
      />
      {actionData?.error && <Alert className="mb-6">{actionData.error}</Alert>}
      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <TournamentFormFields />
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to={gamesUrl} className={buttonClass({ variant: "secondary", size: "lg" })}>Cancel</Link>
            <button type="submit" className={buttonClass({ size: "lg" })}>
              <Trophy size={20} weight="bold" />
              Add tournament
            </button>
          </div>
        </Form>
      </Card>
    </Page>
  );
}
