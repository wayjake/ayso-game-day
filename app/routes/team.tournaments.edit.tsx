import type { Route } from "./+types/team.tournaments.edit";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { deleteTournament, getTournament, tournamentGames, updateTournament } from "~/utils/tournaments.server";
import { readTournamentForm, tournamentDates } from "~/utils/tournaments";
import { TournamentFormFields } from "~/components/TournamentFormFields";
import { formatGameDate, formatGameTime } from "~/utils/dates";
import { Alert, Badge, Card, CardHeader, Page, PageHeader, buttonClass } from "~/components/ui";
import { Plus, SoccerBall } from "@phosphor-icons/react";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

async function load(request: Request, params: { teamCode: string; tournamentId: string }) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  await requireTeamAccess(teamId, user.id);
  const tournament = await getTournament(teamId, parseId(params.tournamentId));
  if (!tournament) throw new Response("Tournament not found", { status: 404 });
  return { tournament };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tournament } = await load(request, params);
  const games = (await tournamentGames(tournament.id)).map((g) => ({ id: g.id, opponent: g.opponent, gameDate: g.gameDate, gameTime: g.gameTime, field: g.field, cancelled: g.status === "cancelled" }));
  return data({ tournament, games });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { tournament } = await load(request, params);
  const formData = await request.formData();
  if (formData.get("_action") === "delete") {
    await deleteTournament(tournament);
    return redirect(teamPath(params.teamCode, "games"));
  }
  const parsed = readTournamentForm(formData);
  if ("error" in parsed) return data({ error: parsed.error, saved: false, note: null }, { status: 400 });
  const moved = await updateTournament(tournament, parsed.values);
  return data({
    error: null,
    saved: true,
    note: moved > 0 ? `${moved === 1 ? "1 game isn't" : `${moved} games aren't`} on the new days any more, so ${moved === 1 ? "it's" : "they're"} no longer part of it.` : null,
  });
}

export function meta() {
  return [{ title: "Tournament - BenchTalk" }];
}

export default function EditTournament({ loaderData, actionData, params }: Route.ComponentProps) {
  const { tournament, games } = loaderData;
  const base = teamPath(params.teamCode);
  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `${base}/games`, label: "Schedule" }}
        title={tournament.name}
        description={[tournamentDates(tournament), tournament.location].filter(Boolean).join(" · ")}
      />
      {actionData?.error && <Alert className="mb-6">{actionData.error}</Alert>}
      {actionData?.saved && (
        <Alert tone="success" className="mb-6">
          Saved.{actionData.note ? ` ${actionData.note}` : ""}
        </Alert>
      )}

      <section className="mb-8">
        <CardHeader
          title="Games"
          count={games.length}
          className="mb-3"
          actions={
            <Link to={`${base}/games/new?tournament=${tournament.id}`} className={buttonClass({ size: "sm", variant: "secondary" })}>
              <Plus size={16} weight="bold" />
              Add a game
            </Link>
          }
        />
        <Card>
          {games.length === 0 ? (
            <p className="p-5 text-sm text-muted">No games yet. Add each one with its time, or pick this tournament when you edit a game already on the schedule.</p>
          ) : (
            <ul className="divide-y divide-line">
              {games.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 p-4 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <SoccerBall size={16} weight="fill" className="text-brand" />
                      vs {g.opponent}
                      {g.cancelled && <Badge tone="danger">Cancelled</Badge>}
                    </div>
                    <div className="text-sm text-muted">
                      {[formatGameDate(g.gameDate, { weekday: "short", month: "short", day: "numeric" }), formatGameTime(g.gameTime) || "Time TBD", g.field].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link to={`${base}/rsvps/game/${g.id}`} className={buttonClass({ size: "sm", variant: "ghost" })}>RSVPs and jobs</Link>
                    <Link to={`${base}/games/${g.id}/edit`} className={buttonClass({ size: "sm", variant: "ghost" })}>Edit</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <Card>
        <Form method="post" className="space-y-6 p-5 sm:p-6">
          <h2 className="font-semibold">Details</h2>
          <TournamentFormFields defaults={tournament} />
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <button type="submit" className={buttonClass({ size: "lg" })}>Save changes</button>
          </div>
        </Form>
      </Card>

      <Form
        method="post"
        className="mt-6"
        onSubmit={(e) => {
          if (!confirm(`Delete ${tournament.name}? Its games stay on the schedule.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="_action" value="delete" />
        <button type="submit" className={buttonClass({ variant: "ghost", className: "text-danger" })}>Delete tournament</button>
      </Form>
    </Page>
  );
}
