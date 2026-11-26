import type { Route } from "./+types/team.settings";
import { Form, Link, data, useNavigation } from "react-router";
import { useState } from "react";
import { getUser } from "~/utils/auth.server";
import { getTeamStaff, removeFromStaff, requireTeamAccess, requireTeamOwner, setStaffRole, teamIdFromCode } from "~/utils/team-access.server";
import { inviteUrl } from "~/utils/invites.server";
import { inviteStaff, setTeamArchived } from "~/utils/staff-invites.server";
import { CopyButton, RoleSelect, StaffInviteForm } from "~/components/StaffInviteForm";
import { isEmailConfigured } from "~/utils/email.server";
import { db, teams, teamInvites } from "~/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { Alert, Badge, Button, Card, CardHeader, Page, PageHeader, PlayerAvatar, buttonClass, inputClass, labelClass } from "~/components/ui";
import { APP_TIME_ZONE } from "~/utils/dates";
import { StaffBadge } from "~/components/StaffBadge";
import { parseStaffRole, staffRoleLabel, type StaffRole } from "~/utils/team-roles";
import { Archive, ArrowCounterClockwise, Crown, EnvelopeSimple, UserCircle } from "@phosphor-icons/react";
import { parseId } from "~/utils/ids";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team, role } = await requireTeamAccess(teamId, user.id);

  const staff = await getTeamStaff(teamId);

  let pendingInvites: { id: string; email: string | null; role: StaffRole; url: string; expiresAt: string }[] = [];

  if (role === "owner") {
    const invites = await db
      .select()
      .from(teamInvites)
      .where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.status, "pending")))
      .orderBy(desc(teamInvites.createdAt));

    pendingInvites = invites
      .filter((invite) => invite.shareCode && new Date(invite.expiresAt).getTime() > Date.now())
      .map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        url: inviteUrl(request, invite.shareCode!),
        expiresAt: invite.expiresAt,
      }));
  }

  return data({
    team,
    role,
    me: { id: user.id },
    staff,
    pendingInvites,
    emailConfigured: isEmailConfigured(),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team } = await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  const text = (key: string) => ((formData.get(key) as string | null) ?? "").trim();

  // Archiving hides the team from everyone's switcher and team list, so only the owner does it
  if (intent === "archive" || intent === "unarchive") {
    await requireTeamOwner(teamId, user.id);
    const archive = intent === "archive";
    await setTeamArchived(team.id, user.id, archive);
    return data({
      intent: "archive",
      success: archive ? "Archived. It's under All teams > Archived teams now." : "Back in your team list and switcher.",
    });
  }

  if (intent === "updateTeam") {
    const name = text("name");
    if (!name) {
      return data({ intent, error: "Team name is required" }, { status: 400 });
    }

    await db
      .update(teams)
      .set({
        name,
        ageGroup: text("ageGroup") || null,
        season: text("season") || null,
        region: text("region") || null,
        teamNumber: text("teamNumber") || null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(teams.id, teamId));

    return data({ intent, success: "Team details saved" });
  }

  // This team only; inviting to several teams at once is on the Account page
  if (intent === "invite") {
    await requireTeamOwner(teamId, user.id);
    const result = await inviteStaff({
      request,
      user,
      email: text("email"),
      role: parseStaffRole(formData.get("role")) ?? "coach",
      teamIds: [team.id],
    });
    if ("error" in result) return data({ intent, error: result.error }, { status: 400 });
    return data({ intent, invite: result.invite });
  }

  if (intent === "revokeInvite") {
    await requireTeamOwner(teamId, user.id);
    const inviteId = parseId(text("inviteId"));
    if (!inviteId) return data({ intent, error: "That invite isn't there anymore" }, { status: 400 });
    await db
      .update(teamInvites)
      .set({ status: "revoked" })
      .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, team.id)));
    return data({ intent, success: "Invite revoked" });
  }

  if (intent === "setRole") {
    await requireTeamOwner(teamId, user.id);
    const userId = parseId(text("userId"));
    const role = parseStaffRole(formData.get("role"));
    const member = (await getTeamStaff(teamId)).find((s) => s.userId === userId);
    if (!userId || !member || !role) return data({ intent, error: "That person isn't on the team staff" }, { status: 400 });
    await setStaffRole(teamId, userId, role, user.id);
    return data({ intent, success: `${member.name || member.email} is now ${staffRoleLabel(role).toLowerCase()}` });
  }

  if (intent === "removeMember") {
    await requireTeamOwner(teamId, user.id);
    const userId = parseId(text("userId"));
    const member = (await getTeamStaff(teamId)).find((s) => s.userId === userId);
    if (!userId || !member || member.isOwner) return data({ intent, error: "That person isn't on the team staff" }, { status: 400 });
    await removeFromStaff(teamId, userId);
    return data({ intent, success: `${member.name || member.email} was removed from the staff. If they're a parent on the team, they still have the family app.` });
  }

  return data({ intent, error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Team settings - BenchTalk" },
    { name: "description", content: "Team details and coaches" },
  ];
}


