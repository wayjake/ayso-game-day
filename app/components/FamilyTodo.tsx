import { useState } from "react";
import { useFetcher } from "react-router";
import { ArrowSquareOut, Check, CheckCircle, Circle, Clock, ListChecks } from "@phosphor-icons/react";
import { Badge, Card, buttonClass, cx } from "~/components/ui";
import { dueLabel, type TaskState } from "~/utils/tasks";

// A family's tasks: what's still open, with a button to check each one off.
// Used in the family app and on the no-login /todo link.

export type FamilyTodoItem = {
  taskId: number;
  teamName: string;
  title: string;
  details: string | null;
  link: string | null;
  dueDate: string | null;
  coachConfirms: boolean;
  state: TaskState;
  confirmed: boolean; // A coach checked it; the family can't undo that
  playerIds: number[];
  kidNames: string[];
};

export function FamilyTodo({
  items,
  today,
  showTeam = false,
  className,
}: {
  items: FamilyTodoItem[];
  today: string;
  showTeam?: boolean;
  className?: string;
}) {
  const [showDone, setShowDone] = useState(false);
  const pending = items.filter((i) => i.state !== "done");
  const done = items.filter((i) => i.state === "done");
  const open = items.filter((i) => i.state === "open").length;
  if (items.length === 0) return null;

  return (
    <Card className={cx("overflow-hidden", className)} aria-labelledby="todo-heading">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <ListChecks size={20} weight="bold" />
        </span>
        <h2 id="todo-heading" className="min-w-0 flex-1 font-semibold">
          {open > 0 ? "To do" : "All caught up"}
        </h2>
        {open > 0 && <Badge tone="warning">{open} open</Badge>}
      </div>
      {pending.length === 0 && (
        <p className="px-4 pb-3 text-sm text-muted">Everything the coaches asked for is done. Thanks!</p>
      )}
      <ul className="divide-y divide-line">
        {pending.map((item) => (
          <TodoRow key={`${item.taskId}-${item.playerIds.join(",")}`} item={item} today={today} showTeam={showTeam} />
        ))}
        {showDone && done.map((item) => (
          <TodoRow key={`${item.taskId}-${item.playerIds.join(",")}`} item={item} today={today} showTeam={showTeam} />
        ))}
      </ul>
      {done.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="w-full border-t border-line px-4 py-2.5 text-left text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          aria-expanded={showDone}
        >
          {showDone ? "Hide done" : `Show ${done.length} done`}
        </button>
      )}
    </Card>
  );
}

function TodoRow({ item, today, showTeam }: { item: FamilyTodoItem; today: string; showTeam: boolean }) {
  const fetcher = useFetcher<{ error?: string }>();
  const due = dueLabel(item.dueDate, today);

  // Show the tap straight away
  let state = item.state;
  if (fetcher.formData) {
    const done = fetcher.formData.get("done") === "1";
    state = done ? (item.coachConfirms ? "waiting" : "done") : "open";
  }
  // Families can take back their own check, never a coach's confirmation
  const canUndo = state !== "open" && !item.confirmed;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0">
        {state === "done" ? (
          <CheckCircle size={22} weight="fill" className="text-success" />
        ) : state === "waiting" ? (
          <Clock size={22} weight="fill" className="text-warning" />
        ) : (
          <Circle size={22} className="text-line-strong" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx("font-semibold leading-snug", state === "done" && "text-muted line-through decoration-line-strong")}>{item.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {item.kidNames.length > 0 && <span>{item.kidNames.join(" & ")}</span>}
          {showTeam && <span>· {item.teamName}</span>}
          {due && state === "open" && <Badge tone={due.overdue ? "danger" : "neutral"}>{due.text}</Badge>}
          {state === "waiting" && <span className="text-warning">Waiting for the coach to confirm</span>}
        </div>
        {item.details && state !== "done" && <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{item.details}</p>}
        {item.link && state !== "done" && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-coarse:min-h-11 mt-1.5 inline-flex max-w-full items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ArrowSquareOut size={15} className="shrink-0" />
            <span className="truncate">{linkLabel(item.link)}</span>
          </a>
        )}
        {fetcher.data?.error && <p className="mt-1 text-sm text-danger">{fetcher.data.error}</p>}
      </div>
      {(state === "open" || canUndo) && (
        <fetcher.Form method="post" className="shrink-0">
          <input type="hidden" name="_action" value="task" />
          <input type="hidden" name="taskId" value={item.taskId} />
          {item.playerIds.map((id) => (
            <input key={id} type="hidden" name="playerId" value={id} />
          ))}
          <input type="hidden" name="done" value={state === "open" ? "1" : "0"} />
          {state === "open" ? (
            <button type="submit" className={buttonClass({ size: "sm" })}>
              <Check size={16} weight="bold" />
              Done
            </button>
          ) : (
            <button type="submit" className="h-9 px-2 text-sm font-medium text-muted hover:text-ink">
              Undo
            </button>
          )}
        </fetcher.Form>
      )}
    </li>
  );
}

function linkLabel(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}
