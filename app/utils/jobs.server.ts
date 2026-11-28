import { and, eq, inArray, sql } from "drizzle-orm";
import { contacts, db, eventJobSignups, eventJobs, players, teams, type EventJob } from "~/db";
import { newId } from "~/utils/ids";
import { getCoachUserIds, getParentUserIds, getParentUserIdsForPlayers, getUserNames } from "~/utils/family.server";
import { sendPush } from "~/utils/push.server";
import { eventDayPhrase, eventPhrase, type ScheduleEvent } from "~/utils/schedule";
import { teamPath } from "~/utils/team-path";
import { familyLabel, firstName, timingPhrase, type JobFields, type JobHolder, type JobView } from "~/utils/jobs";

// Jobs on events: snacks, setting up and taking down the goals. Each spot is
// covered by one family (stored as one of its kids) or one staff member.
// Families see who has what; only staff see the record across the season
// (team.jobs.tsx). Nothing here ranks families or works out whose turn it is.

export type TeamFamily = { key: string; label: string; playerIds: string[] };

// Each player's family on the team: the kids who share a contact email with
// them (one hop, like per-family tasks), named by the kids' first names.
export async function teamFamilies(teamIds: string[]) {
  const byPlayer = new Map<string, TeamFamily>();
  if (teamIds.length === 0) return byPlayer;
  const roster = await db.select({ id: players.id, name: players.name, teamId: players.teamId }).from(players).where(inArray(players.teamId, teamIds));
  const emails = await db
    .select({ playerId: contacts.playerId, email: sql<string>`lower(trim(${contacts.email}))` })
    .from(contacts)
    .where(and(inArray(contacts.teamId, teamIds), sql`${contacts.playerId} is not null`, sql`trim(coalesce(${contacts.email}, '')) <> ''`));

  const emailsOf = new Map<string, Set<string>>();
  for (const e of emails) {
    if (!e.playerId) continue;
    emailsOf.set(e.playerId, (emailsOf.get(e.playerId) ?? new Set()).add(e.email));
  }
  for (const p of roster) {
    const mine = emailsOf.get(p.id) ?? new Set<string>();
    const kids = roster
      .filter((o) => o.id === p.id || (o.teamId === p.teamId && [...(emailsOf.get(o.id) ?? [])].some((e) => mine.has(e))))
      .sort((a, b) => a.name.localeCompare(b.name));
    byPlayer.set(p.id, { key: kids.map((k) => k.id).sort().join(","), label: familyLabel(kids.map((k) => firstName(k.name))), playerIds: kids.map((k) => k.id) });
  }
  return byPlayer;
}

const eventKey = (type: string, id: string) => `${type}-${id}`;

// Every job on these teams' events, keyed "game-<id>" / "practice-<id>", with who covers each
export async function jobsByEvent(teamIds: string[], families?: Map<string, TeamFamily>) {
  const out: Record<string, JobView[]> = {};
  if (teamIds.length === 0) return out;
  const jobs = await db.select().from(eventJobs).where(inArray(eventJobs.teamId, teamIds)).orderBy(eventJobs.id);
  if (jobs.length === 0) return out;
  const signups = await db.select().from(eventJobSignups).where(inArray(eventJobSignups.jobId, jobs.map((j) => j.id))).orderBy(eventJobSignups.id);
  const fams = families ?? (await teamFamilies(teamIds));
  const names = await getUserNames([...new Set(signups.map((s) => s.userId).filter((id): id is string => !!id))]);

  for (const job of jobs) {
    const holders: JobHolder[] = signups
      .filter((s) => s.jobId === job.id)
      .map((s) => ({
        signupId: s.id,
        kind: s.playerId ? "family" : "staff",
        label: s.playerId ? fams.get(s.playerId)?.label ?? "A family" : names.get(s.userId ?? "") ?? "Staff",
        playerId: s.playerId,
        userId: s.userId,
      }));
    (out[eventKey(job.eventType, job.eventId)] ??= []).push({
      id: job.id,
      eventType: job.eventType,
      eventId: job.eventId,
      title: job.title,
      details: job.details,
      timing: job.timing,
      mode: job.mode,
      spots: job.spots,
      holders,
    });
  }
  return out;
}

export async function getJob(teamId: string, jobId: string | null) {
  if (!jobId) return null;
  const [job] = await db.select().from(eventJobs).where(and(eq(eventJobs.id, jobId), eq(eventJobs.teamId, teamId))).limit(1);
  return job ?? null;
}

export async function getSignup(signupId: string | null) {
  if (!signupId) return null;
  const [row] = await db
    .select({ signup: eventJobSignups, job: eventJobs })
    .from(eventJobSignups)
    .innerJoin(eventJobs, eq(eventJobSignups.jobId, eventJobs.id))
    .where(eq(eventJobSignups.id, signupId))
    .limit(1);
  return row ?? null;
}

export async function addJob(teamId: string, event: { type: "game" | "practice"; id: string }, values: JobFields, by: string) {
  await db.insert(eventJobs).values({ teamId, eventType: event.type, eventId: event.id, ...values, createdBy: by });
}

export async function updateJob(job: EventJob, values: JobFields) {
  await db.update(eventJobs).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(eventJobs.id, job.id));
}

export async function deleteJob(job: EventJob) {
  await db.batch([db.delete(eventJobSignups).where(eq(eventJobSignups.jobId, job.id)), db.delete(eventJobs).where(eq(eventJobs.id, job.id))]);
}

