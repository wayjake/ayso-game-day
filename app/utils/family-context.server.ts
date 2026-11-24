import { addDays, todayISO } from "~/utils/dates";
import { listFamilies, type Family, type FamilyStatus } from "~/utils/parent-invites.server";
import { usersWithPush } from "~/utils/messages.server";
import { familyAnnouncements, familyLabel, familyNotesView } from "~/utils/announcements.server";
import { getEvents, getRsvps } from "~/utils/schedule.server";
import type { RsvpStatus } from "~/utils/schedule";

// Everything a coach wants beside a family's thread: who they are, how a
// message reaches them, their kids' RSVPs for what's coming up, how they
// responded to recent announcements, and the coaches' private notes.
// Coach-only: callers check team access first.

export type FamilyReach = "push" | "app" | "email";

export type FamilyContextView = {
  email: string;
  label: string;
  parentNames: string[];
  kids: { id: number; name: string; linked: boolean }[];
  status: FamilyStatus;
  inviteUrl: string | null;
  reach: FamilyReach;
  upcoming: {
    key: string;
    type: "game" | "practice";
    id: number;
    title: string;
    date: string;
    time: string | null;
    answers: { playerId: number; name: string; status: RsvpStatus | null }[];
  }[];
  announcements: Awaited<ReturnType<typeof familyAnnouncements>>;
  notesEmail: string; // Notes are keyed by this email (a thread's own email can differ from the contact email)
  notes: Awaited<ReturnType<typeof familyNotesView>>;
};

// A thread's family: the one holding the parent's account first (their login
// email can differ from the contact email), then by email
export function findFamily(families: Family[], { email, parentUserId }: { email?: string | null; parentUserId?: number | null }) {
  return (
    (parentUserId ? families.find((f) => f.userIds.includes(parentUserId)) : undefined) ??
    (email ? families.find((f) => f.email === email.toLowerCase()) : undefined) ??
    null
  );
}

export async function getFamilyContext(teamId: number, family: Family, notesEmail = family.email): Promise<FamilyContextView> {
  const today = todayISO();
  const kidIds = family.kids.map((k) => k.id);

  const [withPush, events, answers, announcements, notes] = await Promise.all([
    usersWithPush(family.userIds),
    getEvents([teamId], { from: today, to: addDays(today, 13) }),
    kidIds.length ? getRsvps([teamId], kidIds) : Promise.resolve([]),
    familyAnnouncements(teamId, family.email),
    familyNotesView(teamId, notesEmail),
  ]);

  const upcoming = events
    .filter((e) => !e.cancelled)
    .slice(0, 3)
    .map((e) => ({
      key: e.key,
      type: e.type,
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      answers: family.kids.map((k) => ({
        playerId: k.id,
        name: k.name.split(" ")[0],
        status: answers.find((a) => a.playerId === k.id && a.eventType === e.type && a.eventId === e.id)?.status ?? null,
      })),
    }));

  return {
    email: family.email,
    label: familyLabel(family),
    parentNames: family.parentNames,
    kids: family.kids,
    status: family.status,
    inviteUrl: family.inviteUrl,
    reach: family.status !== "joined" ? "email" : withPush.size > 0 ? "push" : "app",
    upcoming,
    announcements,
    notesEmail,
    notes,
  };
}

// For the team chat: who it reaches and who it doesn't yet
export async function getTeamChatContext(teamId: number) {
  const families = await listFamilies(null, teamId);
  return {
    total: families.length,
    joined: families.filter((f) => f.status === "joined").length,
    notJoined: families.filter((f) => f.status !== "joined").map((f) => ({ email: f.email, label: familyLabel(f), status: f.status })),
  };
}

export type TeamChatContextView = Awaited<ReturnType<typeof getTeamChatContext>>;
