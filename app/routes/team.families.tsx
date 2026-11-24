import type { Route } from "./+types/team.families";
import { useState } from "react";
import { Form, Link, data, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { getStaffRoles, removeFromStaff, requireTeamAccess, requireTeamOwner, setStaffRole } from "~/utils/team-access.server";
import { StaffBadge } from "~/components/StaffBadge";
import { STAFF_ROLES, parseStaffRole, staffRoleLabel, type StaffRole } from "~/utils/team-roles";
import { db, contacts, players } from "~/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { inviteFamily, listFamilies } from "~/utils/parent-invites.server";
import { isEmailConfigured } from "~/utils/email.server";
import { formatMessageTime } from "~/utils/dates";
import { Alert, Badge, Button, Card, EmptyState, Page, PageHeader, buttonClass, cx, inputClass } from "~/components/ui";
import { AddressBook, Check, CheckCircle, Copy, EnvelopeSimple, PaperPlaneTilt, PencilSimple, Plus } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const staffRoles = await getStaffRoles(teamId);
  const families = (await listFamilies(request, teamId)).map((f) => {
    const { userIds, ...rest } = f;
    const account = staffAccount(f.userIds, staffRoles);
    return {
      ...rest,
      account: account
        ? { userId: account, staffRole: staffRoles.get(account) ?? null, isOwner: account === team.coachId }
        : null,
    };
  });

  // Players with no family email can't be invited until the coach adds one
  const withEmail = await db
    .selectDistinct({ id: contacts.playerId })
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), isNotNull(contacts.playerId)));
  const ids = withEmail.map((r) => r.id!).filter(Boolean);
  const missing = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(and(eq(players.teamId, teamId), ids.length ? notInArray(players.id, ids) : undefined))
    .orderBy(players.name);

  return data({ team, families, missing, isOwner: role === "owner", emailConfigured: isEmailConfigured() });
}

// The family's account that a staff role applies to: the one already on staff,
// else the first linked one. Null until the family is on the app.
function staffAccount(userIds: number[], staffRoles: Map<number, StaffRole>) {
  return userIds.find((id) => staffRoles.has(id)) ?? userIds[0] ?? null;
}

type InviteOutcome = { email: string; result: "sent" | "link-only" | "linked" | "no-players"; url?: string; linkedCount?: number };

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "setRole") {
    const { team } = await requireTeamOwner(teamId, user.id);
    const email = String(formData.get("email") ?? "");
    const value = formData.get("role");
    const staffRole = parseStaffRole(value);
    if (!staffRole && value !== "parent") return data({ error: "Pick a role" }, { status: 400 });

    const family = (await listFamilies(null, teamId)).find((f) => f.email === email);
    const userId = family ? staffAccount(family.userIds, await getStaffRoles(teamId)) : null;
    if (!family || !userId) return data({ error: "That family isn't on the app yet. Invite them first." }, { status: 400 });
    const who = family.parentNames[0] ?? email;

    if (!staffRole) {
      if (userId === team.coachId) return data({ error: "You own this team, so you're always on the staff" }, { status: 400 });
      await removeFromStaff(teamId, userId);
      return data({ roleChanged: `${who} is a parent only now, without coach access.` });
    }
    await setStaffRole(teamId, userId, staffRole, user.id);
    return data({ roleChanged: `${who} is now ${staffRoleLabel(staffRole).toLowerCase()}. They'll find the coach view from the family app.` });
  }

  let emails: string[] = [];
  if (intent === "invite") {
    emails = [String(formData.get("email") ?? "")];
  } else if (intent === "inviteAll") {
    const families = await listFamilies(request, teamId);
    emails = families.filter((f) => f.status === "not-invited" || f.status === "expired").map((f) => f.email);
  } else {
    return data({ error: "Unknown action" }, { status: 400 });
  }

  const outcomes: InviteOutcome[] = [];
  for (const email of emails) {
    const outcome = await inviteFamily({ request, teamId, email, invitedBy: user });
    outcomes.push({ email, ...outcome });
  }
  return data({ outcomes });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Families - AYSO Game Day" }];
}