export default function TeamSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { team, role, me, staff, pendingInvites, emailConfigured } = loaderData;
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state === "submitting" && navigation.formData?.get("_action") === intent;

  const message = (intent: string) => {
    if (!actionData || actionData.intent !== intent) return null;
    if ("error" in actionData && actionData.error) {
      return <Alert className="mt-4">{actionData.error}</Alert>;
    }
    if ("success" in actionData && actionData.success) {
      return <Alert tone="success" className="mt-4">{actionData.success}</Alert>;
    }
    return null;
  };

  const inviteResult = actionData && "invite" in actionData ? actionData.invite : null;

  return (
    <Page width="narrow" className="space-y-6">
      <PageHeader title="Settings" description="Team details and who's on the team staff." />

      {/* Team details */}
      <Card className="p-5 sm:p-6">
        <CardHeader title="Team details" />
        <p className="mt-0.5 text-sm text-muted">These fill in the top of your game cards.</p>
        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="_action" value="updateTeam" />
          <div>
            <label htmlFor="name" className={labelClass}>Team name</label>
            <input id="name" name="name" required defaultValue={team.name} className={inputClass} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="region" className={labelClass}>Region</label>
              <input id="region" name="region" defaultValue={team.region ?? ""} placeholder="254" className={inputClass} />
            </div>
            <div>
              <label htmlFor="ageGroup" className={labelClass}>Age group</label>
              <input id="ageGroup" name="ageGroup" defaultValue={team.ageGroup ?? ""} placeholder="BU14" className={inputClass} />
            </div>
            <div>
              <label htmlFor="teamNumber" className={labelClass}>Team number</label>
              <input id="teamNumber" name="teamNumber" defaultValue={team.teamNumber ?? ""} placeholder="4" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="season" className={labelClass}>Season</label>
              <input id="season" name="season" defaultValue={team.season ?? ""} placeholder="Fall 2026" className={inputClass} />
            </div>
            <div>
              <span className={labelClass}>Format</span>
              <div className="flex h-[42px] items-center">
                <Badge tone="primary" className="px-2 py-1 text-sm">{team.format}</Badge>
              </div>
            </div>
          </div>
          <div className="pt-1">
            <Button type="submit" disabled={busy("updateTeam")}>
              {busy("updateTeam") ? "Saving…" : "Save details"}
            </Button>
          </div>
          {message("updateTeam")}
        </Form>
      </Card>

      {/* Personal settings moved to the Account page (avatar menu, top right) */}
      <Card className="flex items-center gap-3 p-5 sm:p-6">
        <UserCircle size={28} className="shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-muted">
          Your name, notifications and email address are in your account, and apply to every team.
        </p>
        <Link to="/dashboard/account" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Account settings
        </Link>
      </Card>

      {/* Team staff */}
      <Card className="p-5 sm:p-6">
        <CardHeader title="Team staff" count={staff.length} />
        <p className="mt-0.5 text-sm text-muted">
          Coaches, assistant coaches, and team managers can all plan lineups, manage the roster, edit games, and message families.
          Families see each person's role next to their messages.
        </p>

        <ul className="mt-3 divide-y divide-line">
          {staff.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <PlayerAvatar player={{ name: member.name || member.email }} size="md" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{member.name || member.email}</span>
                    {member.userId === me.id && <span className="font-normal text-subtle">(you)</span>}
                    {member.isOwner && (
                      <Badge className="shrink-0" title="Created the team. Only the owner can invite, remove, or change roles.">
                        <Crown size={12} weight="fill" />
                        Owner
                      </Badge>
                    )}
                  </div>
                  {member.name && <div className="truncate text-sm text-muted">{member.email}</div>}
                </div>
              </div>
              {role === "owner" ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Form method="post">
                    <input type="hidden" name="_action" value="setRole" />
                    <input type="hidden" name="userId" value={member.userId} />
                    <RoleSelect
                      key={member.role}
                      name="role"
                      defaultValue={member.role}
                      aria-label={`Role for ${member.name || member.email}`}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      disabled={busy("setRole")}
                    />
                  </Form>
                  {!member.isOwner && (
                    <Form method="post">
                      <input type="hidden" name="_action" value="removeMember" />
                      <input type="hidden" name="userId" value={member.userId} />
                      <Button type="submit" variant="danger-soft" size="sm">Remove</Button>
                    </Form>
                  )}
                </div>
              ) : (
                <StaffBadge role={member.role} />
              )}
            </li>
          ))}
          {pendingInvites.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-subtle"
                >
                  <EnvelopeSimple size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{invite.email}</span>
                    <Badge tone="warning" className="shrink-0">Invited</Badge>
                    <StaffBadge role={invite.role} />
                  </div>
                  <div className="text-sm text-muted">
                    Expires {formatInviteExpiry(invite.expiresAt)}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <CopyButton value={invite.url} />
                <Form method="post">
                  <input type="hidden" name="_action" value="revokeInvite" />
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <Button type="submit" variant="danger-soft" size="sm">Revoke</Button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
        {message("setRole")}
        {message("removeMember")}
        {message("revokeInvite")}
      </Card>

      {/* Invite to the staff (owner only) */}
      {role === "owner" && (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Add to the team staff" />
          <p className="mt-0.5 text-sm text-muted">
            They'll be able to plan lineups, manage the roster, and edit games on this team. Only you can invite or
            remove staff. To give a parent who's already on the app a role, use Families. To invite someone to several
            of your teams at once, use your <Link to="/dashboard/account#teams" className="font-medium text-primary hover:underline">Account</Link>.
          </p>
          <StaffInviteForm
            teamId={team.id}
            emailConfigured={emailConfigured}
            error={actionData?.intent === "invite" && "error" in actionData ? actionData.error : null}
            invite={inviteResult}
          />
        </Card>
      )}

      <ArchiveCard archived={Boolean(team.archivedAt)} isOwner={role === "owner"} message={message("archive")} />
    </Page>
  );
}

