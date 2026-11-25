import type { Route } from "./+types/todo";
import { Link, data } from "react-router";
import { db } from "~/db";
import { findFamilyByTaskToken, tasksForTokenFamily } from "~/utils/tasks.server";
import { setFamilyDone } from "~/utils/tasks.core";
import { todayISO } from "~/utils/dates";
import { AppMark } from "~/components/AppMark";
import { FamilyTodo } from "~/components/FamilyTodo";
import { Card } from "~/components/ui";
import { LinkBreak } from "@phosphor-icons/react";

// A family's tasks without signing in, for families not on the app yet. The
// link comes from a coach's message (Tasks > Message). Opening it only shows
// the list; checking something off takes a POST, so mail scanners that fetch
// every link can't do it for the family. Coach notes are never shown here.

export function meta({}: Route.MetaArgs) {
  return [{ title: "To do - BenchTalk" }, { name: "robots", content: "noindex" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const found = await findFamilyByTaskToken(params.token);
  if (!found) return data({ found: false as const });
  return data({
    found: true as const,
    teamName: found.teamName,
    kids: found.family.kids.map((k) => k.name.split(" ")[0]),
    tasks: await tasksForTokenFamily(found.teamId, found.family),
    today: todayISO(),
  });
}

export async function action({ params, request }: Route.ActionArgs) {
  const found = await findFamilyByTaskToken(params.token);
  if (!found) return data({ error: "This link doesn't work" }, { status: 404 });
  const formData = await request.formData();
  if (formData.get("_action") !== "task") return data({ error: "Unknown action" }, { status: 400 });

  // Only this family's kids
  const allowed = new Set(found.family.kids.map((k) => k.id));
  const playerIds = formData.getAll("playerId").map(Number);
  if (playerIds.length === 0 || playerIds.some((id) => !allowed.has(id))) {
    return data({ error: "Can't update that task" }, { status: 400 });
  }
  const result = await setFamilyDone(db, {
    teamId: found.teamId,
    taskId: Number(formData.get("taskId")),
    playerIds,
    done: formData.get("done") === "1",
    via: "link",
  });
  if (!result.task || result.playerIds.length === 0) return data({ error: "That task isn't there anymore" }, { status: 400 });
  return data({ ok: true });
}

export default function Todo({ loaderData }: Route.ComponentProps) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <AppMark />
        </div>
        {!loaderData.found ? (
          <Card className="p-6 text-center sm:p-8">
            <LinkBreak size={32} className="mx-auto mb-3 text-muted" />
            <h1 className="text-lg font-semibold">This link doesn't work</h1>
            <p className="mt-1 text-sm text-muted">It may have been copied wrong. You can reply to the coach's message instead.</p>
          </Card>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{loaderData.teamName}</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
              For {loaderData.kids.join(" & ")}
            </h1>
            <p className="mt-1 text-sm text-muted">Tap Done on each one when it's taken care of. The coaches see it right away.</p>
            {loaderData.tasks.length === 0 ? (
              <Card className="mt-5 p-6 text-center text-sm text-muted">Nothing to do right now.</Card>
            ) : (
              <FamilyTodo items={loaderData.tasks} today={loaderData.today} className="mt-5" />
            )}
            <p className="mt-6 text-center text-sm text-muted">
              Want the schedule and messages too?{" "}
              <Link to="/user/magic-link" className="font-medium text-primary hover:underline">Get the app</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
