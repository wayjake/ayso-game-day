import type { Route } from "./+types/team.tasks.edit";
import { data, redirect, useNavigation } from "react-router";
import { db, tasks } from "~/db";
import { and, eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { updateTask } from "~/utils/tasks.core";
import { Page, PageHeader } from "~/components/ui";
import { TaskForm, readTaskForm } from "~/components/tasks";

export function meta() {
  return [{ title: "Edit task - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, Number(params.taskId)), eq(tasks.teamId, team.id)))
    .limit(1);
  if (!task) throw new Response("Task not found", { status: 404 });
  return data({ teamId: team.id, task });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const result = await updateTask(db, team.id, Number(params.taskId), readTaskForm(await request.formData()));
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return redirect(`/dashboard/team/${team.id}/tasks/${result.task.id}`);
}

export default function EditTask({ loaderData, actionData }: Route.ComponentProps) {
  const { teamId, task } = loaderData;
  const navigation = useNavigation();
  return (
    <Page width="narrow">
      <PageHeader back={{ to: `/dashboard/team/${teamId}/tasks/${task.id}`, label: task.title }} title="Edit task" />
      <TaskForm values={task} submitLabel="Save" busy={navigation.state !== "idle"} error={actionData?.error} />
    </Page>
  );
}
