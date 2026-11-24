import type { Route } from "./+types/team.families";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigate, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, contacts, players } from "~/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { inviteFamily, listFamilies } from "~/utils/parent-invites.server";
import { isEmailConfigured } from "~/utils/email.server";
import { formatMessageTime } from "~/utils/dates";
import { handleNoteAction } from "~/utils/announcements.server";
import { getOrCreateFamilyConversation } from "~/utils/messages.server";
import { findFamily, getFamilyContext } from "~/utils/family-context.server";
import { FamilyContext, familyStatusBadge as statusBadge } from "~/components/FamilyContext";
import { Alert, Button, Card, EmptyState, Page, PageHeader, buttonClass, cx } from "~/components/ui";
import { AddressBook, ChatCircleDots, Check, Copy, EnvelopeSimple, PaperPlaneTilt, PencilSimple, Plus, X } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const families = await listFamilies(request, teamId);

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

  return data({ team, me: user.id, families, missing, panel, emailConfigured: isEmailConfigured() });
}

type InviteOutcome = { email: string; result: "sent" | "link-only" | "linked" | "no-players"; url?: string; linkedCount?: number };

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  const notes = await handleNoteAction(formData, teamId, user.id);
  if (notes) return data(notes);

  if (intent === "message") {
    const family = findFamily(await listFamilies(null, teamId), { email: String(formData.get("email") ?? "") });
    if (!family) return data({ error: "That family isn't on this team" }, { status: 400 });
    const conversation = await getOrCreateFamilyConversation(teamId, family.email, family.userIds[0]);
    return redirect(`/dashboard/team/${teamId}/messages/${conversation.id}`);
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
  const { team, me, families, missing, panel, emailConfigured } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const navigate = useNavigate();
  const closePanel = () => navigate(`${base}/families`, { preventScrollReset: true });
  const panelHref = (email: string) => `${base}/families?family=${encodeURIComponent(email)}`;
  const navigation = useNavigation();
  const busyEmail = navigation.state === "submitting" ? String(navigation.formData?.get("email") ?? "") : null;
  const invitingAll = navigation.state === "submitting" && navigation.formData?.get("_action") === "inviteAll";
  const toInvite = families.filter((f) => f.status === "not-invited" || f.status === "expired").length;
  const joined = families.filter((f) => f.status === "joined").length;
  const outcomes = actionData && "outcomes" in actionData ? actionData.outcomes : [];

  return (
    <Page>
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
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
        <Card>
          <ul className="divide-y divide-line">
            {families.map((f) => (
              <li
                key={f.email}
                aria-current={panel?.email === f.email ? "true" : undefined}
                className={cx(
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5",
                  panel?.email === f.email && "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={panelHref(f.email)} preventScrollReset className="font-semibold hover:text-primary hover:underline">
                      {f.kids.map((k) => k.name).join(" & ")}
                    </Link>
                    {statusBadge[f.status]}
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

        </div>

        {panel ? (
          <FamilyPanel key={panel.email} panel={panel} teamId={team.id} me={me} onClose={closePanel} />
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

type Panel = NonNullable<Route.ComponentProps["loaderData"]["panel"]>;

// A sheet on phones, a sticky column on desktop
function FamilyPanel({ panel, teamId, me, onClose }: { panel: Panel; teamId: number; me: number; onClose: () => void }) {
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
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={18} weight="bold" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FamilyContext
            family={panel}
            teamId={teamId}
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
                  to={`/dashboard/team/${teamId}/families/edit?email=${encodeURIComponent(panel.email)}`}
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