// Jobs go with the practices they're on (practices.server.ts deletePractices)
export async function deleteJobsForEvents(teamId: string, eventType: "game" | "practice", eventIds: string[]) {
  if (eventIds.length === 0) return;
  const jobs = await db
    .select({ id: eventJobs.id })
    .from(eventJobs)
    .where(and(eq(eventJobs.teamId, teamId), eq(eventJobs.eventType, eventType), inArray(eventJobs.eventId, eventIds)));
  if (jobs.length === 0) return;
  const ids = jobs.map((j) => j.id);
  await db.batch([db.delete(eventJobSignups).where(inArray(eventJobSignups.jobId, ids)), db.delete(eventJobs).where(inArray(eventJobs.id, ids))]);
}

// Puts a family (any of its kids) or a staff member on a job, in one
// statement so two people can't take the last spot, and a family with
// siblings can't take two. Returns false when it's full or they're already on.
export async function takeSpot(job: EventJob, who: { family: TeamFamily; playerId: string } | { userId: string }, by: string | null, via: "app" | "coach") {
  const id = newId();
  const playerId = "family" in who ? who.playerId : null;
  const userId = "userId" in who ? who.userId : null;
  const already =
    "family" in who
      ? sql`player_id in (${sql.join(who.family.playerIds.map((p) => sql`${p}`), sql`, `)})`
      : sql`user_id = ${userId}`;
  try {
    const result = await db.run(sql`
      insert into event_job_signups (id, job_id, team_id, player_id, user_id, signed_up_by, via)
      select ${id}, ${job.id}, ${job.teamId}, ${playerId}, ${userId}, ${by}, ${via}
      where (select count(*) from event_job_signups where job_id = ${job.id}) < (select spots from event_jobs where id = ${job.id})
        and not exists (select 1 from event_job_signups where job_id = ${job.id} and ${already})`);
    return result.rowsAffected > 0;
  } catch {
    return false; // Lost a race on the unique index
  }
}

export async function releaseSpot(signupId: string) {
  await db.delete(eventJobSignups).where(eq(eventJobSignups.id, signupId));
}

const jobPhrase = (job: { title: string; timing: JobView["timing"] }, event: ScheduleEvent) =>
  `${job.title} for ${eventPhrase(event)} ${eventDayPhrase(event.date)}${job.timing ? ` (${timingPhrase(job.timing, event.type)})` : ""}`;

// Tells the people on a job, now: the family's parents on the app and any staff on it
export async function remindHolders(job: EventJob, event: ScheduleEvent, families: Map<string, TeamFamily>) {
  const signups = await db.select().from(eventJobSignups).where(eq(eventJobSignups.jobId, job.id));
  const kidIds = signups.flatMap((s) => (s.playerId ? families.get(s.playerId)?.playerIds ?? [s.playerId] : []));
  const parents = await getParentUserIdsForPlayers(kidIds);
  const staff = signups.map((s) => s.userId).filter((id): id is string => !!id);
  const body = `You're on ${jobPhrase(job, event)}.`;
  await sendPush(parents, "team", { title: `Reminder: ${job.title}`, body, url: "/family", tag: `job-${job.id}` });
  if (staff.length > 0) {
    const code = await teamCode(job.teamId);
    await sendPush(staff, "team", { title: `Reminder: ${job.title}`, body, url: teamPath(code, `rsvps/${event.type}/${event.id}`), tag: `job-${job.id}` });
  }
  return parents.length + staff.length;
}

// Asks every family on the app who isn't on it yet to take an open spot
export async function askForVolunteers(job: EventJob, event: ScheduleEvent, families: Map<string, TeamFamily>) {
  const signups = await db.select().from(eventJobSignups).where(eq(eventJobSignups.jobId, job.id));
  const left = Math.max(0, job.spots - signups.length);
  if (left === 0) return 0;
  const onIt = new Set(signups.flatMap((s) => (s.playerId ? families.get(s.playerId)?.playerIds ?? [s.playerId] : [])));
  const already = new Set(await getParentUserIdsForPlayers([...onIt]));
  const parents = (await getParentUserIds(job.teamId)).filter((id) => !already.has(id));
  await sendPush(parents, "team", {
    title: `Can you help with ${job.title.toLowerCase()}?`,
    body: `${jobPhrase(job, event)} needs ${left === 1 ? "one more family" : `${left} more families`}. Tap to sign up.`,
    url: "/family",
    tag: `job-${job.id}`,
  });
  return parents.length;
}

// Staff hear when a family gives a job back, so someone can cover it
export async function alertJobGivenBack(job: EventJob, event: ScheduleEvent, label: string, exclude: string) {
  const staff = (await getCoachUserIds(job.teamId)).filter((id) => id !== exclude);
  await sendPush(staff, "dropouts", {
    title: `${label} can't do ${job.title.toLowerCase()}`,
    body: `${jobPhrase(job, event)} needs someone.`,
    url: teamPath(await teamCode(job.teamId), `rsvps/${event.type}/${event.id}`),
    tag: `job-${job.id}`,
  });
}

// Tells a family staff put them on a job
export async function alertAssigned(job: EventJob, event: ScheduleEvent, family: TeamFamily) {
  await sendPush(await getParentUserIdsForPlayers(family.playerIds), "team", {
    title: `You're on ${job.title.toLowerCase()}`,
    body: `${jobPhrase(job, event)}. Can't do it? Give it back on the schedule.`,
    url: "/family",
    tag: `job-${job.id}`,
  });
}

async function teamCode(teamId: string) {
  const [team] = await db.select({ code: teams.code }).from(teams).where(eq(teams.id, teamId)).limit(1);
  return team.code;
}

