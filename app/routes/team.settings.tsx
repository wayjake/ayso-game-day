import type { Route } from "./+types/team.settings";
import { Form, data, useNavigation } from "react-router";
import { useState } from "react";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, requireTeamOwner } from "~/utils/team-access.server";
import { createInvites, inviteUrl, normalizeEmail, sendInviteEmail } from "~/utils/invites.server";
import { isEmailConfigured } from "~/utils/email.server";
import { db, teams, users, teamMembers, teamInvites } from "~/db";
import { eq, and, desc, inArray, ne, sql } from "drizzle-orm";
import { Alert, Badge, Button, Card, CardHeader, Page, PageHeader, PlayerAvatar, inputClass, labelClass } from "~/components/ui";
import { APP_TIME_ZONE } from "~/utils/dates";
import { Check, Copy, Crown, EnvelopeSimple, LinkSimple, PaperPlaneTilt } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team, role } = await requireTeamAccess(teamId, user.id);

  const [owner] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, team.coachId))
    .limit(1);

  const members = await db
    .select({
      id: teamMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      joinedAt: teamMembers.joinedAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    // Older data has the owner listed as a member of their own team; show them once
    .where(and(
      eq(teamMembers.teamId, teamId),
      eq(teamMembers.status, "active"),
      ne(teamMembers.userId, team.coachId)
    ))
    .orderBy(teamMembers.joinedAt);

  let pendingInvites: { id: number; email: string | null; url: string; expiresAt: string }[] = [];
  let ownedTeams: { id: number; name: string }[] = [];

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
        url: inviteUrl(request, invite.shareCode!),
        expiresAt: invite.expiresAt,
      }));

    ownedTeams = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.coachId, user.id))
      .orderBy(desc(teams.createdAt));
  }

  return data({
    team,
    role,
    me: { id: user.id, name: user.name, email: user.email },
    owner,
    members,
    pendingInvites,
    ownedTeams,
    emailConfigured: isEmailConfigured(),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  const text = (key: string) => ((formData.get(key) as string | null) ?? "").trim();

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

  if (intent === "updateName") {
    await db
      .update(users)
      .set({ name: text("name") || null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, user.id));

    return data({ intent, success: "Your name was saved" });
  }

  if (intent === "invite") {
    await requireTeamOwner(teamId, user.id);

    const email = normalizeEmail(text("email"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return data({ intent, error: "Enter a valid email address" }, { status: 400 });
    }
    if (email === normalizeEmail(user.email)) {
      return data({ intent, error: "That's your own email address" }, { status: 400 });
    }

    // Only teams this user owns can be shared
    const requestedIds = formData.getAll("teamIds").map((id) => parseInt(id as string)).filter(Boolean);
    const ownedTeams = requestedIds.length
      ? await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(and(inArray(teams.id, requestedIds), eq(teams.coachId, user.id)))
      : [];

    if (ownedTeams.length === 0) {
      return data({ intent, error: "Pick at least one team" }, { status: 400 });
    }

    const { created, skippedTeamIds } = await createInvites({
      email,
      teamIds: ownedTeams.map((t) => t.id),
      invitedBy: user.id,
    });

    const nameFor = (id: number) => ownedTeams.find((t) => t.id === id)?.name ?? "";
    const skippedTeams = skippedTeamIds.map(nameFor);

    if (created.length === 0) {
      return data(
        { intent, error: `${email} already coaches ${skippedTeams.join(", ")}` },
        { status: 400 }
      );
    }

    // One link accepts every team in this batch, so the email only needs the first code
    const shareCode = created[0].shareCode;
    const teamNames = created.map((c) => nameFor(c.teamId));
    const result = await sendInviteEmail({
      request,
      to: email,
      shareCode,
      inviterName: user.name || user.email,
      inviterEmail: user.email,
      teamNames,
    });

    return data({
      intent,
      invite: {
        email,
        url: inviteUrl(request, shareCode),
        teamNames,
        skippedTeams,
        emailed: result.sent,
        emailError: result.error,
      },
    });
  }

  if (intent === "revokeInvite") {
    await requireTeamOwner(teamId, user.id);
    const inviteId = parseInt(text("inviteId"));
    await db
      .update(teamInvites)
      .set({ status: "revoked" })
      .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, team.id)));
    return data({ intent, success: "Invite revoked" });
  }

  if (intent === "removeMember") {
    await requireTeamOwner(teamId, user.id);
    const memberId = parseInt(text("memberId"));
    await db
      .update(teamMembers)
      .set({ status: "removed", updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, team.id)));
    return data({ intent, success: "Coach removed" });
  }

  return data({ intent, error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Team settings - AYSO Game Day" },
    { name: "description", content: "Team details and coaches" },
  ];
}