// Pinned to the app's time zone so the server and browser render the same text
function formatInviteExpiry(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: APP_TIME_ZONE }).format(new Date(iso));
}

// A past season: hide the team from the switcher and the team list, or bring it back
function ArchiveCard({ archived, isOwner, message }: { archived: boolean; isOwner: boolean; message: React.ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const navigation = useNavigation();
  const busy = navigation.formData?.get("_action") === "archive" || navigation.formData?.get("_action") === "unarchive";

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={archived ? "This team is archived" : "Archive this team"} />
      <p className="mt-1 text-sm text-muted">
        {archived
          ? "It's hidden from the team switcher and your team list for everyone on staff. Everything is still here, and it works as before."
          : "For a season that's over: the team drops out of the team switcher and your team list for everyone on staff. Nothing is deleted, and you can still open it from All teams > Archived teams, or bring it back."}
      </p>
      {!isOwner ? (
        <p className="mt-3 text-sm text-muted">Only the team's owner can {archived ? "bring it back" : "archive it"}.</p>
      ) : archived ? (
        <Form method="post" className="mt-4">
          <input type="hidden" name="_action" value="unarchive" />
          <Button type="submit" variant="secondary" disabled={busy}>
            <ArrowCounterClockwise size={18} />
            {busy ? "Restoring…" : "Unarchive team"}
          </Button>
        </Form>
      ) : confirming ? (
        <Form method="post" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3" onSubmit={() => setConfirming(false)}>
          <input type="hidden" name="_action" value="archive" />
          <p className="min-w-0 flex-1 text-sm font-medium">Hide it from everyone's team list?</p>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            <Archive size={16} />
            Archive
          </Button>
        </Form>
      ) : (
        <Button variant="secondary" className="mt-4" onClick={() => setConfirming(true)}>
          <Archive size={18} />
          Archive team
        </Button>
      )}
      {message}
    </Card>
  );
}

