import type { Route } from "./+types/team.families.edit";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { db, players } from "~/db";
import { eq } from "drizzle-orm";
import { deleteFamily, getFamilyContacts, saveFamily } from "~/utils/family-admin.server";
import { listFamilies } from "~/utils/parent-invites.server";
import { Alert, Button, Card, Page, PageHeader, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { Trash } from "@phosphor-icons/react";

// One page for adding a family (no ?email) and editing one (?email=...)
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const search = new URL(request.url).searchParams;
  const email = search.get("email");

  const roster = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);

  if (!email) {
    // Coming from a player with no family yet: start with them checked
    const preselect = parseInt(search.get("playerId") ?? "");
    return data({ team, roster, family: null, joined: false, preselect: Number.isInteger(preselect) ? [preselect] : [] });
  }

  const rows = await getFamilyContacts(teamId, email);
  if (rows.length === 0) throw redirect(`/dashboard/team/${teamId}/families`);
  const status = (await listFamilies(null, teamId)).find((f) => f.email === email.trim().toLowerCase())?.status;

  return data({
    team,
    roster,
    family: {
      email: rows[0].email.trim().toLowerCase(),
      name: rows[0].name,
      phone: rows.find((r) => r.phone)?.phone ?? "",
      playerIds: [...new Set(rows.map((r) => r.playerId!))],
    },
    joined: status === "joined",
    preselect: [] as number[],
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const originalEmail = String(formData.get("originalEmail") ?? "") || null;
  const back = `/dashboard/team/${teamId}/families`;

  if (formData.get("_action") === "delete" && originalEmail) {
    await deleteFamily(teamId, originalEmail);
    return redirect(back);
  }

  const result = await saveFamily({
    teamId,
    originalEmail,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    playerIds: formData.getAll("playerId").map((v) => parseInt(String(v))).filter(Number.isInteger),
  });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return redirect(back);
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.family ? "Edit family" : "Add family"} - AYSO Game Day` }];
}

export default function EditFamily({ loaderData, actionData }: Route.ComponentProps) {
  const { team, roster, family, joined, preselect } = loaderData;
  const back = `/dashboard/team/${team.id}/families`;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selected = new Set(family?.playerIds ?? preselect);

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: back, label: "Families" }}
        title={family ? "Edit family" : "Add family"}
        description={
          family
            ? "Changes apply to every player in this family."
            : "Add a parent or guardian. A second parent with their own email is a separate family."
        }
      />

      {actionData && "error" in actionData && <Alert className="mb-6">{actionData.error}</Alert>}

      <Card>
        <Form method="post">
          {family && <input type="hidden" name="originalEmail" value={family.email} />}
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <label htmlFor="name" className={labelClass}>Parent name</label>
              <input id="name" name="name" type="text" required defaultValue={family?.name ?? ""} className={inputClass} placeholder="e.g. Sarah Johnson" />
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>Email</label>
              <input id="email" name="email" type="email" required defaultValue={family?.email ?? ""} className={inputClass} placeholder="e.g. sarah@example.com" />
              {family && joined && (
                <p className={hintClass}>
                  This family is already on the app. Changing the email doesn't sign them out or remove their access; send a new invite if they'll use the new address.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="phone" className={labelClass}>Phone</label>
              <input id="phone" name="phone" type="tel" defaultValue={family?.phone ?? ""} className={inputClass} placeholder="Optional" />
            </div>

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
              {family && <p className={hintClass}>Unchecking a player also removes this family's access to them in the app.</p>}
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
            <Link to={back} className={buttonClass({ variant: "ghost" })}>Cancel</Link>
            <Button type="submit" name="_action" value="save" disabled={busy}>
              {busy ? "Saving…" : family ? "Save" : "Add family"}
            </Button>
          </div>
        </Form>
      </Card>

      {family && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-semibold">Remove family</h2>
          <p className="mt-1 text-sm text-muted">
            Deletes {family.email} from this team's contacts, cancels any pending invite, and removes their access to these players in the app. Past messages stay.
          </p>
          <Form method="post" className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="originalEmail" value={family.email} />
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
