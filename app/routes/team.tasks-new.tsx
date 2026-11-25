import type { Route } from "./+types/team.tasks-new";
import { data, redirect, useNavigation } from "react-router";
import { db, players } from "~/db";
import { eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { createTask } from "~/utils/tasks.core";
import { Page, PageHeader } from "~/components/ui";
import { TaskForm, readTaskForm } from "~/components/tasks";

export function meta() {
  return [{ title: "New task - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const roster = await db.select({ id: players.id, name: players.name }).from(players).where(eq(players.teamId, team.id)).orderBy(players.name);
  return data({ teamId: team.id, players: roster });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const formData = await request.formData();
  const everyone = formData.get("everyone") !== "0";
  const result = await createTask(db, {
    teamId: team.id,
    createdBy: user.id,
    input: readTaskForm(formData),
    playerIds: everyone ? "all" : formData.getAll("playerId").map(Number).filter(Boolean),
  });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return redirect(`/dashboard/team/${team.id}/tasks/${result.task.id}`);
}

export default function NewTask({ loaderData, actionData }: Route.ComponentProps) {
  const { teamId, players } = loaderData;
  const navigation = useNavigation();
  return (
    <Page width="narrow">
      <PageHeader back={{ to: `/dashboard/team/${teamId}/tasks`, label: "Tasks" }} title="New task" />
      <TaskForm players={players} submitLabel="Add task" busy={navigation.state !== "idle"} error={actionData?.error} />
    </Page>
  );
}
