import crypto from "node:crypto";
import { db, contacts, players, taskAssignments, tasks, teams, users, type Task } from "~/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { listFamilies, type Family } from "~/utils/parent-invites.server";
import { MAX_MESSAGE_LENGTH } from "~/utils/messages.server";
import { ensureAssignments } from "~/utils/tasks.core";
import { dueLabel, taskState, type TaskState } from "~/utils/tasks";
import { todayISO } from "~/utils/dates";

// Tasks as the app shows them. The rules for changing them are in
// tasks.core.ts, shared with the MCP server.

export type TaskSummary = Pick<Task, "id" | "title" | "details" | "link" | "dueDate" | "perFamily" | "coachConfirms" | "assignAll"> & {
  assigned: number;
  done: number;
  waiting: number;
  open: number;
};

export type Cell = {
  state: TaskState;
  confirmed: boolean;
  familyDoneAt: string | null;
  familyDoneVia: "app" | "link" | "coach" | "import" | null;
  confirmedAt: string | null;
};

export type BoardPlayer = { id: number; name: string; jerseyNumber: number | null; cells: Record<number, Cell> };

// Players grouped by the emails they share, so siblings sit together and the
// coach can message each parent address
export type BoardFamily = {
  key: string;
  players: BoardPlayer[];
  parents: { email: string; name: string; onApp: boolean; open: number }[];
  open: number; // Tasks the family still has to do (per-family tasks once)
  waiting: number; // Done by the family, waiting for a coach to confirm
};

function summarize(task: Task, rows: (typeof taskAssignments.$inferSelect)[]): TaskSummary {
  const states = rows.map((r) => taskState(task, r));
  return {
    id: task.id,
    title: task.title,
    details: task.details,
    link: task.link,
    dueDate: task.dueDate,
    perFamily: task.perFamily,
    coachConfirms: task.coachConfirms,
    assignAll: task.assignAll,
    assigned: rows.length,
    done: states.filter((s) => s === "done").length,
    waiting: states.filter((s) => s === "waiting").length,
    open: states.filter((s) => s === "open").length,
  };
}

const cellFor = (task: Task, a: typeof taskAssignments.$inferSelect): Cell => ({
  state: taskState(task, a),
  confirmed: Boolean(a.confirmedAt),
  familyDoneAt: a.familyDoneAt,
  familyDoneVia: a.familyDoneVia,
  confirmedAt: a.confirmedAt,
});

async function teamTasks(teamId: number) {
  await ensureAssignments(db, teamId);
  const list = await db.select().from(tasks).where(eq(tasks.teamId, teamId)).orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id));
  const rows = list.length
    ? await db.select().from(taskAssignments).where(eq(taskAssignments.teamId, teamId))
    : [];
  return { list, rows };
}

// Tasks in a state for a set of players, counting a per-family task once
function countIn(list: Task[], rows: (typeof taskAssignments.$inferSelect)[], playerIds: Set<number>, state: TaskState = "open") {
  let count = 0;
  for (const task of list) {
    const mine = rows.filter((r) => r.taskId === task.id && playerIds.has(r.playerId) && taskState(task, r) === state);
    count += task.perFamily ? Math.min(mine.length, 1) : mine.length;
  }
  return count;
}

export async function getTaskBoard(teamId: number) {
  const { list, rows } = await teamTasks(teamId);
  const roster = await db
    .select({ id: players.id, name: players.name, jerseyNumber: players.jerseyNumber })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);
  const families = await listFamilies(null, teamId);

  const byTask = new Map(list.map((t) => [t.id, t]));
  const boardPlayers = new Map<number, BoardPlayer>(
    roster.map((p) => [p.id, { ...p, cells: {} as Record<number, Cell> }])
  );
  for (const r of rows) {
    const task = byTask.get(r.taskId);
    const player = boardPlayers.get(r.playerId);
    if (task && player) player.cells[task.id] = cellFor(task, r);
  }

  // Players who share any parent email end up in one group
  const parent = new Map<number, number>(roster.map((p) => [p.id, p.id]));
  const find = (id: number): number => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const f of families) {
    const ids = f.kids.map((k) => k.id).filter((id) => parent.has(id));
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
  }
  const groups = new Map<number, BoardPlayer[]>();
  for (const p of roster) {
    const root = find(p.id);
    groups.set(root, [...(groups.get(root) ?? []), boardPlayers.get(p.id)!]);
  }

  const result: BoardFamily[] = [...groups.values()].map((members) => {
    const ids = new Set(members.map((m) => m.id));
    const parents = families
      .filter((f) => f.kids.some((k) => ids.has(k.id)))
      .map((f) => ({
        email: f.email,
        name: f.parentNames[0] ?? f.email,
        onApp: f.status === "joined",
        open: countIn(list, rows, new Set(f.kids.map((k) => k.id))),
      }));
    return {
      key: members.map((m) => m.id).join("-"),
      players: members,
      parents,
      open: countIn(list, rows, ids),
      waiting: countIn(list, rows, ids, "waiting"),
    };
  });

  const summaries = list.map((t) => summarize(t, rows.filter((r) => r.taskId === t.id && boardPlayers.has(r.playerId))));
  return { tasks: summaries, families: result, playerCount: roster.length };
}

