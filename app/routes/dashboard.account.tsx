import type { Route } from "./+types/dashboard.account";
import { Form, Link, data, useNavigation } from "react-router";
import { useState } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db, teams } from "~/db";
import { getUser } from "~/utils/auth.server";
import { activeTeams, canAccessTeam } from "~/utils/team-access.server";
import { getLastTeamId } from "~/utils/last-team.server";
import { coachFromAddress, isOnSendingDomain, sendingDomain } from "~/utils/email.server";
import { accountAction, type AccountResult } from "~/utils/account.server";
import { isEmailConfigured } from "~/utils/email.server";
import { inviteStaff, setTeamArchived } from "~/utils/staff-invites.server";
import { parseStaffRole } from "~/utils/team-roles";
import { StaffInviteForm } from "~/components/StaffInviteForm";
import { calendarLinks, getOrCreateCalendarToken } from "~/utils/calendar-feed.server";
import { isParent } from "~/utils/family.server";
import { CalendarCard, LogOutButton, NotificationsCard, ProfileCard, SendingEmailCard } from "~/components/AccountSettings";
import { Alert, Badge, Button, Card, CardHeader, Page, PageHeader } from "~/components/ui";
import { Archive, ArrowCounterClockwise, CaretRight } from "@phosphor-icons/react";

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
    : await db.select({ id: teams.id, name: teams.name }).from(teams).where(and(canAccessTeam(user.id), activeTeams())).orderBy(desc(teams.createdAt)).limit(1);

  // Every team they're on, archived ones too: archive or bring back the ones they own
  const myTeams = await db
    .select({ id: teams.id, name: teams.name, format: teams.format, season: teams.season, coachId: teams.coachId, archivedAt: teams.archivedAt })
    .from(teams)
    .where(canAccessTeam(user.id))
    .orderBy(desc(teams.createdAt));

  const ownAddress = Boolean(user.sendingEmail && isOnSendingDomain(user.sendingEmail));
  return data({
    me: { id: user.id, name: user.name, email: user.email, sendingEmail: user.sendingEmail, isAdmin: user.role === "admin" },
    fromHeader: coachFromAddress(user, team ?? null).header,
    fromTeamName: ownAddress ? null : (team?.name ?? null),
    sendingDomain: sendingDomain(),
    calendar: calendarLinks(request, await getOrCreateCalendarToken(user.id)),
    alsoParent: await isParent(user.id),
    back: team ? { to: `/dashboard/team/${team.id}`, label: team.name } : { to: "/dashboard/teams", label: "Teams" },
    teams: myTeams.map(({ coachId, ...t }) => ({ ...t, owner: coachId === user.id })),
    emailConfigured: isEmailConfigured(),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  // Archive or bring back a team you own, from here instead of inside each team
  if (intent === "archive" || intent === "unarchive") {
    const ok = await setTeamArchived(Number(formData.get("teamId")), user.id, intent === "archive");
    if (!ok) return data({ intent: "teams", error: "Only a team's owner can archive it" }, { status: 403 });
    return data({ intent: "teams", success: intent === "archive" ? "Archived. It's out of your team list and switcher." : "Back in your team list and switcher." });
  }

  // Invite someone to the staff of any of the teams you own, in one go
  if (intent === "invite") {
    const result = await inviteStaff({
      request,
      user,
      email: String(formData.get("email") ?? ""),
      role: parseStaffRole(formData.get("role")) ?? "coach",
      teamIds: formData.getAll("teamIds").map(Number).filter(Boolean),
    });
    if ("error" in result) return data({ intent: "invite", error: result.error }, { status: 400 });
    return data({ intent: "invite", invite: result.invite });
  }

  const handled = await accountAction(user, formData);
  if (!handled) return data({ intent: "", error: "Unknown action" }, { status: 400 });
  return data(handled.result, { status: handled.status });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Account - BenchTalk" }];
}

export default function Account({ loaderData, actionData: rawResult }: Route.ComponentProps) {
  const { me, back } = loaderData;
  // The account cards only know { intent, error } or { intent, success }
  const actionData = rawResult && ("error" in rawResult || "success" in rawResult) ? (rawResult as AccountResult) : null;
  const ownedActive = loaderData.teams.filter((t) => t.owner && !t.archivedAt);
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
      <TeamsCard teams={loaderData.teams} result={actionData?.intent === "teams" ? actionData : null} />
      {ownedActive.length > 0 && (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Add to team staff" />
          <p className="mt-0.5 text-sm text-muted">
            Invite a coach, assistant coach or team manager to one or more of the teams you own. They'll be able to plan
            lineups, manage the roster and edit games on each team you pick.
          </p>
          <StaffInviteForm
            teams={ownedActive.map((t) => ({ id: t.id, name: t.name }))}
            emailConfigured={loaderData.emailConfigured}
            error={actionData?.intent === "invite" && "error" in actionData ? actionData.error : null}
            invite={rawResult && "invite" in rawResult ? rawResult.invite : null}
          />
        </Card>
      )}
      <LogOutButton />
    </Page>
  );
}

type AccountTeam = { id: number; name: string; format: string; season: string | null; archivedAt: string | null; owner: boolean };

// Every team you're on. Archive the ones whose season is over (owners only),
// without opening each team; archived ones stay listed here to bring back.
function TeamsCard({ teams, result }: { teams: AccountTeam[]; result: AccountResult | null }) {
  const current = teams.filter((t) => !t.archivedAt);
  const archived = teams.filter((t) => t.archivedAt);
  if (teams.length === 0) return null;
  return (
    <Card className="p-5 sm:p-6" id="teams">
      <CardHeader title="Your teams" count={teams.length} />
      <p className="mt-0.5 text-sm text-muted">
        Archive a team when its season is over. It leaves the team switcher and team list for everyone on its staff, and
        nothing is deleted. Only a team's owner can archive it.
      </p>
      {result && (
        <div className="mt-4">
          {"error" in result ? <Alert>{result.error}</Alert> : <Alert tone="success">{result.success}</Alert>}
        </div>
      )}
      <ul className="mt-4 divide-y divide-line rounded-xl ring-1 ring-line">
        {[...current, ...archived].map((t) => (
          <TeamRow key={t.id} team={t} />
        ))}
      </ul>
    </Card>
  );
}

function TeamRow({ team: t }: { team: AccountTeam }) {
  const [confirming, setConfirming] = useState(false);
  const navigation = useNavigation();
  const busy = navigation.formData?.get("teamId") === String(t.id);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <Link to={`/dashboard/team/${t.id}`} className="group flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold group-hover:underline">{t.name}</span>
            {t.archivedAt && <Badge>Archived</Badge>}
          </span>
          <span className="block text-sm text-muted">
            {[t.format, t.season, t.owner ? "Owner" : "Staff"].filter(Boolean).join(" · ")}
          </span>
        </span>
        <CaretRight size={14} className="shrink-0 text-subtle" />
      </Link>
      {t.owner &&
        (confirming ? (
          <Form method="post" className="flex items-center gap-1" onSubmit={() => setConfirming(false)}>
            <input type="hidden" name="_action" value="archive" />
            <input type="hidden" name="teamId" value={t.id} />
            <span className="mr-1 text-sm">Archive it?</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              Archive
            </Button>
          </Form>
        ) : t.archivedAt ? (
          <Form method="post">
            <input type="hidden" name="_action" value="unarchive" />
            <input type="hidden" name="teamId" value={t.id} />
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              <ArrowCounterClockwise size={16} />
              Unarchive
            </Button>
          </Form>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            <Archive size={16} />
            Archive
          </Button>
        ))}
    </li>
  );
}

