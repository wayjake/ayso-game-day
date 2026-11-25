import type { Route } from "./+types/dashboard.account";
import { data } from "react-router";
import { and, desc, eq } from "drizzle-orm";
import { db, teams } from "~/db";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { getLastTeamId } from "~/utils/last-team.server";
import { coachFromAddress, isOnSendingDomain, sendingDomain } from "~/utils/email.server";
import { accountAction } from "~/utils/account.server";
import { calendarLinks, getOrCreateCalendarToken } from "~/utils/calendar-feed.server";
import { isParent } from "~/utils/family.server";
import { CalendarCard, LogOutButton, NotificationsCard, ProfileCard, SendingEmailCard } from "~/components/AccountSettings";
import { Page, PageHeader } from "~/components/ui";

// A coach's own settings, whichever team they're on: name, notifications,
// sending address. Team settings keep only what belongs to the team.

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  // The team they were last on, for the back link and the example reply address
  const lastTeamId = await getLastTeamId(request);
  const [lastTeam] = lastTeamId
    ? await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(and(eq(teams.id, lastTeamId), canAccessTeam(user.id)))
        .limit(1)
    : [];
  const [team] = lastTeam
    ? [lastTeam]
    : await db.select({ id: teams.id, name: teams.name }).from(teams).where(canAccessTeam(user.id)).orderBy(desc(teams.createdAt)).limit(1);

  const ownAddress = Boolean(user.sendingEmail && isOnSendingDomain(user.sendingEmail));
  return data({
    me: { id: user.id, name: user.name, email: user.email, sendingEmail: user.sendingEmail, isAdmin: user.role === "admin" },
    fromHeader: coachFromAddress(user, team ?? null).header,
    fromTeamName: ownAddress ? null : (team?.name ?? null),
    sendingDomain: sendingDomain(),
    calendar: calendarLinks(request, await getOrCreateCalendarToken(user.id)),
    alsoParent: await isParent(user.id),
    back: team ? { to: `/dashboard/team/${team.id}`, label: team.name } : { to: "/dashboard/teams", label: "Teams" },
  });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request);
  const handled = await accountAction(user, await request.formData());
  if (!handled) return data({ intent: "", error: "Unknown action" }, { status: 400 });
  return data(handled.result, { status: handled.status });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Account - BenchTalk" }];
}

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { me, back } = loaderData;
  return (
    <Page width="narrow" className="space-y-6">
      <PageHeader title="Account" description="Your name, notifications, calendar and email address, on every team." back={back} />
      <ProfileCard
        me={me}
        nameHint="Printed on game cards and shown to families next to your messages."
        result={actionData}
      />
      <NotificationsCard />
      <CalendarCard
        links={loaderData.calendar}
        covers={`the games and practices of every team you coach${loaderData.alsoParent ? " and your kids' teams" : ""}`}
        result={actionData}
      />
      <SendingEmailCard
        me={me}
        fromHeader={loaderData.fromHeader}
        teamName={loaderData.fromTeamName}
        sendingDomain={loaderData.sendingDomain}
        result={actionData}
      />
      <LogOutButton />
    </Page>
  );
}