// Waiting on a coach, across the team: the badge on the Tasks button
export async function countTasksToConfirm(teamId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(taskAssignments)
    .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
    .where(and(
      eq(taskAssignments.teamId, teamId),
      eq(tasks.coachConfirms, true),
      sql`${taskAssignments.familyDoneAt} is not null and ${taskAssignments.confirmedAt} is null`
    ));
  return Number(row?.n ?? 0);
}

export type TaskDetailRow = {
  playerId: number;
  name: string;
  jerseyNumber: number | null;
  family: string; // "Garcia (Mia)" for the parents listed on this player
  cell: Cell;
  familyDoneBy: string | null;
  confirmedBy: string | null;
  note: string | null;
};

export async function getTaskDetail(teamId: number, taskId: number) {
  await ensureAssignments(db, teamId);
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.teamId, teamId))).limit(1);
  if (!task) return null;

  const rows = await db
    .select({ a: taskAssignments, name: players.name, jerseyNumber: players.jerseyNumber })
    .from(taskAssignments)
    .innerJoin(players, eq(taskAssignments.playerId, players.id))
    .where(and(eq(taskAssignments.taskId, task.id), eq(players.teamId, teamId)))
    .orderBy(players.name);

  const userIds = [...new Set(rows.flatMap((r) => [r.a.familyDoneBy, r.a.confirmedBy]).filter((id): id is number => id != null))];
  const names = userIds.length
    ? new Map(
        (await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => [
          u.id,
          u.name?.trim() || u.email.split("@")[0],
        ])
      )
    : new Map<number, string>();

  const families = await listFamilies(null, teamId);
  const familyFor = (playerId: number) =>
    families.filter((f) => f.kids.some((k) => k.id === playerId)).map((f) => f.parentNames[0] ?? f.email).join(", ");

  const detail: TaskDetailRow[] = rows.map((r) => ({
    playerId: r.a.playerId,
    name: r.name,
    jerseyNumber: r.jerseyNumber,
    family: familyFor(r.a.playerId),
    cell: cellFor(task, r.a),
    familyDoneBy: r.a.familyDoneBy ? (names.get(r.a.familyDoneBy) ?? null) : null,
    confirmedBy: r.a.confirmedBy ? (names.get(r.a.confirmedBy) ?? null) : null,
    note: r.a.note,
  }));

  const assigned = new Set(detail.map((d) => d.playerId));
  const unassigned = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name)
    .then((all) => all.filter((p) => !assigned.has(p.id)));

  return { task, summary: summarize(task, rows.map((r) => r.a)), rows: detail, unassigned };
}

// ---------------------------------------------------------------------------
// Families

export type FamilyTask = {
  taskId: number;
  teamId: number;
  teamName: string;
  title: string;
  details: string | null;
  link: string | null;
  dueDate: string | null;
  coachConfirms: boolean;
  state: TaskState;
  confirmed: boolean;
  playerIds: number[];
  kidNames: string[]; // First names; empty when it covers every kid shown
};

// What a family has been asked to do, for these players. A per-family task
// shows once for all of them. Never includes coach notes.
export async function familyTasks(kids: { playerId: number; name: string; teamId: number }[]): Promise<FamilyTask[]> {
  if (kids.length === 0) return [];
  const teamIds = [...new Set(kids.map((k) => k.teamId))];
  for (const teamId of teamIds) await ensureAssignments(db, teamId);

  const rows = await db
    .select({
      taskId: tasks.id,
      teamId: tasks.teamId,
      teamName: teams.name,
      title: tasks.title,
      details: tasks.details,
      link: tasks.link,
      dueDate: tasks.dueDate,
      perFamily: tasks.perFamily,
      coachConfirms: tasks.coachConfirms,
      playerId: taskAssignments.playerId,
      familyDoneAt: taskAssignments.familyDoneAt,
      familyDoneVia: taskAssignments.familyDoneVia,
      confirmedAt: taskAssignments.confirmedAt,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
    .innerJoin(teams, eq(tasks.teamId, teams.id))
    .where(inArray(taskAssignments.playerId, kids.map((k) => k.playerId)))
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id));

  const firstName = new Map(kids.map((k) => [k.playerId, k.name.split(" ")[0]]));
  const kidsOnTeam = (teamId: number) => kids.filter((k) => k.teamId === teamId).length;
  const order: TaskState[] = ["open", "waiting", "done"];

  const items: FamilyTask[] = [];
  for (const r of rows) {
    const state = taskState(r, r);
    const existing = r.perFamily ? items.find((i) => i.taskId === r.taskId) : undefined;
    if (existing) {
      existing.playerIds.push(r.playerId);
      existing.kidNames.push(firstName.get(r.playerId)!);
      // Siblings move together, but if they ever differ show the least finished
      if (order.indexOf(state) < order.indexOf(existing.state)) existing.state = state;
      existing.confirmed &&= Boolean(r.confirmedAt);
      continue;
    }
    items.push({
      taskId: r.taskId,
      teamId: r.teamId,
      teamName: r.teamName,
      title: r.title,
      details: r.details,
      link: r.link,
      dueDate: r.dueDate,
      coachConfirms: r.coachConfirms,
      state,
      confirmed: Boolean(r.confirmedAt),
      playerIds: [r.playerId],
      kidNames: [firstName.get(r.playerId)!],
    });
  }
  // Name the kids only when an item is for some of them, not all
  for (const item of items) {
    if (item.playerIds.length === kidsOnTeam(item.teamId)) item.kidNames = [];
  }
  return items;
}

