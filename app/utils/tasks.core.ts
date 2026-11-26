// Task rules, shared by the app and the MCP server (mcp/roster-import.ts).
// Every function takes the database as an argument and this file only uses
// relative imports, because the MCP server builds its own client.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "../db/schema";
import { MAX_TASK_DETAILS, MAX_TASK_TITLE, cleanLink } from "./tasks";

const { contacts, players, taskAssignments, tasks } = schema;

export type TasksDb = LibSQLDatabase<typeof schema>;

const now = () => new Date().toISOString();

// Tasks given to everyone also cover players added after the task was made.
// Fills in any missing rows; safe to run on every read.
// Goes through drizzle's insert, not raw SQL, so each row gets its id (ids are
// made in the app; see utils/ids.ts).
export async function ensureAssignments(db: TasksDb, teamId: string) {
  const missing = await db.all<{ taskId: string; playerId: string }>(sql`
    select t.id as taskId, p.id as playerId
    from tasks t join players p on p.team_id = t.team_id
    where t.team_id = ${teamId} and t.assign_all = 1
      and not exists (select 1 from task_assignments a where a.task_id = t.id and a.player_id = p.id)
  `);
  if (missing.length === 0) return;
  await db
    .insert(taskAssignments)
    .values(missing.map((m) => ({ taskId: m.taskId, teamId, playerId: m.playerId })))
    .onConflictDoNothing({ target: [taskAssignments.taskId, taskAssignments.playerId] });
}

// Siblings for "one per family" tasks: players on the team who share a
// contact email with any of these players. One hop, so in a blended family a
// check reaches the kids listed under the same email, not every relative of
// every relative. The given players are always included.
export async function siblingIds(db: TasksDb, teamId: string, playerIds: string[]) {
  const ids = new Set(playerIds);
  if (playerIds.length === 0) return ids;
  const emails = await db
    .selectDistinct({ email: sql<string>`lower(trim(${contacts.email}))` })
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), inArray(contacts.playerId, playerIds)));
  if (emails.length === 0) return ids;
  const rows = await db
    .selectDistinct({ playerId: players.id })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(
      eq(contacts.teamId, teamId),
      eq(players.teamId, teamId),
      inArray(sql`lower(trim(${contacts.email}))`, emails.map((e) => e.email))
    ));
  for (const r of rows) ids.add(r.playerId);
  return ids;
}

async function getTask(db: TasksDb, teamId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)))
    .limit(1);
  return task ?? null;
}

// The players a check applies to: siblings too on per-family tasks, and only
// players this task is actually given to
async function targets(db: TasksDb, task: schema.Task, playerIds: string[]) {
  const ids = task.perFamily ? [...(await siblingIds(db, task.teamId, playerIds))] : playerIds;
  if (ids.length === 0) return [];
  const rows = await db
    .select({ playerId: taskAssignments.playerId })
    .from(taskAssignments)
    .where(and(eq(taskAssignments.taskId, task.id), inArray(taskAssignments.playerId, ids)));
  return rows.map((r) => r.playerId);
}

export type TaskInput = {
  title: string;
  details?: string | null;
  link?: string | null;
  dueDate?: string | null;
  perFamily?: boolean;
  coachConfirms?: boolean;
};

export function cleanTaskInput(input: TaskInput): { ok: true; value: Required<TaskInput> } | { ok: false; error: string } {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, error: "Give the task a title" };
  if (title.length > MAX_TASK_TITLE) return { ok: false, error: `Keep the title under ${MAX_TASK_TITLE} characters` };
  const details = input.details?.trim() || null;
  if (details && details.length > MAX_TASK_DETAILS) return { ok: false, error: `Keep the details under ${MAX_TASK_DETAILS} characters` };
  const link = input.link?.trim() ? cleanLink(input.link) : null;
  if (input.link?.trim() && !link) return { ok: false, error: "That link doesn't look like a web address" };
  const dueDate = input.dueDate?.trim() || null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, error: "Use a date like 2026-12-01" };
  return {
    ok: true,
    value: { title, details, link, dueDate, perFamily: Boolean(input.perFamily), coachConfirms: Boolean(input.coachConfirms) },
  };
}

// Creates a task for everyone on the team ("all") or for chosen players
export async function createTask(
  db: TasksDb,
  { teamId, createdBy, input, playerIds }: { teamId: string; createdBy: string | null; input: TaskInput; playerIds: string[] | "all" }
) {
  const clean = cleanTaskInput(input);
  if (!clean.ok) return clean;
  const assignAll = playerIds === "all";
  const chosen = assignAll ? [] : await teamPlayerIds(db, teamId, playerIds);
  if (!assignAll && chosen.length === 0) return { ok: false as const, error: "Pick at least one player" };

  const [task] = await db
    .insert(tasks)
    .values({ teamId, createdBy, assignAll, ...clean.value })
    .returning();
  if (assignAll) await ensureAssignments(db, teamId);
  else await assignPlayers(db, task, chosen);
  return { ok: true as const, task };
}

