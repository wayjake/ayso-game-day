import type { Route } from "./+types/team.tasks.detail";
import { useState } from "react";
import { Form, Link, data, redirect, useFetcher, useNavigation, useSearchParams } from "react-router";
import { db } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getTaskDetail, type TaskDetailRow } from "~/utils/tasks.server";
import { assignPlayers, deleteTask, setConfirmed, setNote, unassignPlayers } from "~/utils/tasks.core";
import { formatMessageTime, todayISO } from "~/utils/dates";
import { taskState } from "~/utils/tasks";
import { Badge, Button, Card, Page, PageHeader, buttonClass, cx, inputClass } from "~/components/ui";
import { PlayerPicker, StatusMark, TaskMeta, statusText } from "~/components/tasks";
import { ArrowSquareOut, Check, NotePencil, PencilSimple, Trash, UserMinus, UserPlus, X } from "@phosphor-icons/react";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.task.title ?? "Task"} - BenchTalk` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const detail = await getTaskDetail(team.id, Number(params.taskId));
  if (!detail) throw new Response("Task not found", { status: 404 });
  return data({ teamId: team.id, today: todayISO(), ...detail });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const taskId = Number(params.taskId);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const playerIds = formData.getAll("playerId").map(Number).filter(Boolean);

  switch (intent) {
    case "confirm":
    case "unconfirm": {
      const { task } = await setConfirmed(db, { teamId: team.id, taskId, playerIds, confirmed: intent === "confirm", by: user.id });
      if (!task) throw new Response("Task not found", { status: 404 });
      return data({ ok: true, cleared: true });
    }
    case "note":
      await setNote(db, team.id, taskId, playerIds[0], String(formData.get("note") ?? ""));
      return data({ ok: true });
    case "assign": {
      const detail = await getTaskDetail(team.id, taskId);
      if (!detail) throw new Response("Task not found", { status: 404 });
      await assignPlayers(db, detail.task, playerIds);
      return data({ ok: true, cleared: true });
    }
    case "unassign":
      await unassignPlayers(db, team.id, taskId, playerIds);
      return data({ ok: true, cleared: true });
    case "delete":
      await deleteTask(db, team.id, taskId);
      return redirect(`/dashboard/team/${team.id}/tasks`);
    default:
      return data({ error: "Unknown action" }, { status: 400 });
  }
}

type Filter = "confirm" | "open" | "done" | "all";

export default function TaskDetail({ loaderData }: Route.ComponentProps) {
  const { teamId, today, task, summary, rows, unassigned } = loaderData;
  const base = `/dashboard/team/${teamId}`;
  const [params] = useSearchParams();
  const filter = (params.get("filter") as Filter) || (summary.waiting > 0 ? "confirm" : "all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const bulk = useFetcher<{ cleared?: boolean }>();
  const navigation = useNavigation();

  const chips: { value: Filter; label: string; count: number; hidden?: boolean }[] = [
    { value: "confirm", label: "To confirm", count: summary.waiting, hidden: !task.coachConfirms && summary.waiting === 0 },
    { value: "open", label: "Not done", count: summary.open },
    { value: "done", label: "Done", count: summary.done },
    { value: "all", label: "All", count: summary.assigned },
  ];
  const shown = rows.filter((r) =>
    filter === "confirm" ? r.cell.state === "waiting"
    : filter === "open" ? r.cell.state === "open"
    : filter === "done" ? r.cell.state === "done"
    : true
  );
  const pct = summary.assigned ? Math.round((summary.done / summary.assigned) * 100) : 0;

  const pick = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const bulkSubmit = (intent: string) => {
    const form = new FormData();
    form.set("_action", intent);
    for (const id of selected) form.append("playerId", String(id));
    bulk.submit(form, { method: "post" });
    setSelected(new Set());
  };

  return (
    <Page width="narrow" className="pb-28">
      <PageHeader
        back={{ to: `${base}/tasks`, label: "Tasks" }}
        title={task.title}
        actions={
          <Link to={`${base}/tasks/${task.id}/edit`} className={buttonClass({ variant: "secondary" })}>
            <PencilSimple size={18} />
            Edit
          </Link>
        }
      />

      <Card className="mb-4 p-5">
        <TaskMeta dueDate={task.dueDate} today={today} perFamily={task.perFamily} coachConfirms={task.coachConfirms} />
        {task.details && <p className="mt-3 whitespace-pre-wrap text-sm">{task.details}</p>}
        {task.link && (
          <a href={task.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowSquareOut size={16} className="shrink-0" />
            <span className="truncate">{task.link}</span>
          </a>
        )}
        <div className="mt-4 mb-2 flex items-baseline justify-between gap-3">
          <p className="font-semibold">
            <span className="tabular">{summary.done}</span> of <span className="tabular">{summary.assigned}</span> done
          </p>
          <span className="text-sm text-muted tabular">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {task.assignAll ? "Everyone on the roster, including players added later." : `${summary.assigned} picked ${summary.assigned === 1 ? "player" : "players"}.`}
          {task.perFamily && " Checking it for one kid checks it for their siblings."}
        </p>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Filter players">
        {chips.filter((c) => !c.hidden).map((c) => (
          <Link
            key={c.value}
            to={`?filter=${c.value}`}
            role="tab"
            aria-selected={filter === c.value}
            preventScrollReset
            replace
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition",
              filter === c.value ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:bg-surface-2",
              c.value === "confirm" && c.count > 0 && filter !== c.value && "text-warning ring-warning/50"
            )}
          >
            {c.label}
            <span className={cx("tabular", filter === c.value ? "text-white/70" : "text-muted")}>{c.count}</span>
          </Link>
        ))}
      </div>

      <Card className="divide-y divide-line overflow-hidden">
        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {filter === "confirm" ? "Nothing waiting for a coach." : filter === "open" ? "Everyone has done it." : "No players here."}
          </p>
        ) : (
          shown.map((r) => (
            <PlayerRow key={r.playerId} row={r} coachConfirms={task.coachConfirms} selected={selected.has(r.playerId)} onSelect={(on) => pick(r.playerId, on)} />
          ))
        )}
      </Card>

      {unassigned.length > 0 && <AddPlayers players={unassigned} />}

      <div className="mt-8 border-t border-line pt-6">
        {deleting ? (
          <Form method="post" className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft p-3">
            <input type="hidden" name="_action" value="delete" />
            <p className="min-w-0 flex-1 text-sm font-medium text-danger">Delete this task and everyone's checkmarks? This can't be undone.</p>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button type="submit" variant="danger" size="sm" disabled={navigation.state !== "idle"}>Delete task</Button>
          </Form>
        ) : (
          <Button variant="danger-soft" size="sm" onClick={() => setDeleting(true)}>
            <Trash size={16} />
            Delete task
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-safe pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-semibold">
              {selected.size} selected
              <button type="button" onClick={() => setSelected(new Set())} className="ml-2 font-medium text-muted hover:text-ink">Clear</button>
            </span>
            <Button size="sm" variant="ghost" onClick={() => bulkSubmit("unassign")} disabled={bulk.state !== "idle"}>
              <UserMinus size={16} />
              Remove from task
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulkSubmit("unconfirm")} disabled={bulk.state !== "idle"}>
              <X size={16} weight="bold" />
              Take back
            </Button>
            <Button size="sm" onClick={() => bulkSubmit("confirm")} disabled={bulk.state !== "idle"}>
              <Check size={16} weight="bold" />
              Confirm {selected.size}
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}

function PlayerRow({ row: r, coachConfirms, selected, onSelect }: { row: TaskDetailRow; coachConfirms: boolean; selected: boolean; onSelect: (on: boolean) => void }) {
  const toggle = useFetcher();
  const note = useFetcher();
  const [editing, setEditing] = useState(false);

  let confirmed = r.cell.confirmed;
  let state = r.cell.state;
  if (toggle.formData) {
    // Show the tap straight away, using the same rule as the server
    confirmed = toggle.formData.get("_action") === "confirm";
    const familyDoneAt = confirmed ? (r.cell.familyDoneAt ?? "now") : r.cell.familyDoneVia === "coach" ? null : r.cell.familyDoneAt;
    state = taskState({ coachConfirms }, { familyDoneAt, familyDoneVia: null, confirmedAt: confirmed ? "now" : null });
  }

  const family = r.cell.familyDoneAt && r.cell.familyDoneVia !== "coach"
    ? `${r.cell.familyDoneVia === "import" ? "Marked done in the import" : `Done by ${r.familyDoneBy ?? "the family"}${r.cell.familyDoneVia === "link" ? " (email link)" : ""}`} · ${formatMessageTime(r.cell.familyDoneAt)}`
    : null;
  const coach = r.cell.confirmedAt ? `Confirmed${r.confirmedBy ? ` by ${r.confirmedBy}` : ""} · ${formatMessageTime(r.cell.confirmedAt)}` : null;

  return (
    <div className={cx("flex items-start gap-3 px-4 py-3", selected && "bg-primary-soft")}>
      {/* The whole left strip of the row, edge to edge and top to bottom, is the checkbox's target */}
      <label className="-my-3 -ml-4 flex shrink-0 cursor-pointer self-stretch py-3 pr-1 pl-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${r.name}`}
          className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusMark state={state} confirmed={confirmed} size={18} />
          <p className="truncate font-semibold">{r.name}</p>
        </div>
        {r.family && <p className="mt-0.5 truncate text-xs text-muted">{r.family}</p>}
        <p className="mt-0.5 text-xs text-muted">
          {[family, coach].filter(Boolean).join(" · ") || statusText(state, confirmed, r.cell.familyDoneVia)}
        </p>
        {editing ? (
          <note.Form method="post" className="mt-2 flex gap-2" onSubmit={() => setEditing(false)}>
            <input type="hidden" name="_action" value="note" />
            <input type="hidden" name="playerId" value={r.playerId} />
            <label htmlFor={`note-${r.playerId}`} className="sr-only">Note</label>
            <input
              id={`note-${r.playerId}`}
              name="note"
              defaultValue={r.note ?? ""}
              maxLength={500}
              autoFocus
              placeholder="Paid cash at practice"
              className={cx(inputClass, "h-9 text-[16px] sm:text-sm")}
            />
            <Button type="submit" size="sm" variant="secondary">Save</Button>
          </note.Form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="mt-1 flex items-center gap-1 text-left text-xs font-medium text-muted hover:text-ink">
            <NotePencil size={14} className="shrink-0" />
            {(note.formData ? String(note.formData.get("note") ?? "") : r.note) || "Add a note"}
          </button>
        )}
      </div>
      <toggle.Form method="post" className="shrink-0">
        <input type="hidden" name="_action" value={confirmed ? "unconfirm" : "confirm"} />
        <input type="hidden" name="playerId" value={r.playerId} />
        <Button type="submit" size="sm" variant={confirmed ? "ghost" : state === "waiting" ? "primary" : "secondary"}>
          {confirmed ? (
            <>
              <X size={16} weight="bold" />
              <span className="hidden sm:inline">Take back</span>
            </>
          ) : (
            <>
              <Check size={16} weight="bold" />
              Confirm
            </>
          )}
        </Button>
      </toggle.Form>
    </div>
  );
}

function AddPlayers({ players }: { players: { id: number; name: string }[] }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const fetcher = useFetcher();
  return (
    <details className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <UserPlus size={16} />
        Add players
        <Badge>{players.length} not on this task</Badge>
      </summary>
      <fetcher.Form method="post" onSubmit={() => setPicked(new Set())}>
        <input type="hidden" name="_action" value="assign" />
        <PlayerPicker players={players} picked={picked} onChange={setPicked} />
        <div className="mt-3 flex justify-end">
          <Button type="submit" size="sm" disabled={picked.size === 0 || fetcher.state !== "idle"}>
            Add {picked.size || ""}
          </Button>
        </div>
      </fetcher.Form>
    </details>
  );
}

