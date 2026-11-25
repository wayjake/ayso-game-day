import type { Route } from "./+types/team.families.edit";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, players } from "~/db";
import { eq } from "drizzle-orm";
import {
  deleteFamily,
  getHousehold,
  saveHousehold,
  setGuardianRole,
  type GuardianInput,
  type HouseholdGuardian,
} from "~/utils/family-admin.server";
import { normalizeEmail } from "~/utils/invites.server";
import { STAFF_ROLES, parseStaffRole, staffRoleLabel } from "~/utils/team-roles";
import { familyStatusBadge } from "~/components/FamilyContext";
import { StaffBadge } from "~/components/StaffBadge";
import { Alert, Badge, Button, Card, Page, PageHeader, buttonClass, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowCounterClockwise, Plus, Trash, X } from "@phosphor-icons/react";

// One page for adding a family (no ?email) and editing one (?email=...). A
// family here is every parent or guardian of the same kids; each keeps their
// own email, invite and private thread.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team, role } = await requireTeamAccess(teamId, user.id);
  const search = new URL(request.url).searchParams;
  const email = search.get("email");

  const roster = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);

  const isOwner = role === "owner";
  if (!email) {
    // Coming from a player with no family yet: start with them checked
    const preselect = parseInt(search.get("playerId") ?? "");
    return data({ team, roster, isOwner, household: null, preselect: Number.isInteger(preselect) ? [preselect] : [] });
  }

  const household = await getHousehold(teamId, email, team.coachId);
  if (!household) throw redirect(`/dashboard/team/${teamId}/families`);
  return data({ team, roster, isOwner, household, preselect: [] as number[] });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team, role: myRole } = await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const text = (key: string) => String(formData.get(key) ?? "");
  const back = `/dashboard/team/${teamId}/families`;

  if (text("_action") === "delete") {
    for (const email of formData.getAll("householdEmail")) await deleteFamily(teamId, String(email));
    return redirect(back);
  }

  const count = Math.min(parseInt(text("count")) || 0, 20);
  const input: (GuardianInput & { role: string })[] = [];
  for (let i = 0; i < count; i++) {
    input.push({
      originalEmail: text(`g${i}.originalEmail`) || null,
      name: text(`g${i}.name`),
      email: text(`g${i}.email`),
      phone: text(`g${i}.phone`),
      remove: formData.get(`g${i}.remove`) === "1",
      role: text(`g${i}.role`),
    });
  }

  // Roles are checked against the household as it was before saving
  const firstEmail = input.find((g) => g.originalEmail)?.originalEmail;
  const before = firstEmail ? await getHousehold(teamId, firstEmail, team.coachId) : null;

  const result = await saveHousehold({
    teamId,
    guardians: input,
    playerIds: formData.getAll("playerId").map((v) => parseInt(String(v))).filter(Number.isInteger),
  });
  if (!result.ok) return data({ error: result.error }, { status: 400 });

  // Only the owner gives or takes away staff roles
  if (myRole === "owner") {
    const notes: string[] = [];
    for (const g of input) {
      // Removed parents' coach invites were cancelled with their contacts
      if (g.remove) continue;
      const was = before?.guardians.find((b) => g.originalEmail && b.email === normalizeEmail(g.originalEmail));
      if (g.role !== "parent" && !parseStaffRole(g.role)) continue;
      const email = normalizeEmail(g.email);
      const note = await setGuardianRole({
        request,
        team,
        guardian: {
          email,
          name: g.name,
          userId: was?.userId ?? null,
          staffRole: was?.staffRole ?? null,
          // A new email cancelled the old address's coach invite
          staffInvite: was && was.email === email ? was.staffInvite : null,
        },
        role: parseStaffRole(g.role),
        owner: user,
      });
      if (note) notes.push(note);
    }
    // Stay on the page so the coach sees what happened to each role, unless
    // the address this page was opened with is gone
    const opened = normalizeEmail(new URL(request.url).searchParams.get("email") ?? "");
    const kept = input.filter((g) => !g.remove).map((g) => normalizeEmail(g.email));
    if (notes.length && kept.includes(opened)) return data({ roleChanged: notes.join(" ") });
    if (notes.length) return redirect(`${back}/edit?email=${encodeURIComponent(kept[0])}`);
  }
  return redirect(back);
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.household ? "Edit family" : "Add family"} - BenchTalk` }];
}

type Row = {
  key: string;
  original: HouseholdGuardian | null;
  removed: boolean;
};

let nextKey = 0;
const blankRow = (): Row => ({ key: `new-${nextKey++}`, original: null, removed: false });

export default function EditFamily(props: Route.ComponentProps) {
  // Remount after a save that stays on the page, so the cards match what was saved
  return <EditFamilyForm key={JSON.stringify(props.loaderData.household)} {...props} />;
}

function EditFamilyForm({ loaderData, actionData }: Route.ComponentProps) {
  const { team, roster, isOwner, household, preselect } = loaderData;
  const back = `/dashboard/team/${team.id}/families`;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rows, setRows] = useState<Row[]>(() =>
    household ? household.guardians.map((g) => ({ key: g.email, original: g, removed: false })) : [blankRow()]
  );
  const selected = new Set(household?.playerIds ?? preselect);
  const live = rows.filter((r) => !r.removed);
  const update = (key: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: back, label: "Families" }}
        title={household ? "Edit family" : "Add family"}
        description="Add each parent or guardian with their own email. They each get an invite and see every player you pick here."
      />

      {actionData && "error" in actionData && <Alert className="mb-6">{actionData.error}</Alert>}
      {actionData && "roleChanged" in actionData && <Alert tone="success" className="mb-6">{actionData.roleChanged}</Alert>}

      <Card>
        <Form method="post">
          <input type="hidden" name="count" value={rows.length} />
          <div className="space-y-5 p-5 sm:p-6">
            <fieldset>
              <legend className={labelClass}>Parents and guardians</legend>
              <ul className="space-y-3">
                {rows.map((row, i) => (
                  <GuardianCard
                    key={row.key}
                    index={i}
                    row={row}
                    isOwner={isOwner}
                    canRemove={live.length > 1 || row.removed}
                    onRemove={() => (row.original ? update(row.key, { removed: true }) : setRows((all) => all.filter((r) => r.key !== row.key)))}
                    onUndo={() => update(row.key, { removed: false })}
                  />
                ))}
              </ul>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setRows((all) => [...all, blankRow()])}>
                <Plus size={16} weight="bold" />
                Add parent or guardian
              </Button>
            </fieldset>

            <fieldset>
              <legend className={labelClass}>Players</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {roster.map((p) => (
                  <label key={p.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-2">
                    <input type="checkbox" name="playerId" value={p.id} defaultChecked={selected.has(p.id)} className="h-4 w-4 shrink-0 accent-primary" />
                    {p.name}
                  </label>
                ))}
              </div>
              <p className={hintClass}>
                {household
                  ? "Applies to every parent and guardian above. Unchecking a player also removes their access to that player in the app."
                  : "Every parent and guardian above sees these players."}
              </p>
              {household && household.related.length > 0 && (
                <p className={hintClass}>
                  Also a parent of some of these players, edited separately:{" "}
                  {household.related.map((r, i) => (
                    <span key={r.email}>
                      {i > 0 && ", "}
                      <Link to={`${back}/edit?email=${encodeURIComponent(r.email)}`} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
            <Link to={back} className={buttonClass({ variant: "ghost" })}>Cancel</Link>
            <Button type="submit" name="_action" value="save" disabled={busy}>
              {busy ? "Saving…" : household ? "Save" : "Add family"}
            </Button>
          </div>
        </Form>
      </Card>

      {household && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-semibold">Remove family</h2>
          <p className="mt-1 text-sm text-muted">
            Deletes {household.guardians.map((g) => g.email).join(" and ")} from this team's contacts, cancels any pending invites, and removes their access to these players in the app. Past messages stay. To remove just one parent, use Remove on their card above.
          </p>
          <Form method="post" className="mt-3 flex flex-wrap gap-2">
            {household.guardians.map((g) => (
              <input key={g.email} type="hidden" name="householdEmail" value={g.email} />
            ))}
            {confirmingDelete ? (
              <>
                <Button type="submit" name="_action" value="delete" variant="danger" size="sm" disabled={busy}>
                  <Trash size={16} />
                  {busy ? "Removing…" : "Yes, remove family"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              </>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(true)}>
                <Trash size={16} />
                Remove family
              </Button>
            )}
          </Form>
        </Card>
      )}
    </Page>
  );
}

function GuardianCard({
  index,
  row,
  isOwner,
  canRemove,
  onRemove,
  onUndo,
}: {
  index: number;
  row: Row;
  isOwner: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const g = row.original;
  const field = (name: string) => `g${index}.${name}`;
  const id = (name: string) => `g${index}-${name}`;
  const currentRole = (g?.userId ? g.staffRole : g?.staffInvite) ?? "parent";
  const [role, setRole] = useState<string>(currentRole);
  const onApp = g?.status === "joined";

  if (row.removed && g) {
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-4 text-sm">
        <input type="hidden" name={field("originalEmail")} value={g.email} />
        <input type="hidden" name={field("name")} value={g.name} />
        <input type="hidden" name={field("email")} value={g.email} />
        <input type="hidden" name={field("remove")} value="1" />
        <span className="min-w-0 flex-1 text-muted">
          <span className="font-medium text-ink line-through">{g.name}</span> will be removed when you save. They lose access to these players in the app{g.staffInvite ? ", and their coach invite is cancelled" : ""}.
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onUndo}>
          <ArrowCounterClockwise size={16} />
          Undo
        </Button>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-line p-4">
      {g && <input type="hidden" name={field("originalEmail")} value={g.email} />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {g ? familyStatusBadge[g.status] : <span className="text-sm font-medium text-muted">New parent or guardian</span>}
        {g?.staffRole && <StaffBadge role={g.staffRole} />}
        {g?.staffInvite && <Badge tone="primary">Coach invite sent</Badge>}
        {canRemove && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove} aria-label={`Remove ${g?.name || "this parent"}`}>
            <X size={16} />
            Remove
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("name")} className={labelClass}>Name</label>
          <input id={id("name")} name={field("name")} type="text" required defaultValue={g?.name ?? ""} className={inputClass} placeholder="e.g. Sarah Johnson" />
        </div>
        <div>
          <label htmlFor={id("email")} className={labelClass}>Email</label>
          <input id={id("email")} name={field("email")} type="email" required defaultValue={g?.email ?? ""} className={inputClass} placeholder="e.g. sarah@example.com" />
        </div>
        <div>
          <label htmlFor={id("phone")} className={labelClass}>Phone</label>
          <input id={id("phone")} name={field("phone")} type="tel" defaultValue={g?.phone ?? ""} className={inputClass} placeholder="Optional" />
        </div>
        {isOwner && (
          <div className="sm:col-span-2">
            <label htmlFor={id("role")} className={labelClass}>Team role</label>
            <select id={id("role")} name={field("role")} value={role} onChange={(e) => setRole(e.target.value)} className={cx(inputClass, "sm:w-auto sm:pr-10")}>
              {!g?.isTeamOwner && <option value="parent">Parent</option>}
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>{staffRoleLabel(r)}</option>
              ))}
            </select>
            <p className={hintClass}>{roleHint(g, onApp, role, currentRole)}</p>
          </div>
        )}
      </div>
      {g && onApp && (
        <p className={hintClass}>
          Already on the app. Changing the email doesn't sign them out or remove their access; send a new invite if they'll use the new address.
        </p>
      )}
    </li>
  );
}

function roleHint(g: HouseholdGuardian | null, onApp: boolean, role: string, current: string) {
  if (g?.isTeamOwner) return "You own this team, so you're always on the staff.";
  const label = role === "parent" ? null : staffRoleLabel(role as (typeof STAFF_ROLES)[number]).toLowerCase();
  if (role === current) {
    if (!label) return "Parents see their kids' schedule, messages and the team feed. Staff also get the coach view.";
    if (g?.userId) return `Has the coach view as ${label}, and is still a parent to these players.`;
    return `Invited to join the staff as ${label}. They'll be linked to these players when they accept.`;
  }
  if (!label) {
    return g?.userId ? "Saving takes away their coach access. They stay a parent." : "Saving cancels their coach invite.";
  }
  if (onApp && g?.userId) return `Saving gives them the coach view as ${label}.`;
  return `Saving emails them an invite to join the staff as ${label}. Accepting it also links them to these players.`;
}
