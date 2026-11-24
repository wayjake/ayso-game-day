import type { Route } from "./+types/family.settings";
import { Form, data, useNavigation } from "react-router";
import { db, users } from "~/db";
import { eq, sql } from "drizzle-orm";
import { requireParent } from "~/utils/family.server";
import { PushControls } from "~/components/PushToggle";
import { useFamily } from "~/hooks/useFamily";
import { Alert, Button, Card, CardHeader, PlayerAvatar, inputClass, labelClass } from "~/components/ui";
import { SignOut } from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  return data({
    me: { name: user.name ?? "", email: user.email },
    kids,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireParent(request);
  const formData = await request.formData();
  if (formData.get("_action") === "updateName") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return data({ error: "Your name can't be empty" }, { status: 400 });
    await db.update(users).set({ name, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    return data({ success: "Saved" });
  }
  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings - AYSO Game Day" }];
}

export default function FamilySettings({ loaderData, actionData }: Route.ComponentProps) {
  const { me, kids } = loaderData;
  const { push, openInstall } = useFamily();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting" && navigation.formData?.get("_action") === "updateName";

  return (
    <div className="space-y-5 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>

      <Card className="p-5">
        <CardHeader title="Notifications" className="mb-1" />
        <p className="mb-4 text-sm text-muted">
          New messages, and new or cancelled games and practices. Turn it on separately on each phone or computer you use.
        </p>
        <PushControls push={push} onInstall={openInstall} />
      </Card>

      <Card className="p-5">
        <CardHeader title="Your players" count={kids.length} className="mb-3" />
        <ul className="space-y-2">
          {kids.map((kid) => (
            <li key={kid.playerId} className="flex items-center gap-3">
              <PlayerAvatar player={kid} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{kid.name}</span>
                <span className="block truncate text-xs text-muted">{kid.teamName}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">Missing someone? Ask their coach to invite this email address.</p>
      </Card>

      <Card className="p-5">
        <CardHeader title="Your account" className="mb-3" />
        <Form method="post" className="space-y-3">
          <input type="hidden" name="_action" value="updateName" />
          <div>
            <label htmlFor="name" className={labelClass}>Name</label>
            <input id="name" name="name" defaultValue={me.name} required autoComplete="name" className={inputClass} />
          </div>
          <p className="text-sm text-muted">Signed in as {me.email}</p>
          {actionData && "error" in actionData && <Alert>{actionData.error}</Alert>}
          {actionData && "success" in actionData && <Alert tone="success">{actionData.success}</Alert>}
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </Form>
      </Card>

      <Form action="/user/logout" method="post">
        <Button type="submit" variant="ghost" className="w-full sm:w-auto">
          <SignOut size={18} /> Log out
        </Button>
      </Form>
    </div>
  );
}
