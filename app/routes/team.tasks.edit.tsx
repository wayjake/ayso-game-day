import type { Route } from "./+types/team.tasks.edit";
import { data, redirect, useNavigation } from "react-router";
import { db, tasks } from "~/db";
import { and, eq } from "drizzle-orm";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { updateTask } from "~/utils/tasks.core";
import { Page, PageHeader } from "~/components/ui";
import { TaskForm, readTaskForm } from "~/components/tasks";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

export function meta() {
  return [{ title: "Edit task - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  const taskId = parseId(params.taskId);
  const [task] = taskId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.teamId, team.id)))
        .limit(1)
    : [];
  if (!task) throw new Response("Task not found", { status: 404 });
  return data({ teamCode: team.code, task });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  const taskId = parseId(params.taskId);
  if (!taskId) throw new Response("Task not found", { status: 404 });
  const result = await updateTask(db, team.id, taskId, readTaskForm(await request.formData()));
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return redirect(teamPath(team, `tasks/${result.task.id}`));
}

export default function EditTask({ loaderData, actionData }: Route.ComponentProps) {
  const { teamCode, task } = loaderData;
  const navigation = useNavigation();
  return (
    <Page width="narrow">
      <PageHeader back={{ to: teamPath(teamCode, `tasks/${task.id}`), label: task.title }} title="Edit task" />
      <TaskForm values={task} submitLabel="Save" busy={navigation.state !== "idle"} error={actionData?.error} />
    </Page>
  );
}
