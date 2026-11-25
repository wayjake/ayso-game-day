import type { Route } from "./+types/team.tasks";
import { Link, data, redirect, useFetcher } from "react-router";
import { db } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getTaskBoard, type BoardFamily, type Cell, type TaskSummary } from "~/utils/tasks.server";
import { setConfirmed } from "~/utils/tasks.core";
import { listFamilies } from "~/utils/parent-invites.server";
import { getOrCreateFamilyConversation } from "~/utils/messages.server";
import { todayISO } from "~/utils/dates";
import { taskState } from "~/utils/tasks";
import { Badge, Card, EmptyState, Page, PageHeader, buttonClass, cx } from "~/components/ui";
import { StatusMark, TaskMeta, statusText } from "~/components/tasks";
import { ChatCircleText, CheckSquareOffset, Plus } from "@phosphor-icons/react";

export function meta() {
  return [{ title: "Tasks - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const board = await getTaskBoard(team.id);
  return data({ teamId: team.id, today: todayISO(), ...board });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "confirm") {
    await setConfirmed(db, {
      teamId: team.id,
      taskId: Number(formData.get("taskId")),
      playerIds: [Number(formData.get("playerId"))],
      confirmed: formData.get("value") === "1",
      by: user.id,
    });
    return data({ ok: true });
  }

  // Open the family's thread with their open tasks drafted in the box
  if (intent === "message") {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const family = (await listFamilies(null, team.id)).find((f) => f.email === email);
    if (!family) return data({ error: "That family isn't on this team" }, { status: 400 });
    const conversation = await getOrCreateFamilyConversation(team.id, family.email, family.userIds[0]);
    return redirect(`/dashboard/team/${team.id}/messages/${conversation.id}?draft=tasks`);
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  const { teamId, today, tasks, families, playerCount } = loaderData;
  const base = `/dashboard/team/${teamId}`;
  const newTask = (
    <Link to={`${base}/tasks/new`} className={buttonClass()}>
      <Plus size={18} weight="bold" />
      New task
    </Link>
  );

  return (
    <Page>
      <PageHeader
        back={{ to: `${base}/roster`, label: "Roster" }}
        title="Tasks"
        description="Fees, forms and anything else families need to do, and who has done it."
        actions={tasks.length > 0 && newTask}
      />

      {tasks.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckSquareOffset size={24} />} title="No tasks yet" action={newTask}>
            Families see each task in the app and check it off. You see who has and hasn't, and can confirm it yourself.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} to={`${base}/tasks/${t.id}`} today={today} />
            ))}
          </ul>

          {playerCount > 0 && <Board tasks={tasks} families={families} base={base} />}
        </div>
      )}
    </Page>
  );
}

function TaskCard({ task, to, today }: { task: TaskSummary; to: string; today: string }) {
  const pct = task.assigned ? Math.round((task.done / task.assigned) * 100) : 0;
  return (
    <li>
      <Link to={to} className="block h-full rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line transition hover:ring-line-strong">
        <p className="line-clamp-2 font-semibold">{task.title}</p>
        <div className="mt-1.5">
          <TaskMeta dueDate={task.dueDate} today={today} perFamily={task.perFamily} coachConfirms={task.coachConfirms} />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>
            <span className="font-semibold text-ink tabular">{task.done}</span> of <span className="tabular">{task.assigned}</span> done
          </span>
          {task.waiting > 0 && (
            <Badge tone="warning">
              {task.waiting} to confirm
            </Badge>
          )}
        </p>
      </Link>
    </li>
  );
}

