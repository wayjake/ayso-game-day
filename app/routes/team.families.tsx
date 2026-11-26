import type { Route } from "./+types/team.families";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigate, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { getStaffRoles, removeFromStaff, requireTeamAccess, requireTeamOwner, setStaffRole, teamIdFromCode } from "~/utils/team-access.server";
import { StaffBadge } from "~/components/StaffBadge";
import { STAFF_ROLES, parseStaffRole, staffRoleLabel } from "~/utils/team-roles";
import { db, contacts, players } from "~/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { inviteFamily, listFamilies, type Family } from "~/utils/parent-invites.server";
import { isEmailConfigured } from "~/utils/email.server";
import { formatMessageTime } from "~/utils/dates";
import { handleNoteAction } from "~/utils/announcements.server";
import { getOrCreateFamilyConversation } from "~/utils/messages.server";
import { findFamily, getFamilyContext } from "~/utils/family-context.server";
import { groupHouseholds, sendCoachInvite, staffAccountFor } from "~/utils/family-admin.server";
import { FamilyContext, familyStatusBadge as statusBadge } from "~/components/FamilyContext";
import { Alert, Button, Card, EmptyState, Page, PageHeader, buttonClass, cx, inputClass } from "~/components/ui";
import { AddressBook, ChatCircleDots, Check, Copy, EnvelopeSimple, PaperPlaneTilt, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { teamPath } from "~/utils/team-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const staffRoles = await getStaffRoles(teamId);
  const families = (await listFamilies(request, teamId)).map((f) => {
    const account = staffAccount(f.userIds, staffRoles);
    return {
      ...f,
      // A coach invite link is the owner's to share, like on Settings
      inviteUrl: f.staffInvite && role !== "owner" ? null : f.inviteUrl,
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

  // The family panel, opened with ?family=<email>
  const selectedEmail = new URL(request.url).searchParams.get("family")?.toLowerCase() ?? null;
  const selected = selectedEmail ? findFamily(families, { email: selectedEmail }) : null;
  const panel = selected ? await getFamilyContext(teamId, selected) : null;

  const households = groupHouseholds(families);
  // ?invited=&linkOnly= after "Save and invite" on the edit page
  const search = new URL(request.url).searchParams;
  const invited = { sent: parseInt(search.get("invited") ?? "") || 0, linkOnly: parseInt(search.get("linkOnly") ?? "") || 0 };

  return data({ team, me: user.id, families, households, missing, panel, invited, isOwner: role === "owner", emailConfigured: isEmailConfigured() });
}

const staffAccount = staffAccountFor;

// Families still waiting for a first (or fresh) invite. A parent invited as
// staff gets their coach invite again, which only the owner can send.
const needsInvite = (f: Family, isOwner: boolean) =>
  (f.status === "not-invited" || f.status === "expired") && (!f.staffInvite || isOwner);

type InviteOutcome = { email: string; result: "sent" | "link-only" | "linked" | "no-players"; url?: string; linkedCount?: number };

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team: myTeam, role: myRole } = await requireTeamAccess(teamId, user.id);
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

  const notes = await handleNoteAction(formData, teamId, user.id);
  if (notes) return data(notes);

  if (intent === "message") {
    const family = findFamily(await listFamilies(null, teamId), { email: String(formData.get("email") ?? "") });
    if (!family) return data({ error: "That family isn't on this team" }, { status: 400 });
    // Your own private thread with them
    const conversation = await getOrCreateFamilyConversation(teamId, family.email, family.userIds[0], user.id);
    return redirect(teamPath(myTeam, `messages/${conversation.id}`));
  }

  const isOwner = myRole === "owner";
  const families = await listFamilies(request, teamId);
  let emails: string[] = [];
  if (intent === "invite") {
    emails = [String(formData.get("email") ?? "")];
  } else if (intent === "inviteAll") {
    emails = families.filter((f) => needsInvite(f, isOwner)).map((f) => f.email);
  } else {
    return data({ error: "Unknown action" }, { status: 400 });
  }

  const outcomes: InviteOutcome[] = [];
  for (const email of emails) {
    const family = families.find((f) => f.email === email.trim().toLowerCase());
    // Invited as staff: resend that invite rather than a parent invite on top
    if (family?.staffInvite && family.status !== "joined") {
      if (!isOwner) return data({ error: "Only the team owner can resend a coach invite." }, { status: 403 });
      const result = await sendCoachInvite({ request, team: myTeam, email: family.email, role: family.staffInvite, owner: user });
      if (result) outcomes.push({ email, result });
      continue;
    }
    const outcome = await inviteFamily({ request, teamId, email, invitedBy: user });
    outcomes.push({ email, ...outcome });
  }
  return data({ outcomes });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Families - BenchTalk" }];
}


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
  const { team, me, families, households, missing, panel, invited, isOwner, emailConfigured } = loaderData;
  const base = teamPath(team);
  const navigate = useNavigate();
  const closePanel = () => navigate(`${base}/families`, { preventScrollReset: true });
  const panelHref = (email: string) => `${base}/families?family=${encodeURIComponent(email)}`;
  const navigation = useNavigation();
  const busyEmail =
    navigation.state === "submitting" && navigation.formData?.get("_action") === "invite"
      ? String(navigation.formData.get("email") ?? "")
      : null;
  const invitingAll = navigation.state === "submitting" && navigation.formData?.get("_action") === "inviteAll";
  const toInvite = families.filter((f) => needsInvite(f, isOwner)).length;
  const joined = households.filter((h) => h.some((f) => f.status === "joined")).length;
  const outcomes = actionData && "outcomes" in actionData ? actionData.outcomes : [];

  return (
    <Page>
      <PageHeader
        title="Families"
        description={`${joined} of ${households.length} families are on the app. Parents RSVP their kids to games and practices and get team messages.`}
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
                  {invitingAll ? "Inviting…" : `Invite ${toInvite} ${toInvite === 1 ? "parent" : "parents"}`}
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
      {(invited.sent > 0 || invited.linkOnly > 0) && outcomes.length === 0 && (
        <Alert tone="success" className="mb-6">
          {summarize([
            ...Array.from({ length: invited.sent }, () => ({ email: "", result: "sent" as const })),
            ...Array.from({ length: invited.linkOnly }, () => ({ email: "", result: "link-only" as const })),
          ])}
        </Alert>
      )}
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
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
        <Card>
          <ul className="divide-y divide-line">
            {households.map((parents) => {
              const current = parents.some((f) => f.email === panel?.email);
              return (
                <li
                  key={parents[0].email}
                  aria-current={current ? "true" : undefined}
                  className={cx("p-4 sm:px-5", current && "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]")}
                >
                  <div className="flex items-center gap-2">
                    <Link to={panelHref(parents[0].email)} preventScrollReset className="min-w-0 flex-1 truncate font-semibold hover:text-primary hover:underline">
                      {parents[0].kids.map((k) => k.name).join(" & ")}
                    </Link>
                    <Link
                      to={`${base}/families/edit?email=${encodeURIComponent(parents[0].email)}`}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                      aria-label={`Edit ${parents[0].kids.map((k) => k.name).join(" & ")}'s family`}
                    >
                      <PencilSimple size={16} />
                      Edit
                    </Link>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {parents.map((f) => (
                      <ParentLine key={f.email} f={f} isOwner={isOwner} busy={busyEmail === f.email} panelHref={panelHref(f.email)} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Card>

        </div>

        {panel ? (
          <FamilyPanel key={panel.email} panel={panel} teamCode={team.code} me={me} onClose={closePanel} />
        ) : (
          <Card className="sticky top-4 hidden p-6 text-center lg:block">
            <p className="font-semibold">Pick a family</p>
            <p className="mt-1 text-sm text-muted">Click a name to see their RSVPs, how they responded to announcements, and your notes.</p>
          </Card>
        )}
        </div>
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

type FamilyRow = Route.ComponentProps["loaderData"]["families"][number];

// One parent or guardian in a household row: their status, role and invite
function ParentLine({ f, isOwner, busy, panelHref }: { f: FamilyRow; isOwner: boolean; busy: boolean; panelHref: string }) {
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <EnvelopeSimple size={14} className="shrink-0 text-muted" />
          <Link to={panelHref} preventScrollReset className="font-medium hover:text-primary hover:underline">
            {f.parentNames.join(", ")}
          </Link>
          <span className="min-w-0 truncate text-muted">{f.email}</span>
          {statusBadge[f.status]}
          {f.account?.staffRole && <StaffBadge role={f.account.staffRole} />}
          {f.staffInvite && f.status !== "joined" && <StaffBadge role={f.staffInvite} />}
        </div>
        {f.status === "invited" && f.invitedAt && (
          <div className="mt-0.5 pl-5 text-xs text-subtle">
            {f.staffInvite ? "Coach invite sent" : "Invited"} {formatMessageTime(f.invitedAt)}
          </div>
        )}
        {f.status === "joined" && f.kids.some((k) => !k.linked) && (
          <div className="mt-0.5 pl-5 text-xs text-warning">
            Not linked yet: {f.kids.filter((k) => !k.linked).map((k) => k.name.split(" ")[0]).join(", ")}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-5 sm:justify-end sm:pl-0">
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
        {f.inviteUrl && <CopyLink url={f.inviteUrl} />}
        {(f.status !== "joined" || f.kids.some((k) => !k.linked)) && (!f.staffInvite || isOwner) && (
          <Form method="post">
            <input type="hidden" name="_action" value="invite" />
            <input type="hidden" name="email" value={f.email} />
            <Button type="submit" size="sm" variant={f.status === "not-invited" ? "primary" : "secondary"} disabled={busy}>
              {busy ? "Sending…" : f.status === "joined" ? "Link new kids" : f.status === "not-invited" ? "Invite" : "Resend"}
            </Button>
          </Form>
        )}
      </div>
    </li>
  );
}

type Panel = NonNullable<Route.ComponentProps["loaderData"]["panel"]>;

// A sheet on phones, a sticky column on desktop
function FamilyPanel({ panel, teamCode, me, onClose }: { panel: Panel; teamCode: string; me: string; onClose: () => void }) {
  const navigation = useNavigation();
  const messaging = navigation.state !== "idle" && navigation.formData?.get("_action") === "message";
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-30 bg-ink/30 lg:hidden" />
      <aside
        aria-label={panel.label}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col rounded-t-2xl bg-surface shadow-2xl ring-1 ring-line lg:sticky lg:top-4 lg:inset-auto lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-2xl lg:shadow-card"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{panel.label}</h2>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={18} weight="bold" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FamilyContext
            family={panel}
            teamCode={teamCode}
            meId={me}
            actions={
              <>
                <Form method="post">
                  <input type="hidden" name="_action" value="message" />
                  <input type="hidden" name="email" value={panel.email} />
                  <Button type="submit" size="sm" disabled={messaging}>
                    <ChatCircleDots size={16} />
                    {messaging ? "Opening…" : "Message"}
                  </Button>
                </Form>
                <Link
                  to={teamPath(teamCode, `families/edit?email=${encodeURIComponent(panel.email)}`)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  <PencilSimple size={16} />
                  Edit
                </Link>
              </>
            }
          />
        </div>
      </aside>
    </>
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