export async function updateTask(db: TasksDb, teamId: string, taskId: string, input: TaskInput) {
  const clean = cleanTaskInput(input);
  if (!clean.ok) return clean;
  const [task] = await db
    .update(tasks)
    .set({ ...clean.value, updatedAt: now() })
    .where(and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)))
    .returning();
  return task ? { ok: true as const, task } : { ok: false as const, error: "Task not found" };
}

// Only players on this team
async function teamPlayerIds(db: TasksDb, teamId: string, playerIds: string[]) {
  if (playerIds.length === 0) return [];
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.teamId, teamId), inArray(players.id, playerIds)));
  return rows.map((r) => r.id);
}

export async function assignPlayers(db: TasksDb, task: schema.Task, playerIds: string[]) {
  const ids = await teamPlayerIds(db, task.teamId, playerIds);
  if (ids.length === 0) return 0;
  const rows = await db
    .insert(taskAssignments)
    .values(ids.map((playerId) => ({ taskId: task.id, teamId: task.teamId, playerId })))
    .onConflictDoNothing()
    .returning({ id: taskAssignments.id });
  return rows.length;
}

// Taking players off a task that was given to everyone turns it into a task
// for the players left, so they don't come straight back on the next read
export async function unassignPlayers(db: TasksDb, teamId: string, taskId: string, playerIds: string[]) {
  const task = await getTask(db, teamId, taskId);
  if (!task || playerIds.length === 0) return 0;
  if (task.assignAll) await db.update(tasks).set({ assignAll: false, updatedAt: now() }).where(eq(tasks.id, task.id));
  const rows = await db
    .delete(taskAssignments)
    .where(and(eq(taskAssignments.taskId, task.id), inArray(taskAssignments.playerId, playerIds)))
    .returning({ id: taskAssignments.id });
  return rows.length;
}

export async function deleteTask(db: TasksDb, teamId: string, taskId: string) {
  const task = await getTask(db, teamId, taskId);
  if (!task) return false;
  await db.batch([
    db.delete(taskAssignments).where(eq(taskAssignments.taskId, task.id)),
    db.delete(tasks).where(eq(tasks.id, task.id)),
  ]);
  return true;
}

// The family's checkmark. Unchecking leaves anything a coach has confirmed.
export async function setFamilyDone(
  db: TasksDb,
  {
    teamId,
    taskId,
    playerIds,
    done,
    by = null,
    via,
    at,
  }: { teamId: string; taskId: string; playerIds: string[]; done: boolean; by?: string | null; via: "app" | "link" | "import"; at?: string }
) {
  const task = await getTask(db, teamId, taskId);
  if (!task) return { task: null, playerIds: [] as string[] };
  const ids = await targets(db, task, playerIds);
  if (ids.length === 0) return { task, playerIds: ids };
  const scope = and(eq(taskAssignments.taskId, task.id), inArray(taskAssignments.playerId, ids));
  if (done) {
    await db
      .update(taskAssignments)
      .set({ familyDoneAt: at ?? now(), familyDoneBy: by, familyDoneVia: via })
      .where(and(scope, isNull(taskAssignments.familyDoneAt)));
  } else {
    await db
      .update(taskAssignments)
      .set({ familyDoneAt: null, familyDoneBy: null, familyDoneVia: null })
      .where(and(scope, isNull(taskAssignments.confirmedAt)));
  }
  return { task, playerIds: ids };
}

// The coach's checkmark. Confirming fills in the family side too; taking it
// back also clears the family side when only the coach had checked it.
export async function setConfirmed(
  db: TasksDb,
  {
    teamId,
    taskId,
    playerIds,
    confirmed,
    by = null,
    at,
  }: { teamId: string; taskId: string; playerIds: string[]; confirmed: boolean; by?: string | null; at?: string }
) {
  const task = await getTask(db, teamId, taskId);
  if (!task) return { task: null, playerIds: [] as string[] };
  const ids = await targets(db, task, playerIds);
  if (ids.length === 0) return { task, playerIds: ids };
  const scope = and(eq(taskAssignments.taskId, task.id), inArray(taskAssignments.playerId, ids));
  const when = at ?? now();
  if (confirmed) {
    await db.batch([
      db.update(taskAssignments)
        .set({ familyDoneAt: when, familyDoneVia: "coach" })
        .where(and(scope, isNull(taskAssignments.familyDoneAt))),
      db.update(taskAssignments)
        .set({ confirmedAt: when, confirmedBy: by })
        .where(and(scope, isNull(taskAssignments.confirmedAt))),
    ]);
  } else {
    await db.batch([
      db.update(taskAssignments)
        .set({ familyDoneAt: null, familyDoneBy: null, familyDoneVia: null })
        .where(and(scope, eq(taskAssignments.familyDoneVia, "coach"))),
      db.update(taskAssignments).set({ confirmedAt: null, confirmedBy: null }).where(scope),
    ]);
  }
  return { task, playerIds: ids };
}

export async function setNote(db: TasksDb, teamId: string, taskId: string, playerId: string, note: string | null) {
  const task = await getTask(db, teamId, taskId);
  if (!task) return false;
  await db
    .update(taskAssignments)
    .set({ note: note?.trim().slice(0, 500) || null })
    .where(and(eq(taskAssignments.taskId, task.id), eq(taskAssignments.playerId, playerId)));
  return true;
}
