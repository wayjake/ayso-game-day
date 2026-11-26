import type { Route } from "./+types/team.tasks-new";
import { data, redirect, useNavigation } from "react-router";
import { db, players } from "~/db";
import { eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { createTask } from "~/utils/tasks.core";
import { Page, PageHeader } from "~/components/ui";
import { TaskForm, readTaskForm } from "~/components/tasks";
import { parseIds } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

export function meta() {
  return [{ title: "New task - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  const roster = await db.select({ id: players.id, name: players.name }).from(players).where(eq(players.teamId, team.id)).orderBy(players.name);
  return data({ teamCode: team.code, players: roster });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  const formData = await request.formData();
  const everyone = formData.get("everyone") !== "0";
  const result = await createTask(db, {
    teamId: team.id,
    createdBy: user.id,
    input: readTaskForm(formData),
    playerIds: everyone ? "all" : parseIds(formData.getAll("playerId")),
  });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return redirect(teamPath(team, `tasks/${result.task.id}`));
}

export default function NewTask({ loaderData, actionData }: Route.ComponentProps) {
  const { teamCode, players } = loaderData;
  const navigation = useNavigation();
  return (
    <Page width="narrow">
      <PageHeader back={{ to: teamPath(teamCode, "tasks"), label: "Tasks" }} title="New task" />
      <TaskForm players={players} submitLabel="Add task" busy={navigation.state !== "idle"} error={actionData?.error} />
    </Page>
  );
}
