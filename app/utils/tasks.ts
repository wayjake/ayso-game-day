// Tasks: shared types and rules safe for the browser. Database work is in
// tasks.core.ts (shared with the MCP server) and tasks.server.ts.

export const MAX_TASK_TITLE = 120;
export const MAX_TASK_DETAILS = 2000;

export type TaskFlags = { coachConfirms: boolean };

export type AssignmentFields = {
  familyDoneAt: string | null;
  familyDoneVia: "app" | "link" | "coach" | "import" | null;
  confirmedAt: string | null;
};

// open: nothing yet. waiting: the family checked it and it needs a coach to
// confirm. done: counts as finished.
export type TaskState = "open" | "waiting" | "done";

export function taskState(task: TaskFlags, a: AssignmentFields): TaskState {
  if (a.confirmedAt) return "done";
  if (!a.familyDoneAt) return "open";
  return task.coachConfirms ? "waiting" : "done";
}

// A "pay by" date reads better without the year when it's this year
export function dueLabel(dueDate: string | null, today: string) {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
  const text = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
  return { text: `Due ${text}`, overdue: dueDate < today };
}

// Only http(s) links are kept, so a task can't carry a javascript: URL
export function cleanLink(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
