import type { Route } from "./+types/family.todo";
import { data } from "react-router";
import { db } from "~/db";
import { requireParent } from "~/utils/family.server";
import { familyTasks } from "~/utils/tasks.server";
import { setFamilyDone } from "~/utils/tasks.core";
import { todayISO } from "~/utils/dates";
import { FamilyTodo } from "~/components/FamilyTodo";
import { Card, EmptyState } from "~/components/ui";
import { ListChecks } from "@phosphor-icons/react";
import { parseId } from "~/utils/ids";

// The family's To do tab: everything the coaches asked for, open first

export async function loader({ request }: Route.LoaderArgs) {
  const { kids } = await requireParent(request);
  return data({
    tasks: await familyTasks(kids),
    today: todayISO(),
    multipleTeams: new Set(kids.map((k) => k.teamId)).size > 1,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user, kids } = await requireParent(request);
  const formData = await request.formData();
  if (formData.get("_action") !== "task") return data({ error: "Unknown action" }, { status: 400 });

  // Checking a task off (or taking it back), only for your own kids on that task's team
  const given = formData.getAll("playerId").map((v) => parseId(v));
  const playerIds = given.filter((id): id is string => id !== null);
  const mine = kids.filter((k) => playerIds.includes(k.playerId));
  const teamId = mine[0]?.teamId;
  const taskId = parseId(formData.get("taskId"));
  if (!taskId || mine.length === 0 || mine.length !== given.length || mine.some((k) => k.teamId !== teamId)) {
    return data({ error: "Can't update that task" }, { status: 400 });
  }
  const result = await setFamilyDone(db, {
    teamId,
    taskId,
    playerIds,
    done: formData.get("done") === "1",
    by: user.id,
    via: "app",
  });
  if (!result.task || result.playerIds.length === 0) return data({ error: "That task isn't there anymore" }, { status: 400 });
  return data({ ok: true });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "To do - BenchTalk" }];
}

export default function FamilyTodoPage({ loaderData }: Route.ComponentProps) {
  const { tasks, today, multipleTeams } = loaderData;

  return (
    <div className="pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">To do</h1>
      <p className="mt-1 text-muted">Forms, fees and anything else the coaches need from your family.</p>

      {tasks.length === 0 ? (
        <Card className="mt-5">
          <EmptyState icon={<ListChecks size={24} />} title="Nothing to do">
            When a coach asks your family for something, it shows up here.
          </EmptyState>
        </Card>
      ) : (
        <FamilyTodo items={tasks} today={today} showTeam={multipleTeams} className="mt-5" />
      )}
    </div>
  );
}
