import type { Route } from "./+types/family.settings";
import { data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { accountAction } from "~/utils/account.server";
import { calendarLinks, getOrCreateCalendarToken } from "~/utils/calendar-feed.server";
import { db, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";
import { CalendarCard, LogOutButton, NotificationsCard, ProfileCard } from "~/components/AccountSettings";
import { Card, CardHeader, PlayerAvatar } from "~/components/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  return data({
    me: { id: user.id, name: user.name, email: user.email },
    kids,
    calendar: calendarLinks(request, await getOrCreateCalendarToken(user.id)),
    // The feed is per person, so a coach's also has the teams they coach
    alsoCoach: (await db.select({ id: teams.id }).from(teams).where(canAccessTeam(user.id)).limit(1)).length > 0,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireParent(request);
  const formData = await request.formData();
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
  const { me, kids } = loaderData;

  return (
    <div className="space-y-5 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>

      <ProfileCard me={me} nameHint="Shown to the coaches and the team next to your messages." result={actionData} />

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
        result={actionData}
      />

      <Card className="p-5">
        <CardHeader title="Your players" count={kids.length} className="mb-3" />
        <ul className="space-y-2">
          {kids.map((kid) => (
            <li key={kid.playerId} className="flex items-center gap-3">
              <PlayerAvatar player={kid} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{kid.name}</span>
                <span className="block truncate text-xs text-muted">{kid.teamName}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">Missing someone? Ask their coach to invite this email address.</p>
      </Card>

      <LogOutButton />
    </div>
  );
}