function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", value);
        }
      }}
    >
      {copied ? <Check size={16} weight="bold" className="text-success" /> : <Copy size={16} />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export default function TeamSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { team, role, me, owner, members, pendingInvites, ownedTeams, emailConfigured } = loaderData;
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
  const coachCount = (owner ? 1 : 0) + members.length;

  return (
    <Page width="narrow" className="space-y-6">
      <PageHeader title="Settings" description="Team details, your name on game cards, and who coaches this team." />

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
          <div className="grid gap-4 sm:grid-cols-3">
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
          <div className="grid gap-4 sm:grid-cols-2">
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

      {/* Your name */}
      <Card className="p-5 sm:p-6">
        <CardHeader title="Your name" />
        <p className="mt-0.5 text-sm text-muted">
          Printed as the {role === "owner" ? "coach" : "assistant coach"} on game cards.
        </p>
        <Form method="post" className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input type="hidden" name="_action" value="updateName" />
          <input name="name" defaultValue={me.name ?? ""} placeholder="Your full name" className={inputClass} aria-label="Your name" />
          <Button type="submit" className="sm:h-auto" disabled={busy("updateName")}>
            {busy("updateName") ? "Saving…" : "Save"}
          </Button>
        </Form>
        {message("updateName")}
      </Card>

      {/* Coaches */}
      <Card className="p-5 sm:p-6">
        <CardHeader title="Coaches" count={coachCount} />

        <ul className="mt-3 divide-y divide-line">
          {owner && (
            <li className="flex items-center gap-3 py-3">
              <PlayerAvatar player={{ name: owner.name || owner.email }} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {owner.name || owner.email}
                  {owner.id === me.id && <span className="ml-1.5 font-normal text-subtle">(you)</span>}
                </div>
                {owner.name && <div className="truncate text-sm text-muted">{owner.email}</div>}
              </div>
              <Badge tone="primary" className="shrink-0">
                <Crown size={12} weight="fill" />
                Owner
              </Badge>
            </li>
          )}
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-3">
              <PlayerAvatar player={{ name: member.name || member.email }} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {member.name || member.email}
                  {member.userId === me.id && <span className="ml-1.5 font-normal text-subtle">(you)</span>}
                </div>
                {member.name && <div className="truncate text-sm text-muted">{member.email}</div>}
              </div>
              {role === "owner" ? (
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="_action" value="removeMember" />
                  <input type="hidden" name="memberId" value={member.id} />
                  <Button type="submit" variant="danger-soft" size="sm">Remove</Button>
                </Form>
              ) : (
                <Badge className="shrink-0">Coach</Badge>
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
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{invite.email}</span>
                    <Badge tone="warning" className="shrink-0">Invited</Badge>
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
        {message("removeMember")}
        {message("revokeInvite")}
      </Card>

      {/* Invite a coach (owner only) */}
      {role === "owner" && (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Invite a coach" />
          <p className="mt-0.5 text-sm text-muted">
            They'll be able to plan lineups, manage the roster, and edit games on the teams you pick.
            Only you can invite or remove coaches.
          </p>
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="_action" value="invite" />
            <div>
              <label htmlFor="inviteEmail" className={labelClass}>Email</label>
              <input id="inviteEmail" name="email" type="email" required placeholder="coach@example.com" className={inputClass} />
            </div>
            {ownedTeams.length > 1 && (
              <fieldset>
                <legend className={labelClass}>Teams</legend>
                <div className="divide-y divide-line rounded-lg border border-line-strong">
                  {ownedTeams.map((t) => (
                    <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-surface-2">
                      <input
                        type="checkbox"
                        name="teamIds"
                        value={t.id}
                        defaultChecked={t.id === team.id}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 truncate font-medium">{t.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {ownedTeams.length <= 1 && <input type="hidden" name="teamIds" value={team.id} />}
            <div className="pt-1">
              <Button type="submit" disabled={busy("invite")}>
                {emailConfigured ? <PaperPlaneTilt size={18} /> : <LinkSimple size={18} />}
                {busy("invite") ? "Sending…" : emailConfigured ? "Send invite" : "Create invite link"}
              </Button>
            </div>
            {message("invite")}
          </Form>

          {inviteResult && (
            <div className="mt-5 space-y-3">
              <Alert tone={inviteResult.emailed ? "success" : "warning"}>
                {inviteResult.emailed
                  ? `Invite emailed to ${inviteResult.email} for ${inviteResult.teamNames.join(", ")}.`
                  : `Invite created for ${inviteResult.email} (${inviteResult.teamNames.join(", ")}). ${
                      emailConfigured ? "The email didn't send" : "Email isn't set up yet"
                    }, so send them this link yourself:`}
              </Alert>
              {inviteResult.skippedTeams.length > 0 && (
                <p className="text-sm text-muted">Already a coach on {inviteResult.skippedTeams.join(", ")}.</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink ring-1 ring-line">
                  {inviteResult.url}
                </code>
                <CopyButton value={inviteResult.url} />
              </div>
            </div>
          )}
        </Card>
      )}
    </Page>
  );
}

// Pinned to the app's time zone so the server and browser render the same text
function formatInviteExpiry(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: APP_TIME_ZONE }).format(new Date(iso));
}
