import type { Route } from "./+types/team.settings";
import { Form, data, useNavigation } from "react-router";
import { useState } from "react";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, requireTeamOwner } from "~/utils/team-access.server";
import { createInvites, inviteUrl, normalizeEmail, sendInviteEmail } from "~/utils/invites.server";
import { isEmailConfigured } from "~/utils/email.server";
import { db, teams, users, teamMembers, teamInvites } from "~/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

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
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, "active")))
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
    { title: "Team Settings - AYSO Game Day" },
    { name: "description", content: "Team details and coaches" },
  ];
}

const inputClass =
  "w-full rounded border border-[var(--border)] px-3 py-2 bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent";
const primaryButton =
  "inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition disabled:opacity-60";
const secondaryButton =
  "inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={secondaryButton}
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
      {copied ? "Copied" : "Copy link"}
    </button>
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
      return <p className="text-sm text-red-700 mt-3">{actionData.error}</p>;
    }
    if ("success" in actionData && actionData.success) {
      return <p className="text-sm text-[var(--success)] mt-3">{actionData.success}</p>;
    }
    return null;
  };

  const inviteResult = actionData && "invite" in actionData ? actionData.invite : null;

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Team Settings</h1>
          <p className="mt-2 text-[var(--muted)]">{team.name}</p>
        </div>

        {/* Team details */}
        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold">Team details</h2>
          <p className="text-sm text-[var(--muted)] mb-4">These fill in the top of your game cards.</p>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="updateTeam" />
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Team name</label>
              <input id="name" name="name" required defaultValue={team.name} className={inputClass} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="region" className="block text-sm font-medium mb-1">Region</label>
                <input id="region" name="region" defaultValue={team.region ?? ""} placeholder="254" className={inputClass} />
              </div>
              <div>
                <label htmlFor="ageGroup" className="block text-sm font-medium mb-1">Age group</label>
                <input id="ageGroup" name="ageGroup" defaultValue={team.ageGroup ?? ""} placeholder="BU14" className={inputClass} />
              </div>
              <div>
                <label htmlFor="teamNumber" className="block text-sm font-medium mb-1">Team #</label>
                <input id="teamNumber" name="teamNumber" defaultValue={team.teamNumber ?? ""} placeholder="4" className={inputClass} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="season" className="block text-sm font-medium mb-1">Season</label>
                <input id="season" name="season" defaultValue={team.season ?? ""} placeholder="Fall 2026" className={inputClass} />
              </div>
              <div>
                <span className="block text-sm font-medium mb-1">Format</span>
                <div className="px-3 py-2 text-[var(--muted)]">{team.format}</div>
              </div>
            </div>
            <button type="submit" className={primaryButton} disabled={busy("updateTeam")}>
              {busy("updateTeam") ? "Saving…" : "Save details"}
            </button>
            {message("updateTeam")}
          </Form>
        </section>

        {/* Your name */}
        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold">Your name</h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            Printed as the {role === "owner" ? "coach" : "assistant coach"} on game cards.
          </p>
          <Form method="post" className="flex flex-col sm:flex-row gap-3">
            <input type="hidden" name="_action" value="updateName" />
            <input name="name" defaultValue={me.name ?? ""} placeholder="Your full name" className={inputClass} aria-label="Your name" />
            <button type="submit" className={primaryButton} disabled={busy("updateName")}>
              {busy("updateName") ? "Saving…" : "Save"}
            </button>
          </Form>
          {message("updateName")}
        </section>

        {/* Coaches */}
        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">Coaches</h2>

          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded">
            {owner && (
              <li className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{owner.name || owner.email}</div>
                  {owner.name && <div className="text-sm text-[var(--muted)] truncate">{owner.email}</div>}
                </div>
                <span className="text-xs font-semibold text-[var(--muted)] shrink-0">Owner</span>
              </li>
            )}
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{member.name || member.email}</div>
                  {member.name && <div className="text-sm text-[var(--muted)] truncate">{member.email}</div>}
                </div>
                {role === "owner" ? (
                  <Form method="post" className="shrink-0">
                    <input type="hidden" name="_action" value="removeMember" />
                    <input type="hidden" name="memberId" value={member.id} />
                    <button type="submit" className={secondaryButton}>Remove</button>
                  </Form>
                ) : (
                  <span className="text-xs font-semibold text-[var(--muted)] shrink-0">Coach</span>
                )}
              </li>
            ))}
            {pendingInvites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{invite.email}</div>
                  <div className="text-sm text-[var(--muted)]">
                    Invited, expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <CopyButton value={invite.url} />
                  <Form method="post">
                    <input type="hidden" name="_action" value="revokeInvite" />
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <button type="submit" className={secondaryButton}>Revoke</button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
          {message("removeMember")}
          {message("revokeInvite")}

          {role === "owner" && (
            <div className="mt-6 border-t border-[var(--border)] pt-6">
              <h3 className="font-semibold">Invite a coach</h3>
              <p className="text-sm text-[var(--muted)] mb-4">
                They'll be able to plan lineups, manage the roster, and edit games on the teams you pick.
                Only you can invite or remove coaches.
              </p>
              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="invite" />
                <div>
                  <label htmlFor="inviteEmail" className="block text-sm font-medium mb-1">Email</label>
                  <input id="inviteEmail" name="email" type="email" required placeholder="coach@example.com" className={inputClass} />
                </div>
                {ownedTeams.length > 1 && (
                  <fieldset>
                    <legend className="block text-sm font-medium mb-2">Teams</legend>
                    <div className="space-y-2">
                      {ownedTeams.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="teamIds" value={t.id} defaultChecked={t.id === team.id} />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {ownedTeams.length <= 1 && <input type="hidden" name="teamIds" value={team.id} />}
                <button type="submit" className={primaryButton} disabled={busy("invite")}>
                  {busy("invite") ? "Sending…" : emailConfigured ? "Send invite" : "Create invite link"}
                </button>
                {message("invite")}
              </Form>

              {inviteResult && (
                <div className="mt-4 p-4 rounded border border-[var(--border)] bg-[var(--bg)] text-sm space-y-2">
                  <p>
                    {inviteResult.emailed
                      ? `Invite emailed to ${inviteResult.email} for ${inviteResult.teamNames.join(", ")}.`
                      : `Invite created for ${inviteResult.email} (${inviteResult.teamNames.join(", ")}). ${
                          emailConfigured ? "The email didn't send" : "Email isn't set up yet"
                        }, so send them this link yourself:`}
                  </p>
                  {inviteResult.skippedTeams.length > 0 && (
                    <p className="text-[var(--muted)]">Already a coach on {inviteResult.skippedTeams.join(", ")}.</p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <code className="flex-1 min-w-0 break-all text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1.5">
                      {inviteResult.url}
                    </code>
                    <CopyButton value={inviteResult.url} />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