function Board({ tasks, families, base }: { tasks: TaskSummary[]; families: BoardFamily[]; base: string }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold">By family</h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="sticky left-0 z-10 min-w-40 bg-surface px-4 py-3 text-left font-semibold">
                  Player
                </th>
                {tasks.map((t) => (
                  <th key={t.id} scope="col" className="px-2 py-3 text-center align-bottom font-semibold">
                    <Link to={`${base}/tasks/${t.id}`} className="mx-auto line-clamp-2 block w-24 text-xs leading-tight hover:text-primary" title={t.title}>
                      {t.title}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            {families.map((f) => (
              <tbody key={f.key} className="border-b border-line last:border-b-0">
                <tr className="bg-surface-2/60">
                  <td colSpan={tasks.length + 1} className="px-4 py-2">
                    <FamilyHeader family={f} />
                  </td>
                </tr>
                {f.players.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">
                      {p.name}
                      {p.jerseyNumber != null && <span className="ml-1.5 text-xs text-subtle tabular">#{p.jerseyNumber}</span>}
                    </th>
                    {tasks.map((t) => (
                      <td key={t.id} className="px-2 py-1 text-center">
                        <BoardCell task={t} playerId={p.id} playerName={p.name} cell={p.cells[t.id] ?? null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend state="open" label="Not done" />
        <Legend state="waiting" label="Waiting for a coach to confirm" />
        <Legend state="done" label="Done by the family" />
        <Legend state="done" confirmed label="Confirmed by a coach" />
        <span>Tap a mark to confirm it, or tap again to take it back.</span>
      </p>
    </section>
  );
}

function Legend({ state, confirmed, label }: { state: "open" | "waiting" | "done"; confirmed?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <StatusMark state={state} confirmed={confirmed} size={14} />
      {label}
    </span>
  );
}

function FamilyHeader({ family }: { family: BoardFamily }) {
  const message = useFetcher();
  const parents = family.parents.filter((p) => p.open > 0);
  return (
    // Pinned to the left so the Message button stays in view when the grid scrolls sideways
    <div className="sticky left-4 flex w-max max-w-[calc(100vw-4rem)] flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-0 truncate text-xs text-muted">
        {family.parents.length ? family.parents.map((p) => p.name).join(" · ") : "No parent contact"}
      </span>
      {family.open > 0 && <Badge tone="neutral">{family.open} open</Badge>}
      {family.waiting > 0 && <Badge tone="warning">{family.waiting} to confirm</Badge>}
      {family.open === 0 && family.waiting === 0 && <Badge tone="success">All done</Badge>}
      {parents.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {parents.map((p) => (
            <message.Form method="post" key={p.email}>
              <input type="hidden" name="_action" value="message" />
              <input type="hidden" name="email" value={p.email} />
              <button
                type="submit"
                disabled={message.state !== "idle"}
                className={buttonClass({ variant: "secondary", size: "sm", className: "h-8 bg-surface" })}
                title={`Message ${p.name} with their ${p.open} open ${p.open === 1 ? "task" : "tasks"} drafted`}
              >
                <ChatCircleText size={16} />
                {parents.length > 1 ? `Message ${p.name.split(" ")[0]}` : "Message"}
              </button>
            </message.Form>
          ))}
        </span>
      )}
    </div>
  );
}

function BoardCell({ task, playerId, playerName, cell }: { task: TaskSummary; playerId: number; playerName: string; cell: Cell | null }) {
  const fetcher = useFetcher();
  if (!cell) return <StatusMark state={null} />;

  // Show the tap straight away
  let shown = cell;
  if (fetcher.formData) {
    const confirmed = fetcher.formData.get("value") === "1";
    const familyDoneAt = confirmed ? (cell.familyDoneAt ?? "now") : cell.familyDoneVia === "coach" ? null : cell.familyDoneAt;
    const via = confirmed ? (cell.familyDoneVia ?? "coach") : cell.familyDoneVia === "coach" ? null : cell.familyDoneVia;
    const confirmedAt = confirmed ? "now" : null;
    shown = { familyDoneAt, familyDoneVia: via, confirmedAt, confirmed, state: taskState(task, { familyDoneAt, familyDoneVia: via, confirmedAt }) };
  }
  const label = `${playerName}, ${task.title}: ${statusText(shown.state, shown.confirmed, shown.familyDoneVia)}. ${shown.confirmed ? "Tap to take back the confirmation." : "Tap to confirm."}`;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="_action" value="confirm" />
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="value" value={shown.confirmed ? "0" : "1"} />
      <button
        type="submit"
        aria-label={label}
        title={label}
        className={cx("mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-surface-2", fetcher.state !== "idle" && "opacity-70")}
      >
        <StatusMark state={shown.state} confirmed={shown.confirmed} />
      </button>
    </fetcher.Form>
  );
}