const statusBadge = {
  joined: <Badge tone="success"><CheckCircle size={12} weight="fill" />On the app</Badge>,
  invited: <Badge tone="primary">Invited</Badge>,
  expired: <Badge tone="warning">Invite expired</Badge>,
  "not-invited": <Badge>Not invited</Badge>,
};

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this invite link", url);
        }
      }}
    >
      {copied ? <Check size={16} weight="bold" className="text-success" /> : <Copy size={16} />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export default function Families({ loaderData, actionData }: Route.ComponentProps) {
  const { team, families, missing, isOwner, emailConfigured } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const navigation = useNavigation();
  const busyEmail =
    navigation.state === "submitting" && navigation.formData?.get("_action") === "invite"
      ? String(navigation.formData.get("email") ?? "")
      : null;
  const invitingAll = navigation.state === "submitting" && navigation.formData?.get("_action") === "inviteAll";
  const toInvite = families.filter((f) => f.status === "not-invited" || f.status === "expired").length;
  const joined = families.filter((f) => f.status === "joined").length;
  const outcomes = actionData && "outcomes" in actionData ? actionData.outcomes : [];

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `${base}/roster`, label: "Roster" }}
        title="Families"
        description={`${joined} of ${families.length} families are on the app. Parents RSVP their kids to games and practices and get team messages.`}
        actions={
          <>
            <Link to={`${base}/families/edit`} className={buttonClass({ variant: "secondary" })}>
              <Plus size={18} weight="bold" />
              Add family
            </Link>
            {toInvite > 0 && (
              <Form method="post">
                <input type="hidden" name="_action" value="inviteAll" />
                <Button type="submit" disabled={invitingAll}>
                  <PaperPlaneTilt size={18} />
                  {invitingAll ? "Inviting…" : `Invite ${toInvite} ${toInvite === 1 ? "family" : "families"}`}
                </Button>
              </Form>
            )}
          </>
        }
      />

      {!emailConfigured && (
        <Alert tone="warning" className="mb-6">
          Email isn't set up on this server, so invites aren't emailed. Copy each family's link and text it to them.
        </Alert>
      )}
      {actionData && "error" in actionData && <Alert className="mb-6">{actionData.error}</Alert>}
      {actionData && "roleChanged" in actionData && <Alert tone="success" className="mb-6">{actionData.roleChanged}</Alert>}
      {outcomes.length > 0 && (
        <Alert tone="success" className="mb-6">
          {summarize(outcomes)}
        </Alert>
      )}

      {families.length === 0 ? (
        <Card>
          <EmptyState
            icon={<AddressBook size={24} />}
            title="No family emails yet"
            action={<Link to={`${base}/families/edit`} className={buttonClass()}><Plus size={18} weight="bold" />Add family</Link>}
          >
            Add a parent with an email for each player, then invite them here.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {families.map((f) => (
              <li key={f.email} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.kids.map((k) => k.name).join(" & ")}</span>
                    {statusBadge[f.status]}
                    {f.account?.staffRole && <StaffBadge role={f.account.staffRole} />}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
                    <EnvelopeSimple size={14} className="shrink-0" />
                    <span className="truncate">{f.parentNames.join(", ")} · {f.email}</span>
                  </div>
                  {f.status === "invited" && f.invitedAt && (
                    <div className="mt-0.5 text-xs text-subtle">Invited {formatMessageTime(f.invitedAt)}</div>
                  )}
                  {f.status === "joined" && f.kids.some((k) => !k.linked) && (
                    <div className="mt-0.5 text-xs text-warning">
                      Not linked yet: {f.kids.filter((k) => !k.linked).map((k) => k.name.split(" ")[0]).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  {isOwner && f.account && (
                    <Form method="post">
                      <input type="hidden" name="_action" value="setRole" />
                      <input type="hidden" name="email" value={f.email} />
                      <select
                        key={f.account.staffRole ?? "parent"}
                        name="role"
                        defaultValue={f.account.staffRole ?? "parent"}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        aria-label={`Team role for ${f.parentNames[0] ?? f.email}`}
                        className={cx(inputClass, "w-auto py-1.5 pr-8")}
                      >
                        {!f.account.isOwner && <option value="parent">Parent</option>}
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>{staffRoleLabel(r)}</option>
                        ))}
                      </select>
                    </Form>
                  )}
                  <Link
                    to={`${base}/families/edit?email=${encodeURIComponent(f.email)}`}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                    aria-label={`Edit ${f.parentNames[0] ?? f.email}`}
                  >
                    <PencilSimple size={16} />
                    Edit
                  </Link>
                  {f.inviteUrl && <CopyLink url={f.inviteUrl} />}
                  {(f.status !== "joined" || f.kids.some((k) => !k.linked)) && (
                    <Form method="post">
                      <input type="hidden" name="_action" value="invite" />
                      <input type="hidden" name="email" value={f.email} />
                      <Button type="submit" size="sm" variant={f.status === "not-invited" ? "primary" : "secondary"} disabled={busyEmail === f.email}>
                        {busyEmail === f.email
                          ? "Sending…"
                          : f.status === "joined"
                            ? "Link new kids"
                            : f.status === "not-invited"
                              ? "Invite"
                              : "Resend"}
                      </Button>
                    </Form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {missing.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-semibold">No family email</h2>
          <p className="mt-1 text-sm text-muted">Add a family with an email to invite them.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {missing.map((p) => (
              <li key={p.id}>
                <Link to={`${base}/families/edit?playerId=${p.id}`} className={cx(buttonClass({ variant: "secondary", size: "sm" }))}>
                  <Plus size={14} weight="bold" />
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}

function summarize(outcomes: InviteOutcome[]) {
  const sent = outcomes.filter((o) => o.result === "sent").length;
  const linkOnly = outcomes.filter((o) => o.result === "link-only").length;
  const linked = outcomes.filter((o) => o.result === "linked");
  const parts: string[] = [];
  if (sent) parts.push(`Emailed ${sent} ${sent === 1 ? "invite" : "invites"}.`);
  if (linkOnly) parts.push(`${linkOnly} ${linkOnly === 1 ? "invite is" : "invites are"} ready: copy the link${linkOnly === 1 ? "" : "s"} below and send ${linkOnly === 1 ? "it" : "them"} yourself.`);
  if (linked.length) parts.push(`Linked ${linked.reduce((n, o) => n + (o.linkedCount ?? 0), 0)} more ${linked.length === 1 ? "player" : "players"} to families already on the app.`);
  return parts.join(" ") || "Nothing to do.";
}
