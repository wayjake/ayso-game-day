import type { Route } from "./+types/family.settings";
import { data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { accountAction } from "~/utils/account.server";
import { LogOutButton, NotificationsCard, ProfileCard } from "~/components/AccountSettings";
import { Card, CardHeader, PlayerAvatar } from "~/components/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  return data({
    me: { id: user.id, name: user.name, email: user.email },
    kids,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireParent(request);
  const formData = await request.formData();
  // Only the name here; the sending address is a coach setting
  if (formData.get("_action") !== "updateName") return data({ intent: "", error: "Unknown action" }, { status: 400 });
  const handled = await accountAction(user, formData);
  return data(handled!.result, { status: handled!.status });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings - BenchTalk" }];
}

export default function FamilySettings({ loaderData, actionData }: Route.ComponentProps) {
  const { me, kids } = loaderData;

  return (
    <div className="space-y-5 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>

      <ProfileCard me={me} nameHint="Shown to the coaches and the team next to your messages." result={actionData} />

      <NotificationsCard />

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

      <LogOutButton />
    </div>
  );
}
