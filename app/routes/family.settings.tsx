import type { Route } from "./+types/family.settings";
import { data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { accountAction } from "~/utils/account.server";
import { calendarLinks, getOrCreateCalendarToken } from "~/utils/calendar-feed.server";
import { db, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";
import { CalendarCard, LogOutButton, NotificationsCard, ProfileCard } from "~/components/AccountSettings";
import { addFamilyMember, familyHouseholds, inviteFamilyMember, removeFamilyMember } from "~/utils/family-household.server";
import { FamilyMembersCard } from "~/components/FamilyMembers";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  return data({
    me: { id: user.id, name: user.name, email: user.email },
    kids,
    households: await householdsFor(user.id, kids),
    calendar: calendarLinks(request, await getOrCreateCalendarToken(user.id)),
    // The feed is per person, so a coach's also has the teams they coach
    alsoCoach: (await db.select({ id: teams.id }).from(teams).where(canAccessTeam(user.id)).limit(1)).length > 0,
  });
}

// One per team, with the kids' photos from the parent's own links
async function householdsFor(userId: string, kids: Awaited<ReturnType<typeof requireParent>>["kids"]) {
  const teams = [...new Map(kids.map((k) => [k.teamId, { teamId: k.teamId, teamName: k.teamName }])).values()];
  const byId = new Map(kids.map((k) => [k.playerId, k]));
  return (await familyHouseholds(userId, teams)).map((h) => ({
    ...h,
    kids: h.kids.map((k) => {
      const mine = byId.get(k.id);
      return { ...k, profilePicture: mine?.profilePicture ?? null, jerseyNumber: mine?.jerseyNumber ?? null };
    }),
  }));
}

export async function action({ request }: Route.ActionArgs) {
  const { user, teamIds } = await requireParent(request);
  const formData = await request.formData();
  // Your family: add, invite or remove a parent or guardian on one of your teams
  const household = String(formData.get("_action") ?? "");
  if (household === "addFamilyMember" || household === "inviteFamilyMember" || household === "removeFamilyMember") {
    const teamId = String(formData.get("teamId") ?? "");
    if (!teamIds.includes(teamId)) return data({ ok: false as const, error: "You're not on that team." }, { status: 404 });
    const email = String(formData.get("email") ?? "");
    const result =
      household === "addFamilyMember"
        ? await addFamilyMember(request, user, teamId, { name: String(formData.get("name") ?? ""), email })
        : household === "inviteFamilyMember"
          ? await inviteFamilyMember(request, user, teamId, email)
          : await removeFamilyMember(user, teamId, email);
    return data(result, { status: result.ok ? 200 : 400 });
  }
  // Not the sending address here; that's a coach setting
  const intent = formData.get("_action");
  if (intent !== "updateName" && intent !== "resetCalendar") return data({ intent: "", error: "Unknown action" }, { status: 400 });
  const handled = await accountAction(user, formData);
  return data(handled!.result, { status: handled!.status });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings - BenchTalk" }];
}

export default function FamilySettings({ loaderData, actionData }: Route.ComponentProps) {
  const { me, kids, households } = loaderData;
  // Household changes go through a fetcher on their own card; these are the account forms'
  const account = actionData && "intent" in actionData ? actionData : null;

  return (
    <div className="space-y-5 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>

      <ProfileCard me={me} nameHint="Shown to the coaches and the team next to your messages." result={account} />

      <NotificationsCard />

      <CalendarCard
        links={loaderData.calendar}
        covers={
          loaderData.alsoCoach
            ? "your players' games and practices, and those of the teams you coach,"
            : kids.length > 1
              ? "your players' games and practices"
              : `${kids[0].name.split(" ")[0]}'s games and practices`
        }
        result={account}
      />

      {households.map((h) => (
        <FamilyMembersCard key={h.teamId} household={h} showTeam={households.length > 1} />
      ))}

      <LogOutButton />
    </div>
  );
}