// Players on the team listed under this email
async function kidsForEmail(teamId: number, email: string) {
  return db
    .selectDistinct({ playerId: players.id, name: players.name, teamId: players.teamId })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(eq(contacts.teamId, teamId), eq(players.teamId, teamId), sql`lower(trim(${contacts.email})) = ${email.trim().toLowerCase()}`))
    .orderBy(players.name);
}

// ---------------------------------------------------------------------------
// Link for families who aren't on the app: one per family email per team,
// signed rather than stored. Holds no email, only the team and a signature
// the server matches against the team's families.

function secret() {
  return process.env.SESSION_SECRET || "dev-secret-change-in-production";
}

function signature(teamId: number, email: string) {
  return crypto.createHmac("sha256", secret()).update(`tasks:${teamId}:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 24);
}

export function familyTaskToken(teamId: number, email: string) {
  return `${teamId}-${signature(teamId, email)}`;
}

export async function findFamilyByTaskToken(token: string): Promise<{ teamId: number; teamName: string; family: Family } | null> {
  const match = /^(\d+)-([A-Za-z0-9_-]{24})$/.exec(token);
  if (!match) return null;
  const teamId = Number(match[1]);
  const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return null;
  const given = Buffer.from(match[2]);
  for (const family of await listFamilies(null, teamId)) {
    const expected = Buffer.from(signature(teamId, family.email));
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) {
      return { teamId, teamName: team.name, family };
    }
  }
  return null;
}

export async function tasksForTokenFamily(teamId: number, family: Family) {
  return familyTasks(family.kids.map((k) => ({ playerId: k.id, name: k.name, teamId })));
}

// ---------------------------------------------------------------------------
// Message draft: what this family still has to do, ready for the coach to
// edit and send in their thread

function appOrigin(request: Request) {
  return process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export async function taskDraftFor(request: Request, teamId: number, email: string, onApp: boolean) {
  const kids = await kidsForEmail(teamId, email);
  if (kids.length === 0) return null;
  const open = (await familyTasks(kids)).filter((t) => t.state === "open");
  if (open.length === 0) return null;

  const families = await listFamilies(null, teamId);
  const family = families.find((f) => f.email === email.trim().toLowerCase());
  const parentFirst = family?.parentNames[0]?.trim().split(/\s+/)[0];
  const kidNames = kids.map((k) => k.name.split(" ")[0]);
  const today = todayISO();
  const link = onApp ? `${appOrigin(request)}/family` : `${appOrigin(request)}/todo/${familyTaskToken(teamId, email)}`;

  const line = (t: FamilyTask) => {
    const who = kids.length > 1 && t.kidNames.length > 0 && t.kidNames.length < kids.length ? ` (${t.kidNames.join(", ")})` : "";
    const due = dueLabel(t.dueDate, today);
    return `• ${t.title}${who}${due ? `, ${due.text.replace(/^Due/, due.overdue ? "was due" : "due")}` : ""}${t.link ? `\n  ${t.link}` : ""}`;
  };

  // Lines name the kid when it isn't all of them, so the heading only names a lone kid
  const head = `Hi${parentFirst ? ` ${parentFirst}` : ""}! A quick checklist from the coaches. Still to do${kidNames.length === 1 ? ` for ${kidNames[0]}` : ""}:`;
  const tail = `You can mark each one done here: ${link}`;
  // Stay under the message limit: drop lines from the end and say how many are left
  const lines = open.map(line);
  let shown = lines.length;
  const build = (n: number) =>
    [head, "", ...lines.slice(0, n), ...(n < lines.length ? [`…and ${lines.length - n} more`] : []), "", tail].join("\n");
  while (shown > 1 && build(shown).length > MAX_MESSAGE_LENGTH) shown--;
  return build(shown).slice(0, MAX_MESSAGE_LENGTH);
}


